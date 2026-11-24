import {createHash} from 'node:crypto';
import {presentTask} from './source-display.mjs';
import {instructionHash} from './execution.mjs';
import {attributesOf} from './properties.mjs';
import {dependencySatisfied} from './core.mjs';
import {groupRounds,roundIdOf,executionSuggestion} from './public/rounds.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('base64url');
const normalize=value=>String(value??'').replaceAll('/','\\').replace(/\\+$/,'').toLowerCase();
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const taskFields='id projectId title shortId status tag typeName priority attributes createdAt updatedAt completedAt archivedAt sectionId boardGroupId parentId dependsOn pendingDependencies pendingParentId workflowStage historyOnly sourceKind sourceIds execution syncReserved currentJobId lastJobStatus delivery autoProperties pendingContinuation initialDispatch createRequestId boardSyncReplica boardSyncPrivateDescription'.split(' ');
const jobFields='id taskId projectId status createdAt finishedAt title threadId turnId origin deliveryKind message error modelKey modelLabel modelActual modelMismatch roundId continuedFromJobId inputKind awaitingUser modelTarget modelProvider modelRouted routeMessage'.split(' ');
const taskSummary=t=>({...pick(t,taskFields),executionRevision:instructionHash(t),description:presentTask({...t,history:undefined}).description?.slice(0,300)??'',_partial:true});
const jobSummary=j=>({...pick(j,jobFields),_partial:true});
const jobDetail=j=>({...pick(j,[...jobFields,'prompt','result','finalResult','attachments']),...(j.routedPrompt!==undefined?{prompt:j.routedPrompt}:{})});
const reference=t=>({...pick(t,'id projectId title shortId status archivedAt parentId dependsOn workflowStage sectionId currentJobId'.split(' ')),_reference:true});
const statuses=['todo','running','review','done'];

// A shared read index over the committed immutable view. Both JSON and the
// SQLite adapter publish this view only after durable commit; readers never
// inspect a reducer's draft or independently reopen a production database.
export class PanelQueries{
  #state; #catalog; #jobProjects; #projects; #tasks; #jobs; #cache=new Map();
  update(state,catalog){
    if(this.#state===state&&this.#catalog===catalog)return;this.#state=state;this.#catalog=catalog;this.#cache.clear();this.#jobProjects=new Map();
    this.#projects=new Map();this.#tasks=new Map();this.#jobs=new Map();
    const paths=new Map([...Object.entries(state.workspace?.mappings??{}).map(([id,p])=>[normalize(p.path),id]),...(catalog??[]).map(p=>[normalize(p.path),p.projectId])].filter(([p])=>p));
    const project=id=>{if(!this.#projects.has(id))this.#projects.set(id,{tasks:[],jobs:[],versions:[],scheduled:new Set(),bySection:new Map(),children:new Map(),dependents:new Map()});return this.#projects.get(id);};
    for(const p of state.automation?.plans??[])if(['active','paused'].includes(p.status))for(const n of p.nodes)if(!n.jobId&&!n.skipped)project(p.projectId).scheduled.add(n.taskId);
    for(const t of state.tasks){this.#tasks.set(t.id,t);const p=project(t.projectId);p.tasks.push(t);if(t.parentId){if(!p.children.has(t.parentId))p.children.set(t.parentId,[]);p.children.get(t.parentId).push(t);}for(const id of t.dependsOn??[]){if(!p.dependents.has(id))p.dependents.set(id,[]);p.dependents.get(id).push(t);}}
    for(const j of state.jobs){this.#jobs.set(j.id,j);const projectId=j.projectId??paths.get(normalize(j.path));this.#jobProjects.set(j.id,projectId);const p=project(projectId);p.jobs.push(j);const owner=this.#tasks.get(j.taskId),key=owner?.sectionId??'task:'+j.taskId;if(!p.bySection.has(key))p.bySection.set(key,[]);p.bySection.get(key).push(j);}
    for(const v of state.versionRecords??[])if(!v.deletedAt)project(v.projectId).versions.push(v);
  }
  task(projectId,id){const t=this.#tasks.get(id);if(!t||t.projectId!==projectId)fail(404,'任务不存在或不属于本项目');return t;}
  lane(t,p){return t.status==='todo'&&p.scheduled.has(t.id)?'running':t.status;}
  project(id){return this.#projects.get(id)??{tasks:[],jobs:[],versions:[],scheduled:new Set(),bySection:new Map(),children:new Map(),dependents:new Map()};}
  page(rows,params,scope,revision=hash(rows)){
    const limit=Number(params.get('limit')??50);if(!Number.isInteger(limit)||limit<1||limit>200)fail(400,'分页数量须为1–200');
    let offset=0;const cursor=params.get('cursor');
    if(cursor){try{const value=JSON.parse(Buffer.from(cursor,'base64url').toString());if(value.scope!==scope||value.revision!==revision)fail(409,'列表已变化，请重新读取第一页');if(!Number.isSafeInteger(value.offset)||value.offset<0||value.offset>rows.length)fail(400,'分页游标无效');offset=value.offset;}catch(e){if(e.status)throw e;fail(400,'分页游标无效');}}
    const next=offset+limit;return {items:rows.slice(offset,next),total:rows.length,revision,cursor:next<rows.length?Buffer.from(JSON.stringify({scope,revision,offset:next})).toString('base64url'):null,offset};
  }
  query(kind,params){
    const key=kind+'?'+params.toString();if(this.#cache.has(key))return this.#cache.get(key);
    const result=this.#query(kind,params);if(this.#cache.size>=200)this.#cache.delete(this.#cache.keys().next().value);this.#cache.set(key,result);return result;
  }
  #query(kind,params){
    // Include authoritative readiness even when the predecessor is off-page.
    const ready=t=>dependencySatisfied(t,[this.#jobs.get(t.currentJobId)].filter(Boolean));
    const summary=t=>({...taskSummary(t),dependencyCompleted:ready(t)});
    const relatedTask=t=>({...reference(t),dependencyCompleted:ready(t)});
    if(kind==='overview')return {projects:[...this.#projects].filter(([id])=>id).map(([projectId,p])=>({projectId,total:p.tasks.filter(t=>!t.archivedAt).length,counts:Object.fromEntries(statuses.map(status=>[status,p.tasks.filter(t=>!t.archivedAt&&this.lane(t,p)===status).length]))}))};
    const projectId=params.get('projectId');if(!projectId)fail(400,'请指定项目');const p=this.project(projectId),id=params.get('id');
    const scope=kind+':'+JSON.stringify([...params].filter(([k])=>!['cursor','limit'].includes(k)).sort());
    if(kind==='plan-context'){
      const nodes=(this.#state.automation?.plans??[]).filter(p=>p.projectId===projectId).slice(-30).flatMap(p=>p.nodes),ids=new Set(nodes.map(n=>n.taskId));
      return {projectCommands:p.tasks.filter(t=>!t.archivedAt&&t.status!=='done'&&/^(workflow-prepare|github-upload)-/.test(t.createRequestId??'')).map(taskSummary),references:p.tasks.filter(t=>ids.has(t.id)).map(relatedTask),jobs:nodes.map(n=>this.#jobs.get(n.jobId)).filter(j=>j?.projectId===projectId).map(jobSummary)};
    }
    if(kind==='tasks'){
      const lane=params.get('lane'),status=params.get('status'),sort=params.get('sort')??'priority',priority=params.get('priority');
      if((lane&&!statuses.includes(lane))||(status&&!statuses.includes(status))||!['priority','priority-reverse','newest','oldest'].includes(sort))fail(400,'列表筛选无效');
      if(priority!==null&&priority!==''&&!/^[0-3]$/.test(priority))fail(400,'优先级无效');
      let attrs;try{attrs=JSON.parse(params.get('attributes')??'{}');if(!attrs||Array.isArray(attrs)||typeof attrs!=='object')throw Error();}catch{fail(400,'属性筛选无效');}
      const all=p.tasks.filter(t=>!t.archivedAt),filtered=all.filter(t=>(!status||t.status===status)&&(priority===null||priority===''||(t.priority??2)===Number(priority))&&Object.entries(attrs).every(([g,o])=>!o||(o==='@none'?!attributesOf(t).some(a=>a.groupId===g):attributesOf(t).some(a=>a.groupId===g&&a.optionId===o))));
      const rows=filtered.filter(t=>!lane||this.lane(t,p)===lane).sort((a,b)=>(sort==='priority'?(a.priority??2)-(b.priority??2):sort==='priority-reverse'?(b.priority??2)-(a.priority??2):0)||(sort==='oldest'?String(a.createdAt??'').localeCompare(b.createdAt??''):String(b.createdAt??'').localeCompare(a.createdAt??''))||a.id.localeCompare(b.id));
      p.listRevision??=hash([p.tasks.map(taskSummary),p.tasks.map(t=>this.#jobs.get(t.currentJobId)).filter(Boolean).map(jobSummary),[...p.scheduled]]);
      const summaries=rows.map(summary),page=this.page(summaries,params,scope,p.listRevision),related=new Map();
      // Relations are lookup DTOs, never additional visible cards or bodies.
      const visit=t=>{if(!t||t.projectId!==projectId||related.has(t.id))return;related.set(t.id,relatedTask(t));for(const d of t.dependsOn??[])visit(this.#tasks.get(d));};
      for(const t of page.items){visit(this.#tasks.get(t.id));for(const child of p.children.get(t.id)??[])visit(child);for(const next of p.dependents.get(t.id)??[])visit(next);}
      const groupCounts=new Map();
      for(const task of rows){const id=task.boardGroupId??'';groupCounts.set(id,(groupCounts.get(id)??0)+1);}
      return {...page,related:[...related.values()],jobs:page.items.map(t=>this.#jobs.get(t.currentJobId)).filter(j=>j?.projectId===projectId).map(jobSummary),counts:Object.fromEntries(statuses.map(s=>[s,filtered.filter(t=>this.lane(t,p)===s).length])),groupCounts:Object.fromEntries(groupCounts),projectTotal:all.length};
    }
    if(kind==='choices')return this.page(p.tasks.filter(t=>!t.archivedAt).map(reference),params,scope);
    if(kind==='task'){
      const t=this.task(projectId,id),{history,jobIds,...body}=presentTask(t),job=this.#jobs.get(t.currentJobId);
      const rounds=groupRounds(p.bySection.get(t.sectionId??'task:'+t.id)??[]);
      const completionReceipt=history?.findLast(e=>e.type==='delivery-reconciled');
      const reviewReceipt=history?.findLast(e=>e.type==='approved'&&e.jobId===t.currentJobId);
      const returned=t.status==='todo'&&!t.currentJobId?this.#jobs.get(history?.findLast(e=>e.type==='returned')?.jobId):null;
      if(returned?.taskId===t.id&&returned.projectId===projectId)body.returnedResult=jobDetail(returned);
      return {task:{executionRevision:instructionHash(t),...body,...(completionReceipt?{completionReceipt}:{}),...(reviewReceipt?{reviewReceipt}:{}),_partial:false,roundCount:rounds.length,historyCount:history?.length??0,jobCount:jobIds?.length??0},job:job?.projectId===projectId?{...jobDetail(job),suggestion:executionSuggestion(job.finalResult??job.result),_stepCount:rounds.find(r=>r.roundId===roundIdOf(job)&&r.job.taskId===job.taskId)?.steps.length??1,_roundIndex:rounds.findIndex(r=>r.roundId===roundIdOf(job)&&r.job.taskId===job.taskId)}:null};
    }
    if(kind==='history'){
      const t=this.task(projectId,id),rows=groupRounds(p.bySection.get(t.sectionId??'task:'+t.id)??[]).reverse().map(r=>({...jobDetail(r.job),roundId:r.roundId,_stepCount:r.steps.length,_roundCreatedAt:r.createdAt}));
      const reviews=[...new Set(rows.map(j=>j.taskId))].map(id=>[id,(this.#tasks.get(id)?.history??[]).filter(e=>['approved','returned'].includes(e.type))]),page=this.page(rows,params,scope,hash([rows,reviews]));
      return {...page,items:page.items.map((j,i)=>({...j,_roundIndex:page.total-page.offset-i-1})),owners:[...new Set(page.items.map(j=>j.taskId))].map(key=>{const owner=this.#tasks.get(key);return {...reference(owner),history:(owner.history??[]).filter(e=>['approved','returned'].includes(e.type)&&page.items.some(j=>j.id===e.jobId))};})};
    }
    if(kind==='round-steps'){
      const t=this.task(projectId,id),roundId=params.get('roundId');
      const rows=p.jobs.filter(j=>j.taskId===t.id&&roundIdOf(j)===roundId).sort((a,b)=>String(a.createdAt??'').localeCompare(b.createdAt??'') ).map(jobDetail);
      if(!rows.length)fail(404,'本轮记录不存在或不属于当前任务');
      return this.page(rows,params,scope);
    }
    if(kind==='events'){const t=this.task(projectId,id);return this.page([...(t.history??[])].reverse(),params,scope);}
    if(kind==='jobs')return this.page(p.jobs.filter(j=>!j.taskId).map(j=>({...jobSummary(j),projectId})).reverse(),params,scope);
    if(kind==='job'){const j=this.#jobs.get(id);if(!j||this.#jobProjects.get(id)!==projectId)fail(404,'执行记录不存在或不属于本项目');return {job:{...jobDetail(j),projectId}};}
    if(kind==='versions'){
      const search=(params.get('search')??'').toLocaleLowerCase();return this.page(p.versions.filter(v=>!search||[v.name,v.summary,v.ref,v.commit].some(x=>x?.toLocaleLowerCase().includes(search))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)),params,scope);
    }
    fail(404,'查询接口不存在');
  }
}

const representations=new WeakMap();
export function conditionalJSON(req,res,value){
  let representation=representations.get(value);
  if(!representation){const text=JSON.stringify(value);representation={text,etag:'"'+createHash('sha256').update(text).digest('base64url')+'"'};representations.set(value,representation);}
  const {text,etag}=representation;
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-cache','ETag':etag,'Vary':'X-Panel-Token'};
  if(req.headers['if-none-match']?.split(',').map(v=>v.trim()).includes(etag)){res.writeHead(304,headers);return res.end();}
  res.writeHead(200,headers);res.end(text);
}
