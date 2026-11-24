// Local delivery evidence is deliberately separate from visible task text.
export const CURRENT_THREAD_DELIVERY='current-thread';
export const CURRENT_THREAD_TASK_ID_VERSION=3;
export const trackedCurrentThread=job=>job?.deliveryKind===CURRENT_THREAD_DELIVERY&&['queue','steer'].includes(job.currentThreadMode);
export const steeringCurrentThread=job=>trackedCurrentThread(job)&&job.currentThreadMode==='steer';
export const taskIdCurrentThread=job=>trackedCurrentThread(job)&&job.currentThreadMode==='queue'&&job.dispatchVersion===CURRENT_THREAD_TASK_ID_VERSION;
export const taskIdHeader=id=>'[任务 ID：'+id+']\n';
export function steeringInputIndex(turn,job){
  const prompt=job.routedDispatchPrompt??job.dispatchPrompt;
  if(typeof prompt!=='string')return -1;
  if(taskIdCurrentThread(job)){
    if(!job.taskId||!sameDispatchText(prompt.slice(0,prompt.indexOf('\n')+1),taskIdHeader(job.taskId)))return -1;
  }else if(!job.correlationToken||!prompt.includes(job.correlationToken))return -1;
  const indices=[];
  for(const [index,item] of (turn.items??[]).entries()){
    if(!['userMessage','steeringUserMessage'].includes(item.type)&&!(item.type==='functionCallOutput'&&/^(?:.*__)?send_message_to_thread$/.test(item.name??'')))continue;
    if(sameDispatchText(messageText(item),prompt))indices.push(index);
  }
  return indices.length===1?indices[0]:-1;
}
export function messageText(item){
  const value=typeof item?.text==='string'?item.text:typeof item?.content==='string'?item.content:Array.isArray(item?.content)?item.content.filter(c=>['text','input_text'].includes(c.type)).map(c=>c.text??'').join('\n'):typeof item?.output?.text==='string'?item.output.text:typeof item?.output==='string'?item.output:'';
  if(item?.type==='functionCallOutput'&&/^(?:.*__)?(?:send_message_to_thread|create_thread)$/.test(item.name??'')){
    const input=/^\s*<codex_delegation>[\s\S]*?<input>([\s\S]*)<\/input>[\s\S]*<\/codex_delegation>\s*$/.exec(value)?.[1];
    if(input!==undefined)return input.replace(/&(amp|lt|gt|quot|apos);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[key]);
  }
  return value;
}
export const sameDispatchText=(a,b)=>String(a??'').replaceAll('\r\n','\n')===String(b??'').replaceAll('\r\n','\n');
export function pendingInitialDispatches(state){return Object.values(state.automation?.routes??{}).filter(r=>r.initialDispatch&&!['adopted','not-applied'].includes(r.initialDispatch.phase));}
export function dispatchQueueJobs(state){
  const pending=pendingInitialDispatches(state),ids=new Set(pending.map(r=>r.initialDispatch.jobId));
  return [...state.jobs.filter(j=>!ids.has(j.id)),...pending.map(r=>{
    const d=r.initialDispatch,task=state.tasks?.find(t=>t.id===d.taskId),plan=state.automation?.plans.find(p=>p.id===d.planId);
    return {id:d.jobId,taskId:d.taskId,projectId:r.projectId,path:r.path,threadId:r.threadId??'pending-'+d.jobId,status:d.phase==='creating'?'sending':'uncertain',autoPlanId:d.planId,allowParallel:!d.handoffId&&!!task&&plan?.maxConcurrent!==1&&task.execution?.parallel!==false,writePaths:task?.execution?.writePaths,workUnit:r.baseKey??r.key};
  })];
}
export function ownsDispatchedSource(state,source){
  return state.jobs.some(j=>(j.dispatchVersion===2||taskIdCurrentThread(j))&&j.projectId===source.projectId&&j.threadId===source.threadId&&j.turnId===source.turnId&&sameDispatchText(j.routedDispatchPrompt??j.dispatchPrompt,source.text));
}
