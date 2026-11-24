let transport;
export function installPanelTransport(value){if(transport)throw Error('请求层已经初始化');transport=value;}
export function panelFetch(...args){return transport?transport.fetch(...args):globalThis.fetch(...args);}
function surface(name){return new Proxy({},{get(_,key){const target=transport?.[name]??globalThis[name],value=target?.[key];return typeof value==='function'?value.bind(target):value;},set(_,key,value){const target=transport?.[name]??globalThis[name];target[key]=value;return true;}});}
export const panelLocation=surface('location');
export const panelHistory=surface('history');
export function responseError(value,fallback='操作未成功'){
  const diagnosticId=/^diag-[a-f0-9-]{36}$/.test(value?.diagnosticId??'')?value.diagnosticId:undefined;
  return Object.assign(Error((value.error||fallback)+(diagnosticId?'（诊断编号：'+diagnosticId+'；设置→高级设置→故障日志）':'')),{...value,diagnosticId});
}

// Read-only requests are separate from command requests. Retrying an expired
// cursor never retries a business command or changes an editor's local draft.
export class PanelReader{
  constructor(fetcher=panelFetch){this.fetch=fetcher;this.cache=new Map();this.pages=new Map();this.details=new Map();this.histories=new Map();this.choices=new Map();this.pageFlights=new Map();this.pageTails=new Map();this.token='';this.instance='';}
  async get(kind,args={}){
    const url='/api/view/'+kind+'?'+new URLSearchParams(Object.entries(args).filter(([,v])=>v!==undefined&&v!==null)),previous=this.cache.get(url),instance=this.instance;
    const response=await this.fetch(url,{headers:{...(this.token?{'X-Panel-Token':this.token}:{}),...(previous?{'If-None-Match':previous.etag}:{})}});
    if(response.status===304&&previous)return previous.value;
    if(!response.ok){const data=await response.json();throw Object.assign(responseError(data,'读取失败'),{status:response.status});}
    const value=await response.json();if(instance===this.instance){if(this.cache.size>=150)this.cache.delete(this.cache.keys().next().value);this.cache.set(url,{etag:response.headers.get('etag'),value});}return value;
  }
  async status(initialStatus){
    const value=initialStatus??await this.get('status');if(this.instance&&this.instance!==value.service.instanceId){this.cache.clear();this.pages.clear();this.details.clear();this.histories.clear();this.choices.clear();this.pageFlights.clear();this.pageTails.clear();}
    this.instance=value.service.instanceId;this.token=value.token;return value;
  }
  list(kind,args,more=false){
    const key=kind+JSON.stringify(args),flight=key+':'+more,instance=this.instance;
    if(this.pageFlights.has(flight))return this.pageFlights.get(flight);
    const previous=this.pageTails.get(key);
    const operation=(async()=>{
      if(previous)await previous.catch(()=>{});
      if(instance!==this.instance)throw Object.assign(Error('服务已更新，请重新读取列表'),{status:409});
      return this.readList(kind,args,more,instance);
    })();
    this.pageFlights.set(flight,operation);this.pageTails.set(key,operation);
    const finish=()=>{if(this.pageFlights.get(flight)===operation)this.pageFlights.delete(flight);if(this.pageTails.get(key)===operation)this.pageTails.delete(key);};
    operation.then(finish,finish);return operation;
  }
  async readList(kind,args,more,instance){
    const key=kind+JSON.stringify(args),old=this.pages.get(key);let value;
    if(more&&old&&!old.cursor)return old;
    try{value=await this.get(kind,{...args,...(more&&old?.cursor?{cursor:old.cursor}:{})});}
    catch(error){if(error.status!==409)throw error;value=await this.get(kind,args);more=false;}
    if(instance!==this.instance)throw Object.assign(Error('服务已更新，请重新读取列表'),{status:409});
    if(more&&old?.cursor&&old.revision===value.revision){
      const owners=new Map();for(const owner of [...(old.owners??[]),...(value.owners??[])])owners.set(owner.id,{...owner,history:[...(owners.get(owner.id)?.history??[]),...(owner.history??[])]});
      value={...value,items:[...old.items,...value.items],related:[...(old.related??[]),...(value.related??[])],jobs:[...(old.jobs??[]),...(value.jobs??[])],owners:[...owners.values()]};
    }
    else if(!more&&old?.revision===value.revision&&old.items.length>value.items.length)value=old;
    this.pages.set(key,value);return value;
  }
  async detail(projectId,id){const value=await this.get('task',{projectId,id});this.details.set(projectId+':'+id,value);return value;}
  async history(projectId,id,more=false){const value=await this.list('history',{projectId,id,limit:20},more);this.histories.set(projectId+':'+id,value);return value;}
  async allChoices(projectId){
    // Only requested by an editor/relationship selector. Paginate all options
    // then publish atomically so a project switch cannot leak other choices.
    for(let attempt=0;attempt<2;attempt++){
      const items=[];let cursor;try{do{const page=await this.get('choices',{projectId,limit:200,cursor});items.push(...page.items);cursor=page.cursor;}while(cursor);this.choices.set(projectId,items);return items;}catch(e){if(e.status!==409||attempt)throw e;}
    }
  }
  async load({projectId,mode='project',lanes=['todo','running','review','done'],filters={},detailId='',selectedIds=[],initialStatus}){
    const status=await this.status(initialStatus),valid=status.projects.some(p=>p.projectId===projectId)||status.workspace?.mappings?.[projectId];
    const state={...status,query:{pages:{},counts:{},projectTotal:0},tasks:[],jobs:[],legacyJobs:[],versionRecords:[]};
    if(!projectId||!valid){if(mode==='control')state.projectSummaries=(await this.get('overview')).projects;return state;}
    const [context,pages,legacy,versions,overview]=await Promise.all([
      this.get('project',{projectId,scope:mode==='control'?'control':'project'}),
      mode==='project'?Promise.all(lanes.map(lane=>this.list('tasks',{projectId,lane,limit:40,...filters}))):null,
      mode==='project'?this.list('jobs',{projectId,limit:20}):null,
      mode==='versions'?this.list('versions',{projectId,limit:20,search:filters.search??''}):null,
      mode==='control'?this.get('overview'):null
    ]);
    Object.assign(state,context,{capture:{...status.capture,...context.capture},sync:{...status.sync,...context.sync}});
    if(overview)state.projectSummaries=overview.projects;
    const taskMap=new Map(),jobMap=new Map();
    const mergeTask=(t,listed=false)=>{const old=taskMap.get(t.id);taskMap.set(t.id,{...old,...t,_listed:listed||old?._listed||false,_reference:!(listed||old?._listed)});};
    for(const t of context.references??[])mergeTask(t);for(const j of context.jobs??[])jobMap.set(j.id,j);
    if(mode==='project'){
      pages.forEach((page,index)=>{state.query.pages[lanes[index]]=page;state.query.counts=page.counts;state.query.projectTotal=page.projectTotal;page.related.forEach(t=>mergeTask(t));page.items.forEach(t=>mergeTask(t,true));page.jobs.forEach(j=>jobMap.set(j.id,j));});
      state.legacyJobs=legacy.items;state.query.legacy=legacy;
    }
    if(mode==='versions'){state.versionRecords=versions.items;state.query.versions=versions;}
    for(const t of this.choices.get(projectId)??[])if(!taskMap.has(t.id))mergeTask(t);
    for(const id of new Set([...selectedIds,...(detailId?[detailId]:[])])){
      try{const detail=await this.detail(projectId,id);mergeTask(detail.task);if(detail.job)jobMap.set(detail.job.id,detail.job);}
      catch(e){if(e.status!==404)throw e;this.details.delete(projectId+':'+id);taskMap.delete(id);}
    }
    if(detailId&&this.histories.has(projectId+':'+detailId)){
      const history=await this.history(projectId,detailId);for(const owner of history.owners??[])mergeTask(owner);for(const job of history.items)jobMap.set(job.id,job);state.query.history={...history,_taskId:detailId};
    }
    state.tasks=[...taskMap.values()];state.jobs=[...jobMap.values()];return state;
  }
}
export function catalogConnectionView(value){
  const health=value.service?.catalogHealthSupported&&value.service.catalogHealth;
  if(!value.caller&&value.workspace?.defaultProjectId)return {connected:false,checking:false,text:'本地模式',reason:'',diagnosticReason:value.connectionError||''};
  if(!health){const connected=!value.connectionError&&!!value.lastSync;return {connected,text:connected?(value.catalogSource==='local-app-server'?'只读目录':'已连接'):'连接异常',reason:value.connectionError??'',checking:false};}
  const connected=health.transport==='connected',checking=health.activities==='checking';
  if(value.activityScope==='panel')return {connected,checking:false,recovering:!connected,text:connected?'已连接':health.transport==='connecting'?'连接中':'本地模式',reason:'',diagnosticReason:health.reason||value.connectionError||''};
  if(value.service.catalogRecoverySupported){
    const recovering=health.recovering||health.activities==='blocked'||!connected;
    const delayed=connected&&recovering&&!!health.reason;
    const connecting=health.transport==='connecting';
    if(value.service.backgroundChecksSupported)return {connected,checking,recovering,text:!connected?(connecting?'连接中':'自动恢复中'):checking||recovering?'后台同步中':'已连接',reason:!connected&&!connecting?'正在连接桌面，任务可先安排，准备就绪后自动执行。':'',diagnosticReason:health.reason||value.connectionError||''};
    return {connected,checking,recovering,text:connecting?'连接中':!connected?'自动恢复中':delayed?'任务状态同步延迟':checking||recovering?'正在核对任务状态':'已连接',reason:connecting?'':!connected?'桌面连接暂时断开，正在自动恢复。任务和草稿已保留。':delayed?'任务状态同步延迟，正在自动重试。可继续查看和编辑，执行前会重新检查。':'',diagnosticReason:health.reason||value.connectionError||''};
  }
  return {connected,checking,text:!connected?'连接断开':checking?'完整核验中':health.activities==='blocked'?'连接正常·核验受阻':health.activities==='verified'?'已连接':'连接正常·待核验',reason:!connected?(value.connectionError||health.reason||'桌面连接不可用'):health.activities==='blocked'?health.reason:''};
}
export function catalogExecutionBlock(value){
  if(value.service?.backgroundChecksSupported)return '';
  if(value.service?.catalogHealthSupported){const view=catalogConnectionView(value);return !view.connected?(value.service.catalogRecoverySupported?'连接正在自动恢复，恢复后可执行':'桌面连接不可用，请刷新连接'):view.checking?'正在检查连接，请稍候':'';}
  return value.catalogSource==='local-app-server'?'本机只读目录可查看任务，派发等待桌面对话列表恢复':'';
}

const key='codex-panel-read-snapshots-v1',limit=1024*1024,ttl=5*60*1000;
const pick=(value,fields)=>Object.fromEntries(fields.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
const fields='id projectId title shortId status tag typeName priority attributes createdAt updatedAt completedAt sectionId boardGroupId parentId dependsOn workflowStage historyOnly sourceKind boardSyncReplica boardSyncPrivateDescription currentJobId lastJobStatus _listed _reference'.split(' ');
const brief=value=>typeof value==='string'?value.slice(0,300):'';
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
export function snapshotData(state,projectId){
  return {tasks:(state.tasks??[]).filter(t=>t.projectId===projectId).slice(0,200).map(t=>({...pick(t,fields),description:brief(t.description)})),
    jobs:(state.jobs??[]).filter(j=>j.projectId===projectId).slice(0,200).map(j=>({...pick(j,'id taskId projectId status createdAt finishedAt awaitingUser'.split(' ')),result:brief(j.result)})),
    taskSections:(state.taskSections??[]).filter(s=>s.projectId===projectId).map(s=>pick(s,['id','projectId','name'])),
    taskGroups:(state.taskGroups??[]).filter(group=>group.projectId===projectId),
    versionRecords:(state.versionRecords??[]).filter(v=>v.projectId===projectId).slice(0,40).map(v=>({...pick(v,'id projectId name commit branch createdAt updatedAt'.split(' ')),summary:brief(v.summary)})),
    query:state.query?{counts:state.query.counts,projectTotal:state.query.projectTotal,pages:{}}:null,
    projectSummaries:(state.projectSummaries??[]).map(p=>({...pick(p,['projectId','label']),counts:Object.fromEntries(['todo','running','review','done'].filter(k=>Number.isInteger(p.counts?.[k])&&p.counts[k]>=0).map(k=>[k,p.counts[k]]))}))};
}
export class PanelSnapshots{
  constructor({storage,now=Date.now}={}){Object.assign(this,{storage,now});}
  entries(instance){try{const raw=this.storage?.getItem(key);if(!raw||raw.length>limit)return [];const saved=JSON.parse(raw);if(saved.version!==1||saved.instance!==instance||!Array.isArray(saved.entries))return [];return saved.entries.filter(e=>typeof e.key==='string'&&Number.isFinite(e.at)&&e.at<=this.now()&&this.now()-e.at<=ttl&&e.data&&typeof e.data==='object').slice(-8);}catch{return [];}}
  get(route,instance,projectId){const entry=this.entries(instance).find(e=>e.key===route&&e.projectId===projectId);return entry?{...snapshotData(entry.data,projectId),_snapshot:true}:null;}
  put(route,instance,projectId,state){if(!instance||state._snapshot)return false;try{const data=snapshotData(state,projectId),entry={key:route,projectId,at:this.now(),data};if(bytes(entry)>limit)return false;const entries=this.entries(instance).filter(e=>e.key!==route);entries.push(entry);while(entries.length>8)entries.shift();const value={version:1,instance,entries};while(bytes(value)>limit&&entries.length>1)entries.shift();this.storage?.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
}
