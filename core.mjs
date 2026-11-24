import {handoffPending,handoffLockReason} from './handoff-state.mjs';
import {scopeConflict} from './execution-scope.mjs';
import {modelKeyOf,modelLabel} from './model-routing.mjs';
import {awaitsReply} from './public/rounds.js';
import {messageText,sameDispatchText,CURRENT_THREAD_DELIVERY,dispatchQueueJobs,trackedCurrentThread,steeringCurrentThread,steeringInputIndex,taskIdCurrentThread} from './dispatch-state.mjs';
export const normalize=p=>(p??'').replaceAll('/','\\').replace(/\\+$/,'').toLowerCase();
export const sourcePathOf=project=>project.sourcePath||project.path;
// Source roots are local queue projections. Never change the durable entry
// path: thread ownership and replayed delivery payloads still use that path.
export function sourceAwareJob(state,job){
  const {sourcePath,...value}=job,mapping=state.workspace?.mappings?.[job.projectId];
  return mapping?.sourcePath&&normalize(mapping.path)===normalize(job.path)?{...value,sourcePath:mapping.sourcePath}:value;
}
export function sourceAwareJobs(state,jobs=dispatchQueueJobs(state)){return jobs.map(job=>sourceAwareJob(state,job));}
export function sourcePathsOverlap(a,b){
  const roots=value=>[value.path,value.sourcePath].map(normalize).filter(Boolean);
  return roots(a).some(left=>roots(b).some(right=>left===right||left.startsWith(right+'\\')||right.startsWith(left+'\\')));
}
function queuedSourceView(job,jobs){
  if(!job)return job;
  const current=jobs.find(row=>row.id===job.id&&row.projectId===job.projectId&&normalize(row.path)===normalize(job.path));
  return current?.sourcePath?{...job,sourcePath:current.sourcePath}:job;
}
const queuePayload=job=>{const {sourcePath,...payload}=job;return JSON.stringify(payload);};
export const busy=s=>['active','running','inProgress','waitingForApproval','waitingForInput'].includes(typeof s==='string'?s:s?.type);
// Several cards may observe one desktop turn. Count its confirmed execution
// once, while uncorrelated deliveries and unresolved intents keep their slots.
export function executionSlotCount(jobs){
  const turns=new Set();let count=0;
  for(const job of jobs){
    if(['submitted','running'].includes(job.status)&&[job.projectId,job.path,job.threadId,job.turnId].every(value=>typeof value==='string'&&value.trim())){
      const key=JSON.stringify([job.projectId,normalize(job.path),job.threadId,job.turnId]);
      if(turns.has(key))continue;
      turns.add(key);
    }
    count++;
  }
  return count;
}
export function matchingTurn(turns,job){
  if(trackedCurrentThread(job)){
    let candidates=turns;
    if(taskIdCurrentThread(job)&&!job.turnId&&job.baseline!=null){
      const baseline=turns.findIndex(turn=>turn.id===job.baseline);
      if(baseline<0)return undefined;
      candidates=turns.slice(0,baseline);
    }
    const matches=candidates.filter(t=>(!job.turnId||t.id===job.turnId)&&steeringInputIndex(t,job)>=0);
    return matches.length===1?matches[0]:undefined;
  }
  if(job.turnId)return turns.find(t=>t.id===job.turnId);
  if(job.dispatchVersion===2){
    const index=turns.findIndex(t=>t.id===job.baseline),fresh=job.deliveryKind==='create'?turns:index<0?[]:turns.slice(0,index);
    const matches=fresh.filter(t=>t.items?.some(i=>(i.type==='userMessage'||i.type==='functionCallOutput'&&/^(?:.*__)?(?:send_message_to_thread|create_thread)$/.test(i.name??''))&&sameDispatchText(messageText(i),job.routedDispatchPrompt??job.dispatchPrompt)));
    return matches.length===1?matches[0]:undefined;
  }
  if(job.correlationToken){
    const matches=turns.filter(t=>t.items?.some(i=>['userMessage','functionCallOutput'].includes(i.type)&&JSON.stringify(i).includes(job.correlationToken)));
    return matches.length===1?matches[0]:undefined;
  }
  const index=turns.findIndex(t=>t.id===job.baseline);
  // Only inspect turns after the recorded baseline; never reuse a previous reply.
  const fresh=index<0?[]:turns.slice(0,index).reverse();
  const matches=fresh.filter(t=>t.items?.some(i=>(i.type==='userMessage'&&i.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n')===job.prompt)||(!job.prompt&&i.type==='functionCallOutput'&&i.name==='send_message_to_thread'&&i.namespace==='codex_app')));
  return matches.length===1?matches[0]:undefined;
}
export function summarize(turn){const messages=(turn.items??[]).filter(i=>i.type==='agentMessage');const final=messages.filter(i=>['final','final_answer'].includes(i.phase));return (final.length?final:messages).map(i=>i.text??'').join('\n\n');}
// Missing model evidence preserves prior flags.
export function jobTurnPatch(job,turn,models){
  let currentThreadActiveObserved;
  if(trackedCurrentThread(job)){
    const index=steeringInputIndex(turn,job);
    if(index<0)return {status:job.status==='uncertain'?'uncertain':'submitted',message:'已提交，等待本次输入与回复关联'};
    turn={...turn,items:turn.items.slice(index+1)};
    // A steer may share a turn with an earlier final. Only replies following
    // this exact submitted input can complete its card.
    const status=turn.status?.type??turn.status,hasFinal=turn.items.some(i=>i.type==='agentMessage'&&['final','final_answer'].includes(i.phase));
    currentThreadActiveObserved=job.currentThreadActiveObserved===true||busy(status);
    if(['completed','failed','interrupted'].includes(status)&&!hasFinal&&(status==='completed'||!job.currentThreadActiveObserved))return {turnId:turn.id,status:status==='completed'?'submitted':'uncertain',message:'本次输入已关联，原轮终态尚不能证明本次结果；不会重发'};
  }
  const rawStatus=turn.status?.type??turn.status,status=['completed','failed','interrupted'].includes(rawStatus)?rawStatus:'running',at=new Date().toISOString();
  const patch={turnId:turn.id,error:'',lastSeenAt:at,status,message:status==='running'?'原 Codex 对话正在执行':'对话已结束；请查看回复中的验证结论'};
  if(currentThreadActiveObserved!==undefined)patch.currentThreadActiveObserved=currentThreadActiveObserved;
  const final=status==='running'?'':(turn.items??[]).filter(i=>i.type==='agentMessage'&&['final','final_answer'].includes(i.phase)).map(i=>i.text??'').join('\n\n');
  if(status!=='running')Object.assign(patch,{finishedAt:at,result:final,finalResult:final});
  patch.awaitingUser=rawStatus==='waitingForInput'||status==='completed'&&awaitsReply(final);
  if(patch.awaitingUser)patch.message='等待你的回复';
  if(turn.model){const actual=modelKeyOf(turn.model,models);patch.modelActual=turn.model;patch.modelMismatch=job.modelKey&&actual&&actual!==job.modelKey?'本轮实际由「'+modelLabel(actual,models)+'」执行，登记为「'+modelLabel(job.modelKey,models)+'」':'';}
  return patch;
}
export async function readJobTurn(readPage,job,maxPages=6){
  const turns=[],seen=new Set();let cursor;
  for(let page=0;page<maxPages;page++){
    const response=await readPage(job.threadId,cursor);
    for(const turn of response.turns??[])if(!seen.has(turn.id)){seen.add(turn.id);turns.push(turn);}
    const match=matchingTurn(turns,job);if(match&&(job.turnId||seen.has(job.baseline)||job.dispatchVersion===2&&job.deliveryKind==='create'))return {turn:match,pages:page+1};
    if(!job.correlationToken&&!job.turnId&&seen.has(job.baseline))return {pages:page+1,reason:'基线后的轮次无法唯一关联，请核对原对话'};
    const next=response.page?.nextCursor;
    if(!next)return match?{turn:match,pages:page+1}:{pages:page+1,reason:taskIdCurrentThread(job)?'尚未在发送后的轮次找到本次任务消息，保留未确认状态':'尚未找到本轮唯一标识，保留未确认状态'};
    if(next===cursor)return {pages:page+1,reason:'历史游标重复，保留未确认状态'};
    cursor=next;
  }
  return {pages:maxPages,reason:'历史已超出本次检索范围，请打开原对话核对；不会误收旧回复'};
}
export function setBinding(state,input,catalog){
  if(!catalog.projects.some(p=>p.projectId===input.projectId))throw new Error('项目不存在');
  if(input.threadId===''){delete state.bindings[input.projectId];return;}
  const {project,thread}=validateBinding(input,catalog.projects,catalog.threads);state.bindings[project.projectId]=thread.id;
}
// Owned queue locks are authoritative in panel scope. In both scopes a
// successful local precheck still requires a fresh read of the target.
export function queuedJobLocalReason(job,{jobs,tasks=[],plans=[],bindings,validateJob,catalogSource}){
  job=queuedSourceView(job,jobs);
  if(job?.status!=='queued')return '任务已取消或执行状态已变化';
  if(job.taskId&&job.deliveryKind!==CURRENT_THREAD_DELIVERY&&!job.autoPlanId&&!job.reviewedJobId&&bindings&&bindings[job.projectId]!== (job.requestedThreadId??job.threadId))return '执行对话绑定已变化，请重新绑定原对话或取消排队后重新安排';
  const handoff=handoffLockReason(tasks,job,job);if(handoff)return handoff;
  const changed=validateJob?.(job);if(changed)return changed;
  if(job.autoPlanId&&plans.find(p=>p.id===job.autoPlanId)?.status!=='active')return '自动计划已暂停';
  if((job.dependencyIds??[]).some(id=>!dependencySatisfied(tasks.find(t=>t.id===id),jobs,job.dependencyGate)))return '等待前置任务满足放行条件';
  const active=jobs.filter(j=>['sending','submitted','running','uncertain'].includes(j.status));
  if(active.some(j=>(job.operation==='project-adopt'||j.operation==='project-adopt')&&sourcePathsOverlap(job,j)))return '项目接入占用整个仓库，等待相关目录空闲';
  if(catalogSource!=='panel-managed'&&executionSlotCount(active)>=2)return '等待执行空位';
  const conflict=active.filter(j=>sourcePathsOverlap(job,j)).filter(j=>!(steeringCurrentThread(job)&&j.taskId&&j.turnId&&['submitted','running'].includes(j.status)&&j.threadId===job.threadId&&j.projectId===job.projectId&&normalize(j.path)===normalize(job.path)&&!j.operation&&!j.connectionTest&&!relatedTasks(job,j,tasks))).map(j=>parallelConflict(job,j,tasks)).find(Boolean);if(conflict)return conflict;
  return '';
}
export function queuedJobReason(job,context){
  const {jobs,threads,tasks=[],catalogSource}=context;
  job=queuedSourceView(job,jobs);
  if(job?.status!=='queued')return '任务已取消或执行状态已变化';
  if(catalogSource==='local-app-server')return '桌面对话列表暂不可用；本机只读目录可查看任务，派发等待桌面恢复';
  const local=queuedJobLocalReason(job,context);if(local)return local;
  const active=jobs.filter(j=>['sending','submitted','running','uncertain'].includes(j.status));
  if(catalogSource!=='panel-managed'&&!job.connectionTest&&threads.some(t=>(job.sourcePath?sourcePathsOverlap(job,{path:t.cwd}):normalize(t.cwd)===normalize(job.path))&&busy(t.status)&&!active.some(j=>j.threadId===t.id&&parallelCompatible(job,j,tasks))))return '项目有未纳入并行关系的对话执行，等待空闲';
  return '';
}
export async function prepareQueuedJob(job,getQueue,read){
  const initial=queuePayload(job),id=job.id;let initialSource;
  const blockReason=()=>{
    const {jobs,threads,tasks=[],plans=[],bindings,validateJob,models,catalogSource}=getQueue();
    const current=jobs.find(row=>row.id===id);
    if(current?.status!=='queued')return '任务已取消或执行状态已变化';
    if(queuePayload(current)!==initial)return '任务信息已变化，请重新核对';
    const source=normalize(current.sourcePath);if(initialSource!==undefined&&source!==initialSource)return '源码目录关联已变化，请重新核对';initialSource=source;
    job=current;
    return queuedJobReason(job,{jobs,threads,tasks,plans,bindings,validateJob,models,catalogSource});
  };
  let message=blockReason();if(message)return {ready:false,message};
  const before=await read(job.threadId);
  // A cancellation or a newly active project can arrive while read is pending.
  message=blockReason();if(message)return {ready:false,message};
  message=queuedThreadReason(job,before);if(message)return {ready:false,message};
  return {ready:true,before};
}
export function queuedThreadReason(job,before){
  if(job.operation==='handoff-summary'&&before.turns?.[0]?.id!==job.handoffSourceTurnId)return '原对话轮次已变化，请取消旧接续后核对';
  const thread=before?.thread,status=typeof thread?.status==='string'?thread.status:thread?.status?.type;
  if(thread?.id!==job.threadId||!thread.cwd||normalize(thread.cwd)!==normalize(job.path)||(thread.kind&&thread.kind!=='codex')||(thread.hostId&&thread.hostId!=='local'))return '无法确认执行对话及项目，请刷新后核对';
  if(steeringCurrentThread(job)){
    if(status==='waitingForApproval'||before.turns?.some(t=>(t.status?.type??t.status)==='waitingForApproval'))return '原对话正在等待审批，请先在 Codex 处理';
    if(status==='idle')return '';
    if(['active','running','inProgress','waitingForInput'].includes(status)&&before.turns?.[0]&&['inProgress','running','waitingForInput'].includes(before.turns[0].status?.type??before.turns[0].status))return '';
  }
  // An unloaded desktop thread can be resumed by send_message_to_thread.
  // Require positive terminal-turn evidence; an empty/unknown history is not idle.
  const ended=Array.isArray(before.turns)&&before.turns.length>0&&before.turns.every(turn=>typeof turn.id==='string'&&turn.id&&['completed','failed','interrupted'].includes(turn.status));
  const unloadedEnded=status==='notLoaded'&&ended;
  const indexedEnded=status==='active'&&thread.activityUnknown===true&&before.source==='local-session-recent'&&before.terminalWindowVerified===true&&ended;
  if(status!=='idle'&&!unloadedEnded&&!indexedEnded)return busy(status)?'等待原对话空闲':'无法确认原对话已空闲，请核对桌面状态';
  if(job.deliveryKind===CURRENT_THREAD_DELIVERY&&before.turns?.some(turn=>busy(turn.status)))return '等待原对话当前轮次结束';
  if(job.deliveryKind===CURRENT_THREAD_DELIVERY&&before.turns?.[0]&&jobTurnPatch(job,before.turns[0]).awaitingUser)return '原对话正在等待你的回复，完成后再发送本任务';
  return '';
}
export function dependencySatisfied(task,jobs,gate='completed'){
  if(!task||handoffPending(task))return false;if(task.status==='done')return true;
  return gate==='completed'&&!task.archivedAt&&task.status==='review'&&jobs.some(j=>j.id===task.currentJobId&&j.taskId===task.id&&j.status==='completed'&&j.turnId&&!j.awaitingUser);
}
export function parallelCompatible(a,b,tasks=[]){
  return !parallelConflict(a,b,tasks);
}
function relatedTasks(a,b,tasks){
  const reaches=(from,to)=>{const seen=new Set(),walk=id=>{if(!id)return false;if(id===to)return true;if(seen.has(id))return false;seen.add(id);const t=tasks.find(t=>t.id===id);return [t?.parentId,...(t?.dependsOn??[])].filter(Boolean).some(walk);};return walk(from);};
  return reaches(a.taskId,b.taskId)||reaches(b.taskId,a.taskId);
}
export function parallelConflict(a,b,tasks=[]){
  const left=normalize(a.path),right=normalize(b.path),sameProject=left===right;
  if(!sourcePathsOverlap(a,b))return '';
  if(a.syncReceipt||b.syncReceipt)return '同项目或关联源码的同步回执待核对';
  if(a.status==='uncertain'||b.status==='uncertain')return '存在未决执行，等待核对';
  if(a.sourcePath||b.sourcePath)return '源码目录关联占用整个仓库，等待相关目录空闲';
  if(!a.allowParallel||!b.allowParallel)return '同项目任务按顺序执行，等待上一项结束';
  if(!a.workUnit||!b.workUnit||a.workUnit===b.workUnit||a.threadId===b.threadId)return '同版块或同对话需要顺序执行';
  if(relatedTasks(a,b,tasks))return '存在任务依赖或父子关系，等待顺序执行';
  if(sameProject)return scopeConflict(a.writePaths,b.writePaths);
  const root=left.length<right.length?left:right,scopes=job=>{const prefix=normalize(job.path).slice(root.length).replaceAll('\\','/').replace(/^\//,'');return (job.writePaths??[]).map(entry=>(prefix?prefix+'/':'')+entry);};
  return scopeConflict(scopes(a),scopes(b));
}
export function validateBinding(item,projects,threads){
  const project=projects.find(p=>p.projectId===item.projectId),thread=threads.find(t=>t.id===item.threadId);
  if(!project?.path||!thread?.cwd||(project.hostId&&project.hostId!=='local')||thread.kind!=='codex'||thread.hostId!=='local'||normalize(project.path)!==normalize(thread.cwd))throw new Error('项目与对话不匹配，请刷新后重新选择');
  return {project,thread};
}
export function validateBatch(items,projects,threads){
  if(!Array.isArray(items)||!items.length||items.length>20)throw new Error('请选择 1–20 个项目');
  const seen=new Set();
  return items.map(item=>{
    const {project:p,thread:t}=validateBinding(item,projects,threads);
    if(seen.has(t.id))throw new Error('同一批次不能重复选择相同对话');seen.add(t.id);
    const prompt=item.prompt?.trim();if(!prompt||prompt.length>30000)throw new Error('指令不能为空且不能超过 30,000 字符');
    return {projectId:p.projectId,project:p.label,path:p.path,threadId:t.id,title:t.title,prompt};
  });
}
