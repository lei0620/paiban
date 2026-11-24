import {normalize} from './core.mjs';
import {builtinModels,threadModelView,namingIssue} from './model-routing.mjs';
import {localCatalogFallback} from './codex-catalog-fallback.mjs';
import {readDesktopThread} from './local-session.mjs';

// 对话模型来自本机 Codex 索引（只读）；索引不可用时退回标题后缀，两者都没有则标记未确认。
function describe(thread,projects,records,models){
  const view=threadModelView(thread,records?.[thread.id],models);
  const project=projects.find(p=>normalize(p.path)===normalize(thread.cwd??''));
  return {...thread,...view,titleIssue:namingIssue({title:thread.title,projectLabel:project?.label,key:view.modelKey,models})};
}

// A missing imported/bound thread must not discard the healthy project list.
export async function collectCatalog(bridge,state,options={}){
  const models=options.models??builtinModels;
  let p,t,fallback,verificationFailure;
  try{
    if(options.metadataOnly){
      p=await bridge.call('list_projects');
      try{fallback=await (options.localCatalogFallback??localCatalogFallback)({bridge,projects:p.projects,state,previousThreads:options.previousThreads});}
      catch(error){fallback={threads:[],activityThreads:[],threadErrors:{}};verificationFailure={reason:error.message,code:'CATALOG_UNVERIFIED'};}
      t={threads:fallback.threads,pinnedThreads:[]};
    }else{
      [p,t]=await Promise.all([bridge.call('list_projects'),bridge.call('list_threads',{limit:50},options.listOptions??{})]);
      if(!Array.isArray(t.threads)||(t.pinnedThreads!==undefined&&!Array.isArray(t.pinnedThreads))||(t.unavailableHosts!==undefined&&!Array.isArray(t.unavailableHosts)))throw Object.assign(Error('桌面完整列表回执结构不完整'),{code:'CATALOG_UNVERIFIED',operation:'list_threads'});
      if(t.unavailableHosts?.some(host=>(typeof host==='string'?host:host.hostId)==='local'))throw Object.assign(Error('本机桌面列表不完整'),{code:'DESKTOP_TIMEOUT',operation:'list_threads'});
    }
  }
  catch(error){
    if(!['DESKTOP_TIMEOUT','CATALOG_UNVERIFIED'].includes(error.code)||error.operation!=='list_threads')throw error;
    verificationFailure={reason:error.message,code:error.code};
    p=await bridge.call('list_projects');
    fallback=await (options.localCatalogFallback??localCatalogFallback)({bridge,projects:p.projects,state,previousThreads:options.previousThreads});
    t={threads:fallback.threads,pinnedThreads:[]};
  }
  let projects=p.projects.filter(p=>p.hostId==='local');
  for(const local of state.localProjects??[]){
    const actual=projects.find(p=>normalize(p.path)===normalize(local.path));
    projects=projects.filter(p=>normalize(p.path)!==normalize(local.path));
    projects.push({...local,desktopProjectId:actual?.projectId??null});
  }
  const threads=[...(t.pinnedThreads??[]),...(t.threads??[])].filter(t=>t.kind==='codex'&&t.hostId==='local');
  const threadErrors={...fallback?.threadErrors};
  const liveJobs=(state.jobs??[]).filter(j=>['queued','sending','submitted','running','uncertain'].includes(j.status));
  const plannedTasks=new Set((state.automation?.plans??[]).filter(p=>['active','paused'].includes(p.status)).flatMap(p=>p.nodes.filter(n=>!n.skipped).map(n=>n.taskId)));
  const planTargets=(state.tasks??[]).filter(t=>plannedTasks.has(t.id)).map(t=>t.execution?.threadId);
  const targets=new Set([...(state.imported??[]),...Object.values(state.bindings),...liveJobs.map(j=>j.threadId),...planTargets].filter(Boolean));
  for(const id of targets){
    if(threads.some(t=>t.id===id))continue;
    if(fallback){threadErrors[id]='本机对话状态未确认，所属项目暂停派发';continue;}
    try{
      const r=await readDesktopThread(bridge,{threadId:id,turnLimit:1,maxOutputCharsPerItem:0},options.sessionReader);
      if(r.thread?.kind==='codex'&&r.thread.hostId==='local'&&projects.some(p=>normalize(p.path)===normalize(r.thread.cwd)))threads.push({...r.thread,status:r.thread.status?.type??r.thread.status});
      else threadErrors[id]='已绑定对话不属于可用本机项目';
    }catch{threadErrors[id]='此对话暂不可读取，请重新选择绑定；其他项目可继续使用';}
  }
  const index=typeof options.threadModels==='function'?options.threadModels(threads.map(thread=>thread.id)):options.threadModels??{available:false,entries:{},error:''};
  const described=threads.map(thread=>describe(thread,projects,index.entries??{},models)),byId=new Map(described.map(thread=>[thread.id,thread]));
  const activityThreads=fallback?.activityThreads?.map(thread=>byId.get(thread.id)??thread);
  for(const thread of described)if(activityThreads&&!activityThreads.some(row=>row.id===thread.id))activityThreads.push(thread);
  return {projects,threads:described,...(activityThreads?{activityThreads}:{}),...(verificationFailure?{verificationFailure}:{}),catalogSource:fallback?'local-app-server':'desktop',threadErrors,unavailableSources:t.unavailableSources??[],modelIndex:{available:index.available===true,error:index.error??'',source:index.source??''}};
}
