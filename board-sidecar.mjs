import {normalize} from './core.mjs';

export function initializeSidecars(state){
  state.boards??={mode:'off',projectIds:[],attachments:{}};
  if(!['off','selected','all'].includes(state.boards.mode)||!Array.isArray(state.boards.projectIds)||!state.boards.attachments||typeof state.boards.attachments!=='object')throw new Error('项目看板挂载配置无效，已停止加载以保护记录');
  for(const attachment of Object.values(state.boards.attachments))if(attachment.status==='attaching'){
    attachment.status='failed';attachment.error='上次挂载未确认；不会自动重试，可手动重试';
  }
}

const enabled=(boards,projectId)=>boards.mode==='all'||(boards.mode==='selected'&&boards.projectIds.includes(projectId));

// Codex may restore its tabs after a restart. A new pipe is not evidence that
// a confirmed panel was closed; keep receipts until explicit recreation.
export function restoreSidecarSession(state,sessionId){
  if(!sessionId||state.boards.desktopSession===sessionId)return false;
  state.boards.desktopSession=sessionId;
  return true;
}

export function configureSidecars(state,input,catalog,enable){
  const boards=state.boards;
  if(input.all===true){boards.mode=enable?'all':'off';boards.projectIds=[];return;}
  if(typeof input.projectId!=='string'||!catalog.projects.some(p=>p.projectId===input.projectId))throw new Error('请选择有效项目');
  if(enable){
    if(boards.mode==='all')return;
    boards.mode='selected';boards.projectIds=[...new Set([...boards.projectIds,input.projectId])];
  }else{
    boards.projectIds=(boards.mode==='all'?catalog.projects.map(p=>p.projectId):boards.projectIds).filter(id=>id!==input.projectId);
    boards.mode=boards.projectIds.length?'selected':'off';
  }
}

export function retrySidecars(state,input,catalog){
  if(typeof input.projectId!=='string'||!catalog.projects.some(p=>p.projectId===input.projectId)||!enabled(state.boards,input.projectId))throw new Error('请先启用此项目的右侧看板');
  for(const [key,attachment] of Object.entries(state.boards.attachments))if(attachment.projectId===input.projectId&&attachment.status==='failed')delete state.boards.attachments[key];
}

export function sidecarCandidates(state,catalog,origin){
  const candidates=[];
  for(const project of catalog.projects){
    if(!project.path||project.offlineOnly||!enabled(state.boards,project.projectId))continue;
    for(const thread of catalog.threads){
      if(thread.kind!=='codex'||thread.hostId!=='local'||normalize(thread.cwd)!==normalize(project.path))continue;
      const key=JSON.stringify([project.projectId,thread.id]);
      if(state.boards.attachments[key])continue;
      const url=new URL('/',origin);url.searchParams.set('projectId',project.projectId);url.searchParams.set('threadId',thread.id);
      // 对话侧栏默认项目看板；历史总控地址由面板在加载时纠正，不再给总控项目写 view=control。
      candidates.push({key,projectId:project.projectId,threadId:thread.id,url:url.href});
    }
  }
  return candidates;
}

// One serialized writer reserves each task before calling the desktop. Successful
// and failed attempts stay recorded so ordinary refreshes never reopen its tab.
export class BoardSidecars{
  constructor({getState,getCatalog,mutate,open,origin}){Object.assign(this,{getState,getCatalog,mutate,open,origin});this.running=null;this.requests=new Map();this.error='';}
  attach(candidate,{recreate=false}={}){
    const {key,...attachment}=candidate;
    if(this.requests.has(key))return this.requests.get(key);
    const request=Promise.resolve().then(async()=>{
      const existing=this.getState().boards.attachments[key];
      if(existing&&!recreate){
        if(['queued','attached'].includes(existing.status))return {...existing,reused:true};
        throw Error('上次侧栏打开未确认；请核对后选择重新创建。');
      }
      await this.mutate(draft=>{draft.boards.attachments[key]={...attachment,status:'attaching',attemptedAt:new Date().toISOString()};});
      let result;
      try{
        const receipt=await this.open({threadId:attachment.threadId,target:{type:'browser',url:attachment.url},placement:'right'});
        result=receipt?.status==='queued'?{status:'queued',receipt}:receipt?.status==='opened'?{status:'attached',receipt}:{status:'failed',receipt,error:'桌面未返回可识别的挂载确认，请核对后手动重试'};
      }catch(error){result={status:'failed',error:error.message};}
      await this.mutate(draft=>{Object.assign(draft.boards.attachments[key],result,{updatedAt:new Date().toISOString()});});
      return {...attachment,...result};
    }).finally(()=>{if(this.requests.get(key)===request)this.requests.delete(key);});
    this.requests.set(key,request);return request;
  }
  snapshot(){
    const boards=this.getState().boards,summary={attached:0,queued:0,failed:0,attaching:0};
    for(const item of Object.values(boards.attachments))if(item.status in summary)summary[item.status]++;
    return {...boards,summary,error:this.error};
  }
  synchronize(){
    if(this.running)return this.running;
    this.running=this.run().catch(error=>{this.error=error.message;}).finally(()=>{this.running=null;});
    return this.running;
  }
  async run(){
    this.error='';
    for(;;){
      const candidate=sidecarCandidates(this.getState(),this.getCatalog(),this.origin)[0];if(!candidate)return;
      await this.attach(candidate);
    }
  }
}
