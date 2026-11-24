import {HandoffCoordinator} from './handoff.mjs';
import {inspectExecution,ExecutionReadChecks} from './execution-recovery.mjs';
import {handoffPending,handoffLockReason,assertNoHandoff,requestHandoff,cancelHandoff} from './handoff-state.mjs';
import {hasPortableWorkflow} from './workflow-sync.mjs';
import {CatalogHealth,catalogUnverified} from './catalog-health.mjs';
import {presentSource,readSourceImage,presentTask} from './source-display.mjs';
import {InitialDispatcher} from './initial-dispatch.mjs';
import {dispatchQueueJobs,pendingInitialDispatches,CURRENT_THREAD_DELIVERY,CURRENT_THREAD_TASK_ID_VERSION,trackedCurrentThread,steeringCurrentThread,taskIdHeader} from './dispatch-state.mjs';
import {inspectDelivery,deliveryPreview,reconcileDelivery} from './delivery-reconcile.mjs';
import {inspectUpgrade,upgradeRepository,githubUpgradePrompt} from './github-upgrade.mjs';
import {ensureProjectSyncTask} from './project-sync.mjs';
import {DirectProjectSync} from './project-sync-direct.mjs';
import {beginSyncTiming} from './sync-timing.mjs';
import {previewSourceBinding,saveSourceBinding,verifySourceBinding,sourceContext,AutomaticSourceBinding} from './source-binding.mjs';
import {listProjectReferences,changeProjectReference,changeProjectReferenceTag,changeProjectReferenceGroup} from './project-references.mjs';
import {ProjectCatalog,inspectPublishedProject,inspectTransferDirectory,queueProjectAdoption} from './project-transfer.mjs';
import {LocalSessionReader,hydrateSessionTurns,readDesktopThread,isThreadReadBlocked,readSessionPage} from './local-session.mjs';
import {planCommand,planIntakeView,readPlanReceipt,importPlan,cancelPlan} from './plan-intake.mjs';
import {suggestTask,saveSection,fillEmptySectionDescriptions} from './task-sections.mjs';
import {changeTaskGroup,projectTaskGroups} from './task-groups.mjs';
import http from 'node:http';
import {openProjectSidebar} from './open-panel.mjs';
import {AutoTaskSync} from './sync-auto.mjs';
import {richRecord,hydrateRichAttachments} from './rich-sync.mjs';
import {versionProject,inspectVersionGit,saveVersion,deleteVersion,prepareVersionRollback} from './versions.mjs';
import {versionIntakeView,versionCommand,beginVersionIntake,cancelVersionIntake,collectVersionIntake,acceptVersionIntake,linkVersionIntake} from './version-intake.mjs';
import {instructionHash,instructionMatches} from './execution.mjs';
import {readDefaultModel,desiredModel,modelReallocation} from './default-model.mjs';
import {automationSnapshot,AutoExecutor} from './automation.mjs';
import {backupRestartState,checkRestartCode} from './restart.mjs';
import {maintenanceWaiting,maintenanceImpact,armMaintenance} from './maintenance.mjs';
import {classify,ConversationCapture,captureSnapshot,correctRecognition,changeTaskChain} from './capture.mjs';
import {changeProperties,requiresLocalProperties,attributesOf,propertyGroups} from './properties.mjs';
import {attachmentFields,saveAttachment,readAttachment,attachmentPrompt} from './attachments.mjs';
import {applyBoard,boardFiles,boardSyncKey,mergeBoards,portableBoard,validateBoard} from './board-sync.mjs';
import {ComposerFiller,DirectThreadSender,composerInput} from './composer.mjs';
import {reviewTarget,assertReviewTarget,validateReviewThread,inspectReviewThread,backupReviewThread,recoveryThreadView,scopedIdleThread,automaticUncertainCandidate} from './review-recovery.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {Bridge,connectionThreadId,discoverInstances} from './bridge.mjs';
import {normalize,busy,matchingTurn,readJobTurn,jobTurnPatch,setBinding,validateBatch,prepareQueuedJob,queuedJobReason,queuedJobLocalReason,queuedThreadReason,executionSlotCount,dependencySatisfied,sourceAwareJob,sourceAwareJobs,sourcePathsOverlap} from './core.mjs';
import {collectCatalog} from './catalog.mjs';
import {loadModelRegistry,titlePurpose,canonicalTitle,threadModelView,defaultModelKey,threadModelRecord} from './model-routing.mjs';
import {identifyProjects,reconcileRepositories} from './repository-identity.mjs';
import {executeTask,retryReviewedTask,syncTaskStates,resolveUncertainTask,resolveLegacyJob,cancelQueuedJob} from './board.mjs';
import {configureSidecars,retrySidecars,restoreSidecarSession,BoardSidecars} from './board-sidecar.mjs';
import {DesktopContext,contextPage,contextWriteAllowed} from './desktop-context.mjs';
import {checkDesktop} from './desktop-check.mjs';
import {configureWorkspace,mapProject,workspaceReason,workspaceView} from './workspace.mjs';
import {changeProjectBoard,projectBoardView} from './project-board.mjs';
import {portableTasks,mergeTasks,applyRemote,GithubTaskStore,mergeDeletedDependencies} from './task-sync.mjs';
import {inspectWorkflow,developmentPrompt,validateProjectFolder,workflowProject,initializationPrompt,workflowReviewPrompt,queueInitialization} from './workflow.mjs';
import {StateStore} from './state-store.mjs';
import {JsonBackend} from './json-store.mjs';
import {storeCommands} from './store-commands.mjs';
import {acquireDataLock} from './data-lock.mjs';
import {initializePanelState} from './panel-state.mjs';
import {openPanelSqliteStore} from './panel-sqlite-store.mjs';
import {PanelQueries,conditionalJSON} from './panel-queries.mjs';
import {NativePanelSessions} from './native-panel.mjs';
import {installedReleaseConfig} from './release-config.mjs';
import {installedBackupRoot,installedDataRoot} from './installed-paths.mjs';
import {safeLocalPath} from './maintenance-policy.mjs';
import {releaseCheckStore} from './release-check-store.mjs';
import {ReleaseScheduler} from './release-scheduler.mjs';
import {stageRelease,verifyStagedRelease} from './release-staging.mjs';
import {configureBackupRoot,configuredBackupRoot,validateBackupRoot,requiresExplicitBackup,readMaintenancePolicy,localBackupStamp} from './backup-roots.mjs';
import {backupExistingState} from './storage.mjs';
import {inspectPendingUpdate,confirmPendingUpdate} from './update-startup.mjs';
import {backupInstalledData} from './installed-migration.mjs';
import {beginReleaseTransaction,advanceReleaseTransaction} from './release-journal.mjs';
import {DiagnosticLog,diagnosticBlockers,diagnosticCode} from './diagnostics.mjs';
const moduleRoot=path.dirname(fileURLToPath(import.meta.url));
// Injectable dependencies keep HTTP/queue tests isolated from real desktop data.
export async function createPanel(options={}){
if(options.storageBackend&&!['json','sqlite'].includes(options.storageBackend))throw Error('不支持的存储后端');
if(options.storageBackend==='sqlite'&&(!options.makeBridge||!options.makeStore))throw Error('SQLite服务入口仍只允许注入隔离桌面和远端适配器');
const programRoot=fs.realpathSync.native(options.root??moduleRoot),root=options.dataRoot?fs.realpathSync.native(options.dataRoot):programRoot;
const separateData=root!==programRoot;
const launchId=separateData&&options.installRoot&&/^[a-f0-9]{32}$/.test(process.env.PAIBAN_LAUNCH_ID??'')?process.env.PAIBAN_LAUNCH_ID:'';
if(options.dataRoot&&!separateData)throw Error('独立数据目录不能与程序目录相同');
if(separateData){
  if(options.installRoot)installedDataRoot(options.installRoot,root);
  const within=(parent,child)=>{const relative=path.relative(parent,child);return !relative||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
  if(within(root,programRoot)||within(programRoot,root))throw Error('独立数据目录和程序目录不能相互包含');
  if(options.storageBackend==='sqlite')throw Error('独立数据目录暂不支持隔离 SQLite 入口');
  if(fs.existsSync(path.join(root,'.migration-incomplete')))throw Error('数据迁移尚未完成，请保留原数据并重新迁移到新目录');
  const ready=path.join(root,'.installed-data-ready');
  if(!fs.existsSync(ready)||fs.lstatSync(ready).isSymbolicLink()||fs.readFileSync(ready,'utf8')!=='codexkz-installed-data-v1\n')throw Error('独立数据目录尚未初始化完成');
}
const dataDir=path.join(root,'data');
if(separateData&&fs.existsSync(dataDir)&&fs.lstatSync(dataDir).isSymbolicLink())throw Error('独立数据目录不能重定向');
fs.mkdirSync(dataDir,{recursive:true});
if(separateData&&fs.realpathSync.native(dataDir)!==dataDir)throw Error('独立数据目录的实际路径发生变化');
const restartBackup=options.backupRestart??(source=>{
  let backupRoot=configuredBackupRoot(root);
  if(!backupRoot&&requiresExplicitBackup(source))throw Error('请先配置本机备份目录');
  if(!backupRoot&&separateData)backupRoot=validateBackupRoot(root,path.join(root,'backups'));
  if(!backupRoot&&!separateData){try{backupRoot=readMaintenancePolicy(root).backupRoot;}catch(error){if(error.code!=='POLICY_REQUIRED')throw error;backupRoot=validateBackupRoot(root,path.join(root,'备份'));}}
  return backupRestartState(source,backupRoot);
});
const schemaBackup=(base,source)=>{
  if(separateData)return restartBackup(source);
  const backupRoot=configuredBackupRoot(root);
  if(!backupRoot&&requiresExplicitBackup(source))throw Error('请先配置本机备份目录');
  return backupExistingState(base,source,backupRoot??undefined);
};
const reviewBackup=options.backupReviewThread??((reader,job)=>{
  const backupRoot=configuredBackupRoot(root);if(!backupRoot)throw Error('请先配置本机备份目录，未修改原对话');
  return backupReviewThread(reader,job,{backupRoot});
});
const dataLock=await acquireDataLock(dataDir);
let serve,repository;
const server=http.createServer((req,res)=>{
  req.receivedAt=Date.now();
  if(serve)return serve(req,res);
  res.writeHead(503,{'Connection':'close'});res.end('面板正在启动');
});
try{
let pendingStartup=options.pendingUpdate??null;
if(pendingStartup){
  if(!separateData||!pendingStartup.id||!pendingStartup.installRoot)throw Error('待确认升级参数无效');
  await inspectPendingUpdate({installRoot:pendingStartup.installRoot,dataRoot:root,programRoot,lease:dataLock,id:pendingStartup.id});
}
// Reserve HTTP before reading/migrating state. A port conflict must not turn
// running jobs into uncertain records, create backups, or touch state.json.tmp.
const port=Number(options.port??process.env.PORT??4318);
await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});
});
const address=`127.0.0.1:${server.address().port}`,origin=`http://${address}`;
const makeBridge=options.makeBridge??((caller,instance)=>new Bridge(caller,instance));
const makeStore=options.makeStore??(config=>new GithubTaskStore(config));
repository=options.storageBackend==='sqlite'
  ?await openPanelSqliteStore({root,lockLease:dataLock,timeoutMs:options.sqliteTimeoutMs})
  :new StateStore(new JsonBackend(root,options.storageIO,schemaBackup),{normalize:syncTaskStates,commands:storeCommands});
let state=repository.prepare(original=>initializePanelState(original,{caller:options.caller??(original===null||!process.env.PANEL_KEEP_CALLER?process.env.CODEX_THREAD_ID:undefined)}));
const projectCatalog=new ProjectCatalog({config:()=>state.sync.config,makeStore});
const diagnostics=new DiagnosticLog({root,now:options.now??Date.now,io:options.diagnosticIO??fs});
const mutate=async(reduce,operation='domain')=>{const pending=repository.transaction({operation},reduce),result=pending?.then?await pending:pending;state=repository.view();diagnostics.observe(state);return result.value;};
const command=async input=>{const pending=repository.executeCommand(input),result=pending?.then?await pending:pending;state=repository.view();diagnostics.observe(state);return result.value;};
const bridge=makeBridge(state.caller,state.connection?.instanceId??''),token=randomBytes(32).toString('hex');
const composer=new ComposerFiller({root,run:options.fillComposer});
function nativeComposerInput(body){
  if(closing||restarting||maintenanceWaiting(state))throw Object.assign(Error('面板正在更新，本次未发送'),{notApplied:true});
  const view=presentationCatalog(),input=composerInput(body,state,view,root,origin),project=catalog.projects.find(p=>p.projectId===input.projectId),reason=workspaceReason(state,project);
  if(reason)throw Object.assign(Error(reason),{notApplied:true});
  if(!input.threadTitle||view.threads.filter(t=>t.kind==='codex'&&t.hostId==='local'&&t.title===input.threadTitle).length!==1)throw Object.assign(Error('当前聊天标题不唯一，无法安全定位正常发送按钮；本次未操作输入框'),{notApplied:true});
  if(new Set(input.files.map(f=>f.name.normalize('NFKC').toUpperCase())).size!==input.files.length)throw Object.assign(Error('本次附件包含同名文件，无法在聊天输入区逐项核对；请分别发送'),{notApplied:true});
  return input;
}
const directMessages=new DirectThreadSender({root,send:input=>bridge.call('send_message_to_thread',{threadId:input.threadId,hostId:'local',prompt:input.prompt})});
const sessionReader=options.sessionReader??new LocalSessionReader();
let catalog={projects:[],threads:[]},connectionError='',lastSync=null,refreshing,metadataRefreshing,connecting;
const contextThreads=new Map();
function rememberContextThreads(rows,title){
  for(const [id,entry] of contextThreads)if(entry.thread.title===title)contextThreads.delete(id);
  for(const row of rows){if(!contextThreads.has(row.id)&&contextThreads.size>=64)contextThreads.delete(contextThreads.keys().next().value);contextThreads.set(row.id,{at:Date.now(),thread:{id:row.id,title:row.title,cwd:row.cwd,kind:'codex',hostId:'local',status:'active',activityUnknown:true}});}
}
function presentationCatalog(){
  const byId=new Map(catalog.threads.map(row=>[row.id,row]));
  for(const [id,{at,thread}] of contextThreads){
    if(Date.now()-at>30000){contextThreads.delete(id);continue;}
    const known=byId.get(id);if(known&&normalize(known.cwd).replace(/^\\\\\?\\/,'')!==normalize(thread.cwd).replace(/^\\\\\?\\/,''))continue;
    byId.set(id,known?{...thread,...known,title:thread.title,cwd:thread.cwd}:thread);
  }
  return {...catalog,threads:[...byId.values()]};
}
const nativePanels=new NativePanelSessions({catalog:()=>({...catalog,connectionError,lastSync}),state:()=>state,identifyThread:id=>sessionReader.identity?.(id)});
const desktopContext=new DesktopContext({origin,getCatalog:()=>({...catalog,contextRoutes:Object.values(state.automation.routes)}),read:options.readDesktopContext,lookupThreads:sessionReader.contextThreads?.bind(sessionReader),rememberThreads:rememberContextThreads});
let desktopCheckFlight;
let activitySnapshot=catalog;
const refreshNow=options.now??Date.now;
const managedQueue=options.activityScope==='panel';
const catalogHealth=new CatalogHealth({now:refreshNow,scope:managedQueue?'panel':'desktop'});
let nextHeartbeatAt=0,nextMetadataAt=0;
// 模型表与对话模型索引：模型表可选 config/model-registry.json 覆盖；索引只读本机 Codex 数据，不写桌面文件。
const modelRegistry=loadModelRegistry(programRoot);
const getDefaultModel=()=>options.readDefaultModel?options.readDefaultModel():readDefaultModel({models:modelRegistry.models});
const currentModel=()=>desiredModel(getDefaultModel(),modelRegistry.models);
const modelView=id=>{const thread=catalog.threads.find(t=>t.id===id);return thread?{...thread,...threadModelView(thread,threadModelIndex([id]).entries[id],modelRegistry.models)}:null;};
let modelIndex={available:false,entries:{},error:'尚未读取对话模型'};
function threadModelIndex(catalogIds=[]){
  const ids=[...catalogIds,...(state.imported??[]),...Object.values(state.bindings??{}),...Object.values(state.automation?.routes??{}).map(r=>r.threadId),...(state.jobs??[]).filter(j=>['queued','sending','submitted','running','uncertain'].includes(j.status)).map(j=>j.threadId)];
  const read=sessionReader.models?.bind(sessionReader);
  modelIndex=read?read(ids):{available:false,entries:{},error:'本机读取器不支持模型读取，请按标题后缀确认模型'};
  return modelIndex;
}
const queries=new PanelQueries();
const openingSidebars=new Map();
const executionInspections=new Map(),executionReads=new ExecutionReadChecks({track});
const executionRead=(key,read)=>executionReads.run(key,read);
let restarting=false,restartChecking=false,closing=false,closePromise,activeRequests=0;const instanceId=randomUUID(),startedAt=new Date().toISOString();
let releaseConfig=options.releaseUpdate??null,releaseConfigError='';
if((separateData||programRoot===moduleRoot)&&options.releaseUpdate===undefined)try{releaseConfig=installedReleaseConfig(programRoot);if(separateData&&!releaseConfig)releaseConfigError='发行配置缺失，无法检查更新';}catch{releaseConfigError='发行配置无效，无法检查更新';}
const releaseScheduler=releaseConfig?new ReleaseScheduler({...releaseConfig,...releaseCheckStore(root)}):null;
let releaseStatus={supported:!!releaseScheduler,status:releaseConfigError?'error':'idle',...(releaseConfigError?{message:releaseConfigError}:{})};
const productCapabilities=()=>({dataLocationSupported:typeof options.requestRelocation==='function',dataLocationError:options.relocationError??'',productInstalled:separateData,productVersion:releaseConfig?.version??null,releaseApplySupported:separateData&&!!releaseScheduler&&typeof options.requestUpdate==='function',releaseCheck:releaseStatus});
let releaseStage=null,releaseStageProof=null,releaseStaging=null;
async function checkProductRelease(manual=false){
  if(!releaseScheduler)throw Error(releaseConfigError||'当前运行方式不支持产品更新');
  if(closing||restarting)throw Error('面板正在关闭或重启，请稍后检查');
  try{const result=await releaseScheduler.checkNow({manual});releaseStatus={supported:true,...result};return releaseStatus;}
  catch{releaseStatus={supported:true,status:'error',message:'更新检查记录不可用，请稍后重试'};return releaseStatus;}
}
function stageProductRelease(){
  if(!separateData)throw Error('请在 Windows 安装版执行一键升级');
  if(!releaseScheduler)throw Error(releaseConfigError||'当前运行方式不支持产品更新');
  if(closing||restarting)throw Error('面板正在关闭或重启，请稍后操作');
  if(releaseStaging)return releaseStaging;
  const operation=(async()=>{
    const saved=await releaseCheckStore(root).read();if(!saved?.envelope)throw Error('请先检查可用更新');
    if(!releaseScheduler.view(saved).available)throw Error('没有适用于当前系统的新版本');
    const proof=createHash('sha256').update(JSON.stringify(saved.envelope)).digest('hex');
    if(releaseStage&&releaseStageProof===proof){await verifyStagedRelease({...releaseConfig,root,stageId:releaseStage.stageId});return releaseStage;}
    const result=await stageRelease({...releaseConfig,root,envelope:saved.envelope});
    releaseStage=result;releaseStageProof=proof;return result;
  })().finally(()=>{releaseStaging=null;});
  releaseStaging=operation;return operation;
}
const pendingOperations=new Set();
function track(operation){pendingOperations.add(operation);operation.then(()=>pendingOperations.delete(operation),()=>pendingOperations.delete(operation));return operation;}
async function connectBridge({probe=false}={}){
  if(connecting)return connecting;
  if(!probe&&bridge.pipe&&catalogHealth.details.transport==='connected'){catalogHealth.connected([state.caller,bridge.instanceId??'',bridge.pipe].join('|'));return;}
  connecting=(async()=>{try{
    await bridge.connect();catalogHealth.connected([state.caller,bridge.instanceId??'',bridge.pipe??'fixture'].join('|'));connectionError='';
  }catch(error){connectionError=error.message;catalogHealth.disconnected(error);throw error;}finally{connecting=null;}})();return connecting;
}
async function applyCatalog(nextCatalog,{metadata=false,generation=catalogHealth.generation}={}){
    nextCatalog.modelIndex={...modelIndex,source:modelRegistry.source,error:modelIndex.error||modelRegistry.error};
    nextCatalog.projects=await identifyProjects(nextCatalog.projects,options.inspectRepository,state.workspace.mappings);
    if(generation!==catalogHealth.generation)throw catalogUnverified('桌面连接已变化，旧目录未采用');
    // Keep the validated local catalog available for sync to repair stale
    // identity caches. Reconciliation still rejects conflicting identities.
    catalog=nextCatalog;if(!metadata)activitySnapshot=nextCatalog;
    const identityDraft=structuredClone(state);reconcileRepositories(identityDraft,nextCatalog.projects);
    if(JSON.stringify(identityDraft.workspace.mappings)!==JSON.stringify(state.workspace.mappings))await mutate(draft=>reconcileRepositories(draft,nextCatalog.projects));
    const sectionProjects=nextCatalog.projects.filter(p=>p.hostId==='local').map(p=>p.projectId);
    if(!syncRunning&&!maintenanceWaiting(state)&&fillEmptySectionDescriptions(identityDraft,sectionProjects))await mutate(draft=>fillEmptySectionDescriptions(draft,sectionProjects));
    // Persist only a hash, never the local pipe address. Reusing the same
    // desktop across a panel restart must not open another set of tabs.
    if(bridge.pipe){const session=createHash('sha256').update(bridge.pipe).digest('hex');if(state.boards.desktopSession!==session)await mutate(draft=>restoreSidecarSession(draft,session));}
    lastSync=new Date(refreshNow()).toISOString();connectionError='';
}
async function refresh({automatic=false,force=true,threadId}={}){
  if(refreshing){const ready=await refreshing;if(managedQueue&&threadId&&ready)await read(threadId);return ready;}
  if(restarting||closing)return false;
  if(managedQueue&&!catalog.projects.length){if(await refreshMetadata()===false)throw catalogUnverified(connectionError||'本机项目目录尚未取得');}
  refreshing=(async()=>{try{
    if(managedQueue){
      await connectBridge();
      if(threadId)await read(threadId);
      return await catalogHealth.verify(async()=>({...catalog,catalogSource:'panel-managed',activityThreads:[]}),(next)=>{activitySnapshot=next;},{automatic,force});
    }
    await metadataRefreshing;
    await connectBridge();
    const ready=await catalogHealth.verify(()=>collectCatalog(bridge,state,{models:modelRegistry.models,threadModels:ids=>threadModelIndex(ids),previousThreads:catalog.threads,sessionReader,localCatalogFallback:options.localCatalogFallback,listOptions:{attempts:1,timeoutMs:10000}}),(next,generation)=>applyCatalog(next,{generation}),{automatic,force});
    if(ready)void sidecars.synchronize();return ready;
  // connectBridge owns transport failures. Catalog/tool/application failures
  // already block activity trust; they do not prove that the pipe disconnected.
  }catch(error){diagnostics.record({phase:'activity-refresh',error});throw error;}finally{refreshing=null;}})();return refreshing;
}
async function requireActivities(options={}){
  try{if(await refresh(options)===false)throw catalogUnverified(catalogHealth.details.reason||'完整活动状态待核验，本次未发送');catalogHealth.assertFresh();}
  catch(error){
    const failure=error.code==='CATALOG_UNVERIFIED'?error:catalogUnverified('完整活动核验失败：'+error.message);
    const requestId=options.requestId;
    if(requestId&&(state.jobs.some(job=>[job.executeRequestId,job.workflowRequestId,job.batchId].includes(requestId))||state.automation.plans.some(plan=>plan.requestId===requestId)||state.threadRequests?.[requestId])){
      failure.notApplied=false;failure.message+='；此前安排记录仍保留，请核对原记录，不会重复发送';
    }
    throw failure;
  }
}
function activityCatalog(){return managedQueue?{...catalog,catalogSource:'panel-managed',activityThreads:[]}:catalogHealth.fresh()?activitySnapshot:{...catalog,catalogSource:'local-app-server'};}
function refreshMetadata(){
  if(metadataRefreshing)return metadataRefreshing;
  if(restarting||closing)return Promise.resolve(false);
  metadataRefreshing=(async()=>{try{
    await refreshing;await connectBridge();const generation=catalogHealth.generation;
    const next=await collectCatalog(bridge,state,{models:modelRegistry.models,threadModels:ids=>threadModelIndex(ids),previousThreads:catalog.threads,sessionReader,localCatalogFallback:options.localCatalogFallback,metadataOnly:true});
    if(generation!==catalogHealth.generation)return false;
    await applyCatalog(next,{metadata:true,generation});void sidecars.synchronize();return true;
  }catch(error){connectionError=error.message;diagnostics.record({phase:'catalog-refresh',error});return false;}finally{metadataRefreshing=null;}})();return metadataRefreshing;
}
async function lightTick(){
  if(restarting||closing)return;
  if(!projectCatalog.pending)track(projectCatalog.refresh()).catch(()=>{});
  const now=refreshNow();
  if(now-lastCurrentThreadResultCheckAt>=2000&&state.jobs.some(activeCurrentThreadResult))void reconcileExecutions({currentThreadOnly:true});
  if(now>=nextHeartbeatAt){nextHeartbeatAt=now+30000;try{await connectBridge({probe:true});}catch{return;}}
  if(now>=nextMetadataAt){nextMetadataAt=now+60000;await refreshMetadata();}
  // A failed read recovers even with no queued work. Healthy idle sessions
  // still use metadata only; retries share the execution/manual singleflight.
  if(catalogHealth.recoveryDue())await refresh({automatic:true}).catch(()=>{});
  await track(autoBindUploadedSource());
}
const sdkActivities=new Map(),sdkReadVersions=new Map();let sdkActivityOverflow=false,sdkReadSequence=0;
const activityKey=thread=>thread.id+'\0'+normalize(thread.cwd);
const rememberReadThread=thread=>{if(managedQueue){const previous=catalog.threads.find(t=>t.id===thread.id);catalog.threads=catalog.threads.filter(t=>t.id!==thread.id);catalog.threads.push({...previous,...thread,status:thread.status?.type??thread.status});if(catalog.threadErrors)delete catalog.threadErrors[thread.id];}};
const restoringReviews=new Set();
async function readLocal(id,cursor,limit=10,{receiptOnly=false,continueRead=true,composerBaseline=false}={}){
  const recent=()=>{
    const known=presentationCatalog().threads.find(t=>t.id===id),key=known&&activityKey(known),observed=key&&sdkActivities.get(key),indexed=known?.activityUnknown===true;
    if(sdkActivityOverflow)throw Object.assign(Error('对话状态证据过多，暂不能安全核对近期轮次'),{code:'THREAD_READ_UNVERIFIED'});
    const thread=known&&{...known,...(observed?{status:observed.status,activityUnknown:false}:indexed?{status:'active',activityUnknown:true}:{})};
    const result=sessionReader.readRecent(thread,{cursor,limit,observedActivity:observed});
    if(observed&&result.observedActivityEnded&&sdkActivities.get(key)===observed){sdkActivities.delete(key);if(indexed||known?.activityUnknown===false&&known.activityObservedAt===observed.observedAt&&known.activityTurnId===observed.turnId){result.thread={...result.thread,status:'active',activityUnknown:true};const version=sdkReadVersions.get(key);if(version)sdkReadVersions.set(key,{...version,thread:result.thread});rememberReadThread(result.thread);}}
    return result;
  };
  if(cursor?.startsWith('recent:')&&typeof sessionReader.readRecent==='function')return recent();
  let response;const readSequence=++sdkReadSequence,readThread=catalog.threads.find(t=>t.id===id),heldAtStart=readThread&&sdkActivities.get(activityKey(readThread));
  try{response=await readDesktopThread(bridge,{threadId:id,hostId:'local',turnLimit:limit,includeOutputs:!receiptOnly&&!composerBaseline,maxOutputCharsPerItem:composerBaseline?0:receiptOnly?1000:20000,...(cursor&&!cursor.startsWith('local:')?{cursor}:{})},sessionReader);}catch(error){
    if(presentationCatalog().threads.some(t=>t.id===id)&&typeof sessionReader.readRecent==='function'&&(error.code==='THREAD_READ_TOO_LARGE'||/Tool response exceeds the size limit|single oversized turn cannot be returned/i.test(error.message))){
      try{return recent();}catch(recentError){error=recentError;}
    }
    const thread=catalog.threads.find(t=>t.id===id),project=thread&&catalog.projects.find(p=>normalize(p.path)===normalize(thread.cwd));
    diagnostics.record({phase:'thread-read',projectId:project?.projectId,threadId:thread?.id,error});throw error;
  }
  let thread=response.thread;
  const contextThread=contextThreads.get(id);
  if(thread?.id===id&&contextThread&&Date.now()-contextThread.at<=30000&&normalize(thread.cwd).replace(/^\\\\\?\\/,'')===normalize(contextThread.thread.cwd).replace(/^\\\\\?\\/,'')){thread={...thread,cwd:contextThread.thread.cwd};response={...response,thread};}
  const project=catalog.projects.find(p=>p.hostId==='local'&&normalize(p.path)===normalize(thread?.cwd??''));
  if(thread?.id===id&&thread.kind==='codex'&&thread.hostId==='local'&&project){
    const activeTurns=(response.turns??[]).filter(t=>busy(t.status)),observedAt=new Date().toISOString(),turnId=!cursor&&activeTurns.length===1?activeTurns[0].id:undefined,key=activityKey(thread),previous=sdkReadVersions.get(key),held=sdkActivities.get(key);
    thread={...thread,activityUnknown:false,activityObservedAt:observedAt,activityTurnId:turnId};response={...response,thread};
    if(previous&&previous.sequence>readSequence){
      // Start order is not snapshot order. Never turn a late busy response into
      // an idle one, and never use a stale successful read to authorize sending.
      if(busy(thread.status)){sdkActivities.set(key,{status:thread.status,observedAt,turnId});sdkReadVersions.set(key,{sequence:previous.sequence,thread});rememberReadThread(thread);}
      throw Object.assign(Error('对话状态在读取期间变化，请重新核对当前轮次'),{code:'THREAD_READ_UNVERIFIED'});
    }
    else if(sdkReadVersions.has(key)||sdkReadVersions.size<1000){
      const status=thread.status?.type??thread.status,ended=(response.turns??[]).length>0&&(response.turns??[]).every(t=>t.id&&['completed','interrupted','failed'].includes(t.status?.type??t.status));
      if(busy(status))sdkActivities.set(key,{status:thread.status,observedAt,turnId});
      else if((status==='idle'||status==='notLoaded'&&ended)&&held===heldAtStart)sdkActivities.delete(key);
      else if(held){thread={...thread,status:held.status,activityUnknown:false,activityObservedAt:held.observedAt,activityTurnId:held.turnId};response={...response,thread};}
      sdkReadVersions.set(key,{sequence:readSequence,thread});
    }else{sdkActivityOverflow=true;throw Object.assign(Error('对话状态证据过多，暂不能安全核对当前轮次'),{code:'THREAD_READ_UNVERIFIED'});}
    rememberReadThread(thread);
    // Normal-button submission needs the fresh SDK identity and turn boundary,
    // not a replay of the local transcript. Receipt reconciliation still uses
    // the full guarded reader after submission or for a conflicting old request.
    if(composerBaseline)return response;
    // A page may mix populated legacy turns and empty current turns. Keep the
    // desktop's turn order/cursor, hydrate by exact turn ID, never swap pages.
    const readVersion=sdkReadVersions.get(key);
    const completion=readSessionPage(sessionReader,thread,{limit:300},{continueRead});
    const {page:local,continued}=typeof completion?.then==='function'?await completion:completion;
    // Yielding to finish history invalidates the earlier activity snapshot.
    // Re-read the desktop once, with no second chunk continuation cycle.
    if(continued)return readLocal(id,cursor,limit,{receiptOnly,continueRead:false});
    if(sdkReadVersions.get(key)!==readVersion)throw Object.assign(Error('对话状态在读取期间变化，请重新核对当前轮次'),{code:'THREAD_READ_UNVERIFIED'});
    if(local){
      if(cursor?.startsWith('local:')||!(response.turns??[]).length)return sessionReader.read(thread,{cursor,limit});
      return hydrateSessionTurns(response,local);
    }
  }
  return response;
}
const read=id=>readLocal(id,undefined,3);
const readPage=(id,cursor)=>readLocal(id,cursor);
async function readExecutionTurn(job){
  if(job.taskId&&job.turnId&&job.status==='running'&&!trackedCurrentThread(job)){
    const page=await readLocal(job.threadId,undefined,10,{composerBaseline:true});
    const turn=page.turns?.find(row=>row.id===job.turnId);
    if(turn&&busy(turn.status))return {turn};
  }
  return readJobTurn(readPage,job);
}
const directSync=new DirectProjectSync({root,read,readComposerBaseline:id=>readLocal(id,undefined,1,{composerBaseline:true}),guard:directSyncGuard,guardComposer:(project,threadId)=>directSyncGuard(project,threadId,{composer:true}),validateComposer:(project,threadId)=>validateProjectSync(project,threadId,{composer:true}),composerSend:async(body,timing)=>{
  const input=nativeComposerInput(body),result=await composer.fill(body.requestId,{...input,submit:true,...(body.selection?{selection:body.selection}:{}),...(body.timing===true?{timing:true}:{})});
  timing?.helper(result.timing);
  if(result.status==='failed'&&result.retrySafe===true)throw Object.assign(Error(result.message||'当前聊天尚未发送，草稿已保留'),{notApplied:true});
  return result;
},readReceipt:(id,receipt)=>receipt.deliveryKind==='composer'?readLocal(id,undefined,10,{receiptOnly:true}):read(id),now:refreshNow,scopeFor:value=>sourceAwareJob(state,value),diagnose:input=>diagnostics.record(input),send:args=>bridge.call('send_message_to_thread',args),publication:{
  prepare:project=>projectCatalog.context()?{channel:projectCatalog.channel(),repository:project.repository,recoveryVersion:1,...(project.sourcePath?{sourcePath:project.sourcePath}:{})}:null,
  resolve:async record=>{
    const project=catalog.projects.find(p=>p.projectId===record.projectId);
    if(!project||normalize(project.path)!==normalize(record.path)||project.repository!==record.publication.repository)throw Error('同步项目身份已变化，未发布接入说明');
    if(normalize(project.sourcePath)!==normalize(record.publication.sourcePath))throw Error('源码目录关联已变化，未发布接入说明');
    const mapping=state.workspace.mappings[project.projectId];
    await verifySourceBinding(project,mapping,{inspect:options.inspectSourceRepository});
    const shared=project.sourcePath?state.sync.projectIdentities?.find(p=>p.repository===project.repository):null;
    const publicationMapping=shared?{...mapping,logicalId:shared.logicalId,logicalName:shared.projectName}:mapping;
    return (options.inspectPublishedProject??inspectPublishedProject)(project,publicationMapping);
  },
  finish:async record=>{
    const current=await directSync.publication.resolve(record);
    if(record.publicationOffer&&JSON.stringify(current)!==JSON.stringify(record.publicationOffer))throw Error('项目版本或接入说明已变化，请重新手动同步；未覆盖冻结发布内容');
    return projectCatalog.publish(record.publicationOffer??current,record.publication.channel);
  }
},validate:validateProjectSync});
async function validateProjectSync(project,threadId,{composer=false}={}){
  assertWritable();
  const current=catalog.projects.find(p=>p.projectId===project.projectId),reason=workspaceReason(state,current);
  if(reason||normalize(current?.path)!==normalize(project.path)||current?.repository!==project.repository)throw Object.assign(Error(reason||'项目或仓库已变化，尚未发送'),{notApplied:true});
  if(normalize(current.sourcePath)!==normalize(project.sourcePath))throw Object.assign(Error('源码目录关联已变化，尚未发送'),{notApplied:true});
  await verifySourceBinding(current,state.workspace.mappings[project.projectId],{inspect:options.inspectSourceRepository});
  directSyncGuard(project,threadId,{composer});
}
async function inspectProjectWorkflow(project){
  const id=project.projectId,mapping=state.workspace.mappings[id];
  const inspectedPath=workflowProject({...project,path:project.sourcePath||project.path}).path;
  if(normalize(inspectedPath)===normalize(path.parse(inspectedPath).root))throw Error('请先选定项目目录，不能检查整个磁盘');
  if(mapping?.sourcePath&&normalize(mapping.path)!==normalize(project.path))throw Error('会话目录与原源码关联不一致，请重新核对');
  const scope=(entry,link)=>JSON.stringify([entry?.hostId,normalize(entry?.path),normalize(entry?.sourcePath),entry?.repository,normalize(link?.path),normalize(link?.sourcePath),link?.sourceRepository]);
  const expected=scope(project,mapping);
  const assertCurrent=()=>{
    if(scope(catalog.projects.find(p=>p.projectId===id),state.workspace.mappings[id])!==expected)throw Error('项目或源码关联已变化，请重新检查');
  };
  await verifySourceBinding(project,mapping,{inspect:options.inspectSourceRepository});
  assertCurrent();
  const check=await inspectWorkflow(inspectedPath);
  assertCurrent();
  return {...check,inspectedPath};
}
function directSyncGuard(project,threadId,{composer=false}={}){
  assertWritable();
  const current=catalog.projects.find(p=>p.projectId===project.projectId),reason=workspaceReason(state,current);
  if(reason||normalize(current?.path)!==normalize(project.path)||current?.repository!==project.repository||normalize(current?.sourcePath)!==normalize(project.sourcePath))throw Object.assign(Error(reason||'项目或源码关联已变化，尚未发送'),{notApplied:true});
  const jobs=sourceAwareJobs({...state,jobs:[...state.jobs,...directSync.jobs()]}).filter(j=>['sending','submitted','running','uncertain'].includes(j.status));
  const deny=(code,message)=>{throw Object.assign(Error(message),{code,notApplied:true});};
  if(maintenanceWaiting(state)||closing||restarting)deny('MAINTENANCE_WAIT','面板正在等待安全更新，暂不接收同步；可在设置中取消等待后重试');
  if(syncRunning)deny('SYNC_WAIT','待办同步正在合并，结束后可同步当前项目；本次尚未发送');
  if(directSync.fault)deny('STORAGE_FAULT','同步回执存储异常，请先核对故障日志；本次尚未发送');
  if(composer)return;
  if(jobs.some(j=>j.status==='uncertain'&&sourcePathsOverlap(j,project)))deny('RECEIPT_UNCONFIRMED','当前项目或共用源码有待核对执行，请核对原任务后同步');
  if(sdkActivities.has(activityKey({id:threadId,cwd:project.path})))deny('EXECUTION_WAIT','当前对话仍在执行或等待回复，请结束当前轮次后同步');
  if(sourceHandoffReason(state,project))deny('EXECUTION_WAIT','当前项目或共用源码有对话接续安排，请完成或取消原接续后同步');
  if(dispatching&&(!managedQueue||!dispatchTarget||sourcePathsOverlap(dispatchTarget,project)))deny('EXECUTION_WAIT','当前项目或共用源码正在提交任务，提交完成后可同步');
  if((!managedQueue&&executionSlotCount(jobs)>=2)||jobs.some(j=>sourcePathsOverlap(j,project)))deny('EXECUTION_WAIT','当前项目或共用源码有已发送或待核对执行，请核对对应任务后同步');
}
function sourceHandoffReason(value,target,job){return handoffLockReason(sourceAwareJobs(value,value.tasks),sourceAwareJob(value,target),job);}
function sourceBindingBusy(projectId,proof){
  if(syncRunning||dispatching||restarting||closing||maintenanceWaiting(state)||directSync.fault||directSync.projectBusy(projectId)||pendingInitialDispatches(state).some(r=>r.projectId===projectId)||state.tasks.some(t=>t.projectId===projectId&&handoffPending(t)))return true;
  if(!proof)return false;
  const target={projectId,path:proof.path,sourcePath:proof.sourcePath};if(directSync.activeReason(target))return true;
  return sourceAwareJobs(executionState()).some(j=>['queued','sending','submitted','running','uncertain'].includes(j.status)&&sourcePathsOverlap(j,target))||!!handoffLockReason(sourceAwareJobs(state,state.tasks),target)||[...directSync.records.values()].some(r=>r.publishStatus==='pending'&&sourcePathsOverlap(sourceAwareJob(state,r),target));
}
function executionState(value=state){
  const receipts=directSync.jobs(),known=new Set(receipts.map(j=>j.id));
  const preparing=directSync.activeJobs().filter(j=>!known.has(j.id)).map(j=>({...j,status:'sending',allowParallel:false}));
  return {...value,jobs:[...value.jobs,...receipts,...preparing]};
}
function projectTransferView(){return {...projectCatalog.snapshot(),adoptions:state.jobs.filter(j=>j.operation==='project-adopt').slice(-30).map(j=>({id:j.id,offerId:j.adoption.id,commit:j.adoption.commit,projectId:j.projectId,threadId:j.threadId,status:j.status,codeVerified:!!j.adoptionVerifiedCommit,actualCommit:j.adoptionVerifiedCommit??null,error:j.adoptionError||j.error||'',message:j.message}))};}
async function reconcileAdoptions(){
  for(const job of state.jobs.filter(j=>j.operation==='project-adopt'&&j.status==='completed'&&!j.awaitingUser&&!j.adoptionChecked)){
    const project=catalog.projects.find(p=>p.projectId===job.projectId);let checked,error='';
    try{checked=await (options.inspectTransferDirectory??inspectTransferDirectory)(project,job.adoption,{verifyTarget:true});if(checked.commit!==job.adoption.commit&&!checked.containsTarget)throw Error('实际提交尚未达到接入目标，部署结果请查看原对话');}catch(e){error=e.message;}
    await mutate(draft=>{const current=draft.jobs.find(j=>j.id===job.id);if(current?.status!=='completed'||current.adoptionChecked)return;
      current.adoptionChecked=true;current.adoptionError=error;
      if(!error){try{mapProject(draft,{projectId:project.projectId,logicalId:job.adoption.logicalId,logicalName:job.adoption.name,confirmed:true},[{...project,repository:job.adoption.repository}]);current.adoptionVerifiedCommit=checked.commit;}catch(e){current.adoptionError=e.message;}}
    });
  }
}
function assertRecoveryInactive(id){
  if(sdkActivityOverflow||[...sdkActivities.keys()].some(key=>key.startsWith(id+'\0')))throw Error('原对话仍有已观察到的执行或等待，不能解除占用');
}
async function readForRecovery(id){
  try{
    const raw=await read(id);
    assertRecoveryInactive(id);
    if((raw.turns??[]).some(turn=>busy(turn.status?.type??turn.status)))throw Error('原对话仍有已观察到的执行或等待，不能解除占用');
    const result=recoveryThreadView(raw,id),status=result.thread?.status?.type??result.thread?.status;
    if(status==='notLoaded'||status==='active'&&result.thread?.activityUnknown===true){const scoped=await scopedIdleThread(bridge,sessionReader,id);assertRecoveryInactive(id);return scoped??result;}
    return result;
  }catch(error){
    if(!isThreadReadBlocked(error))throw error;
    assertRecoveryInactive(id);
    const scoped=await scopedIdleThread(bridge,sessionReader,id);assertRecoveryInactive(id);if(scoped)return scoped;
    // A fresh desktop listing supplies live status without loading the
    // transcript. Missing/ambiguous/unknown status never proves idle.
    const listed=await bridge.call('list_threads',{limit:50});
    assertRecoveryInactive(id);
    const matches=[...(listed.pinnedThreads??[]),...(listed.threads??[])].filter(t=>t.id===id);
    if(!matches.length||matches.some(t=>t.kind!=='codex'||t.hostId!=='local'||!t.cwd||(typeof t.status==='string'?t.status:t.status?.type)!=='idle')||matches.some(t=>normalize(t.cwd)!==normalize(matches[0].cwd)))throw Error('尚未从桌面目录确认原对话空闲，不能释放未决记录；请核对原对话后重试');
    return {thread:matches[0],turns:[],page:{}};
  }
}
// 命名规范：<用途><模型后缀>，项目由侧栏分组识别。模型取本机索引或标题后缀；未确认时只回报原因，不改写标题。
async function ensureThreadNaming(threadId,purpose='',automatic=false){
  const thread=catalog.threads.find(t=>t.id===threadId)??null;
  const project=catalog.projects.find(p=>normalize(p.path)===normalize(thread?.cwd??''))??null;
  if(!thread||!project)return {renamed:false,title:thread?.title??'',modelKey:'',modelLabel:'未确认',reason:'尚未在本机项目中确认此对话，未改写标题'};
  const index=sessionReader.models?.([threadId])??{available:false,entries:{},error:''};
  const view=threadModelView(thread,index.entries?.[threadId],modelRegistry.models);
  const unit=String(purpose??'').trim()||titlePurpose({title:thread?.title,projectLabel:project?.label,models:modelRegistry.models});
  const title=canonicalTitle({purpose:unit,key:view.modelKey,models:modelRegistry.models});
  const current=thread?.title??'';
  if(!view.modelKey)return {renamed:false,title:current,modelKey:'',modelLabel:view.modelLabel,reason:'模型未确认，未改写标题；请先让该对话运行一轮，或在标题补模型后缀'};
  if(title===current)return {renamed:false,title,modelKey:view.modelKey,modelLabel:view.modelLabel,reason:''};
  await bridge.call('set_thread_title',{threadId,title});await refreshMetadata();
  return {renamed:true,title,modelKey:view.modelKey,modelLabel:view.modelLabel,reason:''};
}
let syncRunning=false,dispatching=false,dispatchTarget=null;
function assertWritable(){const fault=repository.inspect().fault;if(fault)throw Object.assign(Error('存储状态未确认，已阻止新的同步/领取/发送，请核对后恢复'),{code:fault});}
function recordSyncRepairs(draft,repairs=[]){
  for(const repair of repairs){const task=draft.tasks.find(t=>(t.syncId??t.id)===repair.id);if(task){task.history??=[];task.history.push({...repair,id:randomUUID(),syncId:repair.id,at:new Date().toISOString(),type:'sync-auto-reconciled',note:'两端均已移出待办，仅历史依赖不同，已保留双方依赖并集；未恢复执行。'});}}
}
function checkSyncable(){
  const rich=state.sync.config?.schemaVersion>=2;
  const tasks=state.tasks.filter(t=>!state.workspace.mappings[t.projectId]?.localOnly);
  if(!rich&&tasks.some(t=>t.status==='todo'&&(t.sectionId||t.dependsOn?.length||t.planSourceKey)))throw Error('版块任务需启用完整卡片同步');
  for(const t of state.tasks.filter(t=>t.status==='todo'&&!t.archivedAt)){
    const m=state.workspace.mappings[t.projectId],p=catalog.projects.find(p=>p.projectId===t.projectId);
    if(m?.repository&&(!p||m.repository!==p.repository||(m.automatic&&p.repositoryReason)))throw Error('待办的源码仓库身份暂不可确认，请先核对对应项目');
  }
  if(!rich&&tasks.some(t=>t.status==='todo'&&!t.archivedAt&&hasPortableWorkflow(t)))throw new Error('讨论状态与父子关系需要完整卡片同步');
  if(!rich&&tasks.some(t=>t.status==='todo'&&!t.archivedAt&&requiresLocalProperties(t)))throw new Error('带自定义属性或非默认优先级的待办需启用完整卡片同步');
  if(!rich&&tasks.some(t=>t.status==='todo'&&!t.archivedAt&&t.attachments?.length))throw new Error('带附件的待办需启用完整卡片同步');
}
async function synchronizeTasks(){
  assertWritable();if(dispatching)throw Error('发送提交中，请稍后同步');
  if(maintenanceWaiting(state))throw Error('面板更新正在等待安全重启，同步将在恢复后继续');
  checkSyncable();
  if(syncRunning)throw new Error('待办同步正在进行，请稍后重试');
  if(!state.sync.config)throw new Error('请先设置待办同步位置');
  syncRunning=true;
  try{
    const rich=state.sync.config.schemaVersion>=2,store=makeStore(rich?{...state.sync.config,schemaVersion:4}:state.sync.config),remote=await store.read();
    if(rich){const required=remote.version>=4||state.tasks.some(t=>!state.workspace.mappings[t.projectId]?.localOnly&&hasPortableWorkflow(t))?4:remote.version>=3||state.tasks.some(t=>t.sectionId||t.dependsOn?.length||t.pendingDependencies?.length||t.planSourceKey)?3:2;if(state.sync.config.schemaVersion<required)await mutate(draft=>{draft.sync.config.schemaVersion=required;});}
    store.schemaVersion=state.sync.config.schemaVersion??1;
    if(rich)remote.records=remote.records.map(richRecord);else if(remote.version>=2)throw Error('请先启用完整卡片同步再读取新版待办');
    if(!remote.sha&&state.sync.base.length)throw new Error('远端待办文件缺失，请先核对同步位置；没有覆盖本机记录');
    const identityDraft=structuredClone(state),projectIdentities=reconcileRepositories(identityDraft,catalog.projects,remote.projects??[],remote.records);
    if(JSON.stringify(identityDraft.workspace.mappings)!==JSON.stringify(state.workspace.mappings))await mutate(draft=>reconcileRepositories(draft,catalog.projects,remote.projects??[],remote.records));
    const syncProjects=catalog.projects.filter(p=>!workspaceReason(state,p));
    checkSyncable();const mappingAtMerge=JSON.stringify(state.workspace.mappings),local=portableTasks(state),merged=mergeTasks(state.sync.base,local,remote.records,state.sync.overrides);
    if(merged.conflicts.length){await mutate(draft=>{draft.sync.conflicts=merged.conflicts;});throw new Error('有 '+merged.conflicts.length+' 项待办冲突'+(merged.conflicts[0].reason?'（'+merged.conflicts[0].reason+'）':'')+'，请选择保留内容后再同步');}
    const files=rich?await hydrateRichAttachments(root,state,merged.records,syncProjects,store,async file=>await mutate(draft=>{draft.attachments[file.id]=file;})):new Map();
    const draft=structuredClone(state);applyRemote(draft,merged.records,syncProjects,files);
    const changed=JSON.stringify(merged.records)!==JSON.stringify(remote.records)||(rich&&remote.version!==(state.sync.config.schemaVersion??1))||JSON.stringify(projectIdentities)!==JSON.stringify(remote.projects??[]);
    if(changed&&rich){const uploaded=new Set(remote.records.flatMap(r=>(r.attachments??[]).map(a=>a.sha256)));for(const file of files.values())if(!uploaded.has(file.sha256)){await store.writeAttachment(file,readAttachment(root,file));uploaded.add(file.sha256);}}
    assertWritable();if(changed)await store.write(merged.records,remote.sha,projectIdentities);
    if(JSON.stringify(state.sync.projectIdentities??[])!==JSON.stringify(projectIdentities))await mutate(next=>{next.sync.projectIdentities=projectIdentities;});
    // Requests may arrive during network I/O: refuse to apply over newer local edits.
    checkSyncable();
    const latest=portableTasks(state);
    if(JSON.stringify(latest)!==JSON.stringify(local)){
      const rebased=mergeTasks(local,latest,merged.records);
      if(rebased.conflicts.length){await mutate(draft=>{draft.sync.conflicts=rebased.conflicts;});throw Error('同步期间同一卡片发生并发修改，请核对冲突');}
      const currentFiles=rich?await hydrateRichAttachments(root,state,rebased.records,syncProjects,store,async file=>await mutate(draft=>{draft.attachments[file.id]=file;})):files;
      if(JSON.stringify(portableTasks(state))!==JSON.stringify(latest))throw Error('同步期间本机仍在编辑，稍后继续合并');
      await mutate(next=>{if(JSON.stringify(portableTasks(next))!==JSON.stringify(latest)||JSON.stringify(next.workspace.mappings)!==mappingAtMerge)throw Error('等待提交期间本机已变化，稍后重新合并');applyRemote(next,rebased.records,syncProjects,currentFiles);recordSyncRepairs(next,[...(merged.automaticResolutions??[]),...(rebased.automaticResolutions??[])]);next.sync.base=structuredClone(merged.records);});return {count:rebased.records.filter(r=>!r.deleted).length,pending:true};
    }
    await mutate(next=>{if(JSON.stringify(portableTasks(next))!==JSON.stringify(local)||JSON.stringify(next.workspace.mappings)!==mappingAtMerge)throw Error('等待提交期间本机已变化，稍后重新合并');applyRemote(next,merged.records,syncProjects,files);
      recordSyncRepairs(next,merged.automaticResolutions);
    });return {count:merged.records.filter(r=>!r.deleted).length,automaticallyResolved:merged.automaticResolutions?.length??0};
  }catch(e){await mutate(draft=>{draft.sync.error=e.message;});throw e;}finally{syncRunning=false;}
}
function boardSyncTarget(projectId){
  const project=catalog.projects.find(row=>row.projectId===projectId&&row.hostId==='local');
  const mapping=state.workspace.mappings[projectId];
  if(!project||!mapping||mapping.localOnly||workspaceReason(state,project))throw Error('请先核对当前项目的逻辑身份和本机目录');
  if(!(state.sync.config?.schemaVersion>=2))throw Error('请先配置私有分支并启用完整卡片同步');
  const {repo,branch}=state.sync.config;
  const key=boardSyncKey(JSON.stringify([repo,branch,mapping.logicalId]));
  return {project,logicalId:mapping.logicalId,key,config:{...state.sync.config}};
}
function boardSyncEntry(draft,key,entry){
  draft.sync.boardProjects={...draft.sync.boardProjects,[key]:entry};
}
async function synchronizeBoard(projectId){
  assertWritable();
  if(syncRunning||dispatching||maintenanceWaiting(state))throw Error('面板正在同步、提交或更新，请稍后再试');
  const {project,logicalId,key,config}=boardSyncTarget(projectId);
  const store=makeStore(config),previous=state.sync.boardProjects?.[key]??{};
  if(typeof store.readBoard!=='function'||typeof store.writeBoard!=='function')throw Error('当前同步存储不支持项目看板');
  const local=portableBoard(state,project,logicalId),fingerprint=JSON.stringify(local);
  const checkLatest=draft=>{
    const target=boardSyncTarget(projectId);
    if(target.key!==key||target.project.path!==project.path||JSON.stringify(portableBoard(draft,project,logicalId))!==fingerprint)throw Error('同步期间项目身份或看板资料已变化，请重新同步');
  };
  syncRunning=true;
  try{
    const response=await store.readBoard(logicalId),remote=validateBoard(response.value,logicalId);
    if(!response.sha&&previous.base?.records.length)throw Error('远端项目看板文件缺失，请先核对私有分支');
    const merged=mergeBoards(previous.base,local,remote,previous.choices);
    if(merged.conflicts.length){
      await mutate(draft=>{checkLatest(draft);boardSyncEntry(draft,key,{...previous,conflicts:merged.conflicts});});
      throw Error(`当前项目有 ${merged.conflicts.length} 项看板或资料冲突，请在同步设置选择保留内容`);
    }
    const value=merged.value,files=await boardFiles(root,state,project,value,remote,store,async file=>await mutate(draft=>{draft.attachments[file.id]=file;}));
    const ready=structuredClone(state);
    checkLatest(ready);applyBoard(ready,project,value,files);
    assertWritable();checkLatest(state);
    if(JSON.stringify(value)!==JSON.stringify(remote))await store.writeBoard(logicalId,value,response.sha);
    await mutate(draft=>{
      checkLatest(draft);applyBoard(draft,project,value,files);
      boardSyncEntry(draft,key,{base:value,lastSync:new Date().toISOString()});
    });
    return {cards:value.records.filter(row=>row.kind==='card').length,references:value.records.filter(row=>row.kind==='reference').length,groups:value.records.filter(row=>row.kind.endsWith('-group')).length,attachments:new Set(value.records.flatMap(row=>(row.attachments??[]).map(file=>file.sha256))).size};
  }finally{syncRunning=false;}
}
function boardSyncView(projectId){
  try{
    const {key}=boardSyncTarget(projectId),entry=state.sync.boardProjects?.[key];
    return {boardLastSync:entry?.lastSync??null,boardConflicts:(entry?.conflicts??[]).map(({id,local,remote})=>({id,local,remote,choice:entry.choices?.[id]?.use??null}))};
  }catch{return {boardLastSync:null,boardConflicts:[]};}
}
async function resolveBoardConflict(input){
  const {key}=boardSyncTarget(input.projectId);
  if(!['local','remote'].includes(input.use)||syncRunning)throw Error('同步正在运行或未选择保留内容');
  await mutate(draft=>{
    const entry=draft.sync.boardProjects?.[key],conflict=entry?.conflicts.find(row=>row.id===input.boardConflictId);
    if(!conflict)throw Error('该看板冲突已变化，请重新同步');
    boardSyncEntry(draft,key,{...entry,choices:{...entry.choices,[conflict.id]:{use:input.use,local:conflict.local,remote:conflict.remote}}});
  });
}
const autoSync=new AutoTaskSync({enabled:()=>state.sync.autoEnabled===true&&!!state.sync.config,fingerprint:()=>JSON.stringify([state.sync.config,state.workspace.mappings,state.propertyGroups,portableTasks(state),state.sync.overrides]),blocked:()=>{
  if(restarting||syncRunning||dispatching||repository.inspect().fault||maintenanceWaiting(state))return '等待当前同步或重启结束';
  if(!catalog.projects.length)return '等待读取本机项目目录';
  if(state.sync.conflicts.some(c=>!state.sync.overrides[c.id]&&!mergeDeletedDependencies(c.local,c.remote)))return '请先处理待办冲突';
  try{checkSyncable();return '';}catch(e){return e.message;}
},run:synchronizeTasks});
async function reserveSyncedTask(task,defer=false){
  assertWritable();
  if(syncRunning||dispatching||maintenanceWaiting(state)){if(defer)return false;throw new Error('同步或面板更新正在进行，请稍后执行');}
  if(!task.syncId)return;
  const snapshot=repository.getTask(task.id,task.projectId);
  if(!snapshot||snapshot.value.archivedAt||snapshot.value.status!=='todo'&&!(snapshot.value.syncReserved&&snapshot.value.syncReservationConfirmed))throw Error('任务已移出或状态已变化，未领取');
  syncRunning=true;
  try{
    const store=makeStore(state.sync.config),id=task.syncId;let remote;
    try{remote=await store.read();}catch(error){if(defer&&error.retryableRead===true&&!task.syncReserved)error.safeToRetry=true;throw error;}
    if(repository.getTask(task.id,task.projectId)?.revision!==snapshot.revision)throw Error('领取前任务已变化，请重新核对');
    task=repository.getTask(task.id,task.projectId).value;
    const record=remote.records.find(r=>r.id===id),base=state.sync.base.find(r=>r.id===id);
    if(task.syncReservationConfirmed&&record?.deleted)return;
    if(task.syncReserved)throw new Error('上次领取结果未确认，请先核对远端并手动解除领取');
    if(!record||record.deleted||JSON.stringify(record)!==JSON.stringify(base))throw Object.assign(Error('远端待办已变化或已被其他电脑领取，请先同步核对'),{needsInput:true,recoveryAction:'sync'});
    const content=value=>{const {syncReserved,syncReservationConfirmed,...rest}=value;return JSON.stringify(rest);};
    const before=content(task);
    const records=remote.records.map(r=>r.id===id?{...r,deleted:true}:r);
    // Save a durable reservation first: an uncertain remote write must never re-publish the task.
    await command({operation:'reserveTask',expected:[{entity:'tasks',id:task.id,revision:snapshot.revision}],payload:{id:task.id}});
    await store.write(records,remote.sha);
    await command({operation:'reserveTask',payload:{id:task.id,confirmed:true,records}});
    if(before!==content(repository.getTask(task.id,task.projectId).value))throw new Error('领取期间任务有变化，已保留领取状态，请核对后重新执行');
  }finally{syncRunning=false;}
}
let ticking=null,tickAgain=false,tickResult=null;
function tick({accepted=false}={}){
  if(ticking){if(accepted)tickAgain=true;return tickResult??ticking;}
  if(!accepted&&reconcilingExecutions&&!state.jobs.some(j=>j.status==='queued')&&!executor.hasWork()&&!handoffs.hasWork()&&!directSync.hasWork())return tickResult??reconcilingExecutions;
  if(restarting||closing||(!state.jobs.some(j=>['queued','running','submitted','uncertain'].includes(j.status)||j.operation==='project-adopt'&&j.status==='completed'&&!j.adoptionChecked&&!j.awaitingUser)&&!executor.hasWork()&&!handoffs.hasWork()&&!directSync.hasWork()))return Promise.resolve();
  const reconciliation=reconcileExecutions();ticking=runTick().finally(()=>{ticking=null;if(tickAgain){tickAgain=false;if(!closing&&!restarting)void tick({accepted:true});}});tickResult=Promise.all([ticking,reconciliation]);return tickResult;
}
function nativeSubmitConflict(job){
  return trackedCurrentThread(job)&&job.currentThreadMode==='queue'&&[...new Set([job.basePrompt,job.prompt])].some(description=>composer.hasUnconfirmedSubmit({projectId:job.projectId,threadId:job.threadId,description,files:job.attachments??[]},{includeUnscopedLegacy:true}))
    ? '原窗口发送结果尚待核对，不会重复发送此任务' : '';
}
function queueView(value){return {jobs:sourceAwareJobs(executionState(value)),threads:activityCatalog().activityThreads??activityCatalog().threads,catalogSource:activityCatalog().catalogSource,models:modelRegistry.models,tasks:sourceAwareJobs(value,value.tasks),plans:value.automation.plans,bindings:value.bindings,validateJob:job=>{const nativeReason=nativeSubmitConflict(job);if(nativeReason)return nativeReason;const syncReason=directSync.activeReason(sourceAwareJob(value,job));if(syncReason)return syncReason;const sourceHandoff=sourceHandoffReason(value,job,job);if(sourceHandoff)return sourceHandoff;if(job.operation==='handoff-summary'){const t=value.tasks.find(t=>t.id===job.handoffTaskId);if(!t||t.handoff?.summaryJobId!==job.id||t.handoff.phase!=='summarizing'||instructionHash(t)!==t.handoff.taskHash)return '交接请求已变化，未发送摘要';}const plan=value.automation.plans.find(p=>p.id===job.autoPlanId);return plan?.nodes.some(n=>value.jobs.find(j=>j.id===n.jobId)?.status==='queued'&&!instructionMatches(value.tasks.find(t=>t.id===n.taskId),n.hash))?'计划内容已变化，请停止未发送任务后重新安排':'';}};}
function defaultModelView(){try{return currentModel();}catch(error){return {available:false,error:error.message};}}
function publicCatalog(nativeSession){
  const shown=presentationCatalog().threads,threads=nativeSession?.thread&&!shown.some(t=>t.id===nativeSession.thread.id)?[...shown,nativeSession.thread]:shown;
  return {activityScope:managedQueue?'panel':'desktop',defaultModel:defaultModelView(),projects:catalog.projects,threads,catalogSource:managedQueue?'panel-managed':catalog.catalogSource??'desktop',threadErrors:catalog.threadErrors,modelIndex:catalog.modelIndex};
}
function maintenanceView(){
  const maintenance=state.maintenance;if(!maintenance)return null;
  let reason='';
  if(maintenance.status==='waiting'&&maintenance.kind==='product-update'){
    if(hasUnresolvedUpgradeWork(state))reason='有未决任务或请求，请先核对';
    else if(state.jobs.some(j=>['sending','submitted','running'].includes(j.status)))reason='等待运行中的任务结束';
    else if(state.jobs.some(j=>j.status==='queued'))reason='存在排队任务，请先处理或取消等待';
    else if(state.automation.plans.some(p=>p.status==='active'))reason='存在运行中的自动安排，请先处理';
    else if(state.sync.autoEnabled===true)reason='请先关闭待办自动同步';
    else reason='等待正在进行的读取、保存或同步结束';
  }
  return {status:maintenance.status,error:maintenance.error??'',...(maintenance.kind?{kind:maintenance.kind}:{}),...(reason?{reason}:{})};
}
function statusView(nativeSession){
  const capture=captureSnapshot(state);
  return {...publicCatalog(nativeSession),bindings:state.bindings,workspace:workspaceView(state,catalog.projects),boards:sidecars.snapshot(),workflowChecks:state.workflowChecks??{},caller:state.caller,token,connectionError,lastSync,
    tasks:[],jobs:[],legacyJobs:[],taskSections:[],planIntakes:[],versionRecords:[],versionIntakes:[],propertyGroups:state.propertyGroups??{},automation:{plans:[],routes:[]},capture:{...capture,events:[]},
    projectTransfers:projectTransferView(),sync:{config:state.sync.config,conflicts:[],lastSync:state.sync.lastSync,error:state.sync.error,running:syncRunning,automatic:autoSync.snapshot(),inbox:state.sync.base.filter(r=>!r.deleted&&!Object.values(state.workspace.mappings).some(m=>m.logicalId===r.logicalId)).map(({id,logicalId})=>({id,logicalId}))},
    service:{instanceId,startedAt,restarting,backupConfigSupported:true,...productCapabilities(),nativeMcpSupported:true,nativeBootstrapSupported:true,executionRecoverySupported:true,automaticRecoverySupported:true,scopedActivityRecoverySupported:true,automaticUncertainReleaseSupported:true,safeReadRecoverySupported:true,versionDeleteSupported:true,manualTaskAcceptanceSupported:true,manualPausedExecutionSupported:true,boundedThreadReadSupported:true,diagnosticsSupported:true,desktopCheckSupported:true,desktopContextSupported:true,desktopContextFastCheckSupported:true,desktopContextThreadLookupSupported:true,desktopContextDiagnostics:desktopContext.diagnostics(),connectionDiagnostics:bridge.diagnostics?.()??null,catalogHealthSupported:true,catalogRecoverySupported:true,backgroundChecksSupported:true,catalogHealth:catalogHealth.snapshot(),storage:repository.inspect(),restartSupported:typeof options.requestRestart==='function',maintenanceSupported:true,executionScopesSupported:true,intelligentDispatchSupported:true,asyncStorageSupported:true,projectSyncSupported:true,directProjectSyncSupported:true,nativeProjectSyncSupported:true,projectTransferSupported:true,workflowTasksSupported:true,taskHandoffSupported:true,projectSyncSending:directSync.snapshot(),querySupported:true,modelRoutingSupported:true,modelSeriesRoutingSupported:true,cleanDispatchSupported:true,taskContentSupported:true,composerSupported:true,currentThreadSendSupported:true,directThreadMessageSupported:true,nativeComposerSendSupported:true,composerReceiptLookupSupported:true,projectReferencesSupported:true,projectReferenceTagManagementSupported:true,projectReferenceGroupsSupported:true,projectBoardSyncSupported:true,taskGroupsSupported:true,projectBoardSupported:true,currentThreadModesSupported:true,taskRoundsSupported:true,reviewRecoverySupported:true,taskAcceptanceSupported:true,sourceBindingSupported:true,maintenance:maintenanceView(),impact:maintenanceImpact(state,catalog.projects),activeRequests}};
}
async function ensureQueuedModel(snapshot){
  const job=snapshot.value;if(job.connectionTest&&!job.taskId)return true;
  if(trackedCurrentThread(job)){if(job.sentAt||job.receipt)throw Error('原提交待核对，不会重发');return true;}
  const task=state.tasks.find(t=>t.id===job.taskId),target=currentModel();
  if(job.sentAt||job.receipt)throw Error('此排队记录已有发送意图，需核对原记录；未自动重发');
  if(executor.compatible(job.threadId,target)&&job.modelTarget?.revision===target.revision)return true;
  const record=patch=>command({operation:'recordJob',expected:[{entity:'jobs',id:job.id,revision:snapshot.revision}],payload:{id:job.id,patch,allowed:['queued']}});
  if(!task||job.deliveryKind===CURRENT_THREAD_DELIVERY){if(!executor.compatible(job.threadId,target))throw Error('指定对话与当前默认模型系列不符，等待原目标恢复；未改投其他对话');await record({modelTarget:target});return true;}
  let thread=modelView(job.threadId);
  if(!executor.compatible(job.threadId,target)){
    const reason=executor.allocationReason(task,{id:job.autoPlanId,maxConcurrent:2},job.id);
    if(reason){await record({message:reason});return false;}
    const project=catalog.projects.find(p=>p.projectId===task.projectId),identity=workspaceReason(state,project);if(identity)throw Error(identity);
    if(!executor.hasModelEvidence(job.threadId)){await record({message:'原目标实际模型未确认，等待索引恢复；未发送或新建'});return false;}
    const hash=instructionHash(task);thread=await executor.resolve(task,project,job.threadId,undefined,{existingJobId:job.id});
    if(thread?.initialSubmitted)return false;
    if(!thread){await record({message:'等待当前模型系列的新对话就绪，未发送业务'});return false;}
    if(!instructionMatches(state.tasks.find(t=>t.id===task.id),hash))throw Error('分配期间卡片内容已变化');
  }
  if(currentModel().revision!==target.revision||!executor.compatible(thread.id,target))throw modelReallocation();
  const previous=state.jobs.find(j=>j.id===job.continuedFromJobId||j.id===job.reviewedJobId),base=job.basePrompt??task.description??task.title,feedback=job.feedbackText??task.reviewNote??'';
  const complete=base+(feedback?'\n\n本次反馈：\n'+feedback:''),prompt=previous?(job.prompt===complete?complete:thread.id===previous.threadId?(feedback||'继续处理当前任务，完成后给出结果；需要我回答时请明确提问。'):complete):(job.prompt??base);
  await mutate(draft=>{
    if(repository.getJob(job.id)?.revision!==snapshot.revision)return;
    if(currentModel().revision!==target.revision||!executor.compatible(thread.id,target))throw modelReallocation();
    const current=draft.jobs.find(j=>j.id===job.id);if(current?.status!=='queued'||closing||restarting||maintenanceWaiting(draft))return;
    Object.assign(current,{requestedThreadId:current.requestedThreadId??current.threadId,threadId:thread.id,title:thread.title,routedPrompt:prompt,modelTarget:target,modelRouted:true,...threadModelRecord(modelView(thread.id)),routeMessage:thread.id!==job.threadId?'已切换到当前默认模型系列的对话':'已核对当前默认模型系列',message:'已分配「'+target.modelLabel+'」对话，等待发送'});
    if(current.autoPlanId){const node=draft.automation.plans.find(p=>p.id===current.autoPlanId)?.nodes.find(n=>n.jobId===current.id);if(node)node.threadId=thread.id;}
  },'reallocateQueuedModel');return true;
}
let reconcilingExecutions=null;
const uncertainRecoveryPolls=new Map();
const automaticRecoveryBlocked=()=>closing||restarting||syncRunning||dispatching||maintenanceWaiting(state)||directSync.fault||directSync.active.size>0||directMessages.fault||directMessages.active.size>0||Object.values(state.threadRequests??{}).some(r=>r.status==='creating');
const automaticSourceBinding=new AutomaticSourceBinding({getState:()=>state,getProjects:()=>catalog.projects,mutate,inspect:options.inspectSourceRepository,now:refreshNow,
  blocked:()=>automaticRecoveryBlocked()||!!repository.inspect().fault||!!connectionError,
  busy:(id,proof)=>sourceBindingBusy(id,proof)||[...directMessages.records.values()].some(r=>['sending','uncertain'].includes(r.status)&&(r.projectId===id||!r.projectId)),
  validate:async(job,project)=>{const generation=catalogHealth.generation,response=await readForRecovery(job.threadId),thread=response.thread;if(thread?.id!==job.threadId||thread.kind!=='codex'||thread.hostId!=='local'||normalize(thread.cwd)!==normalize(project.path)||(thread.status?.type??thread.status)!=='idle')throw Error('上传对话归属或空闲尚未确认');return ()=>{assertRecoveryInactive(job.threadId);return generation===catalogHealth.generation;};}
});
async function autoBindUploadedSource(){
  const result=await automaticSourceBinding.run();
  if(result){
    const previous=catalog,mappings=state.workspace.mappings,generation=catalogHealth.generation;
    const projects=await identifyProjects(previous.projects,options.inspectRepository,mappings);
    if(catalog===previous&&state.workspace.mappings===mappings&&generation===catalogHealth.generation)catalog.projects=projects;
  }
}
function recoverySubmissionStamp(value,job){
  const target=sourceAwareJob(value,job),related=r=>r.projectId===job.projectId||r.threadId===job.threadId||!!r.path&&sourcePathsOverlap(sourceAwareJob(value,r),target);
  return JSON.stringify({jobs:dispatchQueueJobs(executionState(value)).filter(related).map(j=>[j.id,j.threadId,j.status,j.sentAt,j.turnId]),messages:[...directMessages.records.values()].filter(related).map(r=>[r.id,r.threadId,r.status,r.signature]),sync:[...directSync.records.values()].filter(related).map(r=>[r.id,r.threadId,r.status,r.signature]),creates:Object.entries(value.threadRequests??{}).filter(([,r])=>related(r)).map(([id,r])=>[id,r.status,r.receipt?.threadId])});
}
async function recoverIdleUncertain(snapshot){
  const job=snapshot.value,task=job.taskId?repository.getTask(job.taskId):null;
  const retry=uncertainRecoveryPolls.get(job.id),at=refreshNow();
  if(automaticRecoveryBlocked()||!automaticUncertainCandidate(state,job,catalog.projects)||retry&&retry.next>at)return false;
  if(!retry&&uncertainRecoveryPolls.size>=1000)uncertainRecoveryPolls.delete(uncertainRecoveryPolls.keys().next().value);
  const attempts=(retry?.attempts??0)+1;
  uncertainRecoveryPolls.set(job.id,{attempts,next:at+[5000,15000,30000,60000][Math.min(attempts-1,3)]});
  try{
    const submissions=recoverySubmissionStamp(state,job);
    const before=sessionReader.identity?.(job.threadId);
    if(!before||before.id!==job.threadId||before.archived!==false||!before.file||normalize(before.cwd)!==normalize(job.path))return false;
    const current=await readForRecovery(job.threadId);
    if(validateReviewThread(current.thread,job)!=='idle')return false;
    // A progressive second read may now contain the exact original result.
    // Leave it to normal reconciliation, including its model/adoption rules.
    if(matchingTurn(current.turns??[],job))return false;
    const released=await mutate(draft=>{
      assertWritable();assertRecoveryInactive(job.threadId);
      if(maintenanceWaiting(draft)||automaticRecoveryBlocked()||repository.getJob(job.id)?.revision!==snapshot.revision||task&&repository.getTask(task.value.id)?.revision!==task.revision||!automaticUncertainCandidate(draft,draft.jobs.find(j=>j.id===job.id),catalog.projects))return false;
      if(recoverySubmissionStamp(draft,job)!==submissions)return false;
      const after=sessionReader.identity?.(job.threadId);
      if(!after||after.id!==before.id||after.archived!==false||normalize(after.cwd)!==normalize(before.cwd)||normalize(after.file)!==normalize(before.file))return false;
      const input={id:job.taskId??job.id,confirmed:true,note:'已自动核对本机原对话空闲及索引归属；仅解除历史执行占用，成果未验收，不重发旧消息。'};
      if(job.taskId)resolveUncertainTask(draft,input,{automatic:true});else resolveLegacyJob(draft,input,{automatic:true});
      return true;
    },'automaticUncertainRelease');
    if(released)uncertainRecoveryPolls.delete(job.id);
    return released;
  }catch(error){diagnostics.record({phase:'uncertain-recovery',projectId:job.projectId,threadId:job.threadId,error});return false;}
}
const activeCurrentThreadResult=job=>trackedCurrentThread(job)&&['running','submitted'].includes(job.status);
let lastCurrentThreadResultCheckAt=-Infinity;
function reconcileExecutions({currentThreadOnly=false}={}){
  if(reconcilingExecutions)return reconcilingExecutions;
  if(state.jobs.some(activeCurrentThreadResult))lastCurrentThreadResultCheckAt=refreshNow();
  reconcilingExecutions=track((async()=>{assertWritable();
    if(!currentThreadOnly)await directSync.reconcile();
    const unresolved=[];
    for(const id of uncertainRecoveryPolls.keys())if(repository.getJob(id)?.value.status!=='uncertain')uncertainRecoveryPolls.delete(id);
    for(const row of repository.queryQueue(currentThreadOnly?['running','submitted']:['running','submitted','uncertain']).items){
      const snapshot=repository.getJob(row.id),j=snapshot.value;let patch,matched=false;
      if(currentThreadOnly&&!activeCurrentThreadResult(j))continue;
      try{
        const found=await readExecutionTurn(j),turn=found.turn;
        if(!turn){patch={message:found.reason};if(['submitted','running'].includes(j.status)&&Date.now()-Date.parse(j.lastSeenAt??j.sentAt??j.createdAt)>120000)Object.assign(patch,{status:'uncertain',error:'尚未可靠关联本轮，请人工核对；不会自动重发'});}
        else{matched=true;
          patch=jobTurnPatch(j,turn,modelRegistry.models);
        }
      }catch(e){
        patch={error:e.message};
        if(isThreadReadBlocked(e)||Date.now()-Date.parse(j.lastSeenAt??j.sentAt??j.createdAt)>120000)Object.assign(patch,{status:'uncertain',message:'暂不能核对本轮结果，已保留执行锁；请核对原对话后通过未决解除处理，不会自动重发'});
      }
      // A release, capture, or cancellation may commit while the read waits.
      // Never use identity of a previously returned DTO to decide ownership.
      if(repository.getJob(j.id)?.revision!==snapshot.revision)continue;
      await command({operation:'recordJob',expected:[{entity:'jobs',id:j.id,revision:snapshot.revision}],payload:{id:j.id,patch,allowed:['running','submitted','uncertain']}});
      if(j.status==='uncertain'&&!matched)unresolved.push(j.id);
      if(j.deliveryKind==='create'&&patch.modelMismatch)await mutate(s=>{const route=Object.values(s.automation.routes).find(r=>r.initialDispatch?.jobId===j.id);if(route){route.status='model-mismatch';route.error=patch.modelMismatch;}const plan=s.automation.plans.find(p=>p.id===j.autoPlanId);if(plan){plan.status='paused';plan.reason=patch.modelMismatch;}});
      if(patch.modelActual&&!patch.modelMismatch&&['completed','failed','interrupted'].includes(patch.status)&&Object.values(state.automation.routes).some(r=>r.source==='created'&&r.threadId===j.threadId)){
        try{await refreshMetadata();await ensureThreadNaming(j.threadId,'',true);}catch{/* 标题仍可在项目设置中手动修正，不影响任务结果 */}
      }
    }
    if(currentThreadOnly)return;
    await reconcileAdoptions();
    await autoBindUploadedSource();
    // Exact original results have priority. One due idle check per pass keeps
    // failed old reads from delaying other jobs; untried records sort first.
    unresolved.sort((a,b)=>(uncertainRecoveryPolls.get(a)?.next??0)-(uncertainRecoveryPolls.get(b)?.next??0));
    for(const id of unresolved){const snapshot=repository.getJob(id);if(snapshot?.value.status!=='uncertain'||!automaticUncertainCandidate(state,snapshot.value,catalog.projects)||(uncertainRecoveryPolls.get(id)?.next??0)>refreshNow())continue;await recoverIdleUncertain(snapshot);break;}

})().catch(error=>diagnostics.record({phase:'execution-reconcile',error})).finally(()=>{reconcilingExecutions=null;}));return reconcilingExecutions;
}
async function runTick(){
  try{
    assertWritable();
    if(closing||restarting)return;
    if(!syncRunning&&!maintenanceWaiting(state)){await handoffs.advance();await executor.advance();}
    const active=dispatchQueueJobs(executionState()).filter(j=>['sending','submitted','running','uncertain'].includes(j.status));
    if(!syncRunning&&!maintenanceWaiting(state)&&(managedQueue||executionSlotCount(active)<2)&&state.jobs.some(j=>j.status==='queued')){
      let eligible=false;
      for(const row of repository.queryQueue(['queued']).items){
        const snapshot=repository.getJob(row.id),job=snapshot?.value;if(job?.status!=='queued')continue;
        const reason=queuedJobLocalReason(job,queueView(state));
        if(!reason){eligible=true;continue;}
        await command({operation:'recordJob',expected:[{entity:'jobs',id:job.id,revision:snapshot.revision}],payload:{id:job.id,patch:{message:reason},allowed:['queued']}});
      }
      if(!eligible)return;
      if(await refresh({automatic:true,force:true})===false)return;
      for(const row of repository.queryQueue(['queued']).items.sort((a,b)=>(state.tasks.find(t=>t.id===a.taskId)?.priority??a.taskPriority??2)-(state.tasks.find(t=>t.id===b.taskId)?.priority??b.taskPriority??2))){
        if(closing||restarting||syncRunning||directSync.fault||maintenanceWaiting(state))break;
        let snapshot=repository.getJob(row.id);let j=snapshot?.value;if(j?.status!=='queued')continue;
        try{if(!await ensureQueuedModel(snapshot))continue;snapshot=repository.getJob(row.id);j=snapshot?.value;if(j?.status!=='queued')continue;}
        catch(error){await command({operation:'recordJob',expected:[{entity:'jobs',id:j.id,revision:snapshot.revision}],payload:{id:j.id,patch:{message:error.message,error:error.code==='MODEL_REALLOCATION'?'':error.message},allowed:['queued']}});continue;}
        let prepared;
        try{prepared=await prepareQueuedJob(j,()=>queueView(state),read);}
        catch(error){
          if(error.code==='THREAD_LOG_MISSING'&&j.taskId&&j.deliveryKind!==CURRENT_THREAD_DELIVERY&&!j.operation&&!j.connectionTest){
            const task=state.tasks.find(t=>t.id===j.taskId),project=catalog.projects.find(p=>p.projectId===j.projectId);
            try{const identity=workspaceReason(state,project);if(identity)throw Error(identity);await executor.resolve(task,project,j.threadId,undefined,{existingJobId:j.id});continue;}catch(recovery){error=recovery;}
          }
          prepared={ready:false,message:'读取执行对话失败，未发送：'+error.message,error:error.message};
        }
        if(closing||restarting||syncRunning||directSync.fault||maintenanceWaiting(state))break;
        const latest=repository.getJob(j.id);if(latest?.revision!==snapshot.revision)continue;
        const record=async patch=>await command({operation:'recordJob',expected:[{entity:'jobs',id:j.id,revision:latest.revision}],payload:{id:j.id,patch,allowed:['queued']}});
        if(!prepared.ready){await record({message:prepared.message,...(prepared.error?{error:prepared.error}:{})});continue;}
        if(!trackedCurrentThread(j)&&!(j.connectionTest&&!j.taskId)&&(currentModel().revision!==j.modelTarget?.revision||!executor.compatible(j.threadId,currentModel()))){await record({message:'默认模型已变化，等待重新分配'});continue;}
        const before=prepared.before;
        let filePrompt;try{filePrompt=attachmentPrompt(root,j.attachments??[]);}catch(e){await record({status:'failed',error:e.message});continue;}
        const project=catalog.projects.find(p=>p.projectId===j.projectId),reason=workspaceReason(state,project);
        if(['workflow-init','github-upgrade','project-adopt'].includes(j.operation)){
          try{workflowProject(project);if(normalize(project.path)!==normalize(j.path))throw Error('项目目录已变化，请取消后重新核对');}catch(e){await record({message:e.message});continue;}
        }else if(reason&&!j.connectionTest){await record({message:reason});continue;}
        if(project?.sourcePath)try{await verifySourceBinding(project,state.workspace.mappings[j.projectId],{inspect:options.inspectSourceRepository});}catch(error){await record({message:error.message});continue;}
        if(j.operation==='project-adopt')try{await (options.inspectTransferDirectory??inspectTransferDirectory)(project,j.adoption);}catch(error){await record({message:error.message});continue;}
        const useTaskId=trackedCurrentThread(j)&&j.currentThreadMode==='queue'&&!!j.taskId;
        j.baseline=before.turns?.[0]?.id;j.correlationToken=useTaskId?null:'panel-run-'+randomUUID();j.sentAt=new Date().toISOString();j.error='';
        // 业务发送已核对默认模型与目标实际系列；登记本次新鲜目录快照。
        const threadView=modelView(j.threadId)??catalog.threads.find(t=>t.id===j.threadId);
        if(!trackedCurrentThread(j)&&!(j.connectionTest&&!j.taskId)&&!executor.compatible(j.threadId,currentModel())){await record({message:'目标实际模型变化，等待重新核对'});continue;}
        Object.assign(j,threadModelRecord(threadView));
        // 关联标识只出现一次：任务派发由 developmentPrompt 在任务标识后写入，其余入口在此写入。
        const marker=useTaskId?taskIdHeader(j.taskId):'[面板轮次标识：'+j.correlationToken+'，仅用于结果关联]\n';
        const meta='[面板派发] 项目：'+(j.project??'')+' · 模型：'+(j.modelLabel||threadView?.modelLabel||'模型未确认')+'\n\n';
        const dispatchText=(trackedCurrentThread(j)?marker+j.prompt:j.operation==='github-upgrade'?marker+meta+githubUpgradePrompt(project,j.upgrade):j.operation==='workflow-init'?marker+meta+initializationPrompt(project):j.operation==='project-adopt'?marker+meta+j.prompt:j.connectionTest?marker+meta+j.prompt:developmentPrompt({...j,prompt:j.routedPrompt??j.prompt},state.workspace.mappings[j.projectId],state.workspace.deviceLabel))+sourceContext(project)+filePrompt;if((!j.operation||j.operation==='handoff-summary')&&!j.connectionTest)j.dispatchVersion=useTaskId?CURRENT_THREAD_TASK_ID_VERSION:2;if(!Object.hasOwn(j,'dispatchPrompt'))j.dispatchPrompt=dispatchText;j.routedDispatchPrompt=dispatchText;j.status='sending';j.message='正在交给桌面端；如有审批，请在 Codex 处理';
        dispatching=true;dispatchTarget=sourceAwareJob(state,j);
        try{
        await mutate(draft=>{
          if(closing||restarting||maintenanceWaiting(draft))throw Error('面板正在关闭或等待更新，未发送');
          if(repository.getJob(j.id)?.revision!==latest.revision)throw Object.assign(Error('发送前记录已变化'),{code:'CONFLICT_REVISION'});
          const current=draft.jobs.find(row=>row.id===j.id),reason=queuedJobReason(current,queueView(draft));if(reason)throw Error(reason);
          if(!trackedCurrentThread(j)&&!(j.connectionTest&&!j.taskId)&&(currentModel().revision!==j.modelTarget?.revision||!executor.compatible(j.threadId,currentModel())))throw modelReallocation();
          const currentProject=catalog.projects.find(p=>p.projectId===j.projectId);if(normalize(currentProject?.path)!==normalize(j.path))throw Error('项目目录已变化，未发送');
          if(!j.connectionTest&&!['workflow-init','github-upgrade','project-adopt'].includes(j.operation)){const reason=workspaceReason(draft,currentProject);if(reason)throw Error(reason);}
          Object.assign(current,j);
        },'prepareDispatch');
        const intent=repository.getJob(j.id);let receiptPatch;
        await options.beforeDispatch?.();
        // The intent is durable, but no desktop write has happened yet.
        // Recheck after model routing, attachment reads and storage awaits.
        try{
          if(j.operation==='project-adopt')await (options.inspectTransferDirectory??inspectTransferDirectory)(catalog.projects.find(p=>p.projectId===j.projectId),j.adoption);
          await requireActivities({automatic:true,force:true});
          if(managedQueue){const target=await read(j.threadId),reason=queuedThreadReason(j,target);if(reason)throw catalogUnverified(reason);if(target.turns?.[0]?.id!==j.baseline)throw catalogUnverified('目标对话轮次已变化，重新检查后执行');}
          const current=repository.getJob(j.id);
          if(current?.revision!==intent.revision)continue;
          const finalProject=catalog.projects.find(project=>project.projectId===j.projectId),finalThread=catalog.threads.find(thread=>thread.id===j.threadId);
          if(normalize(finalProject?.path)!==normalize(j.path)||!finalThread||finalThread.kind!=='codex'||finalThread.hostId!=='local'||normalize(finalThread.cwd)!==normalize(j.path))throw catalogUnverified('项目目录或执行对话归属已变化，未发送');
          if(!j.connectionTest&&!['workflow-init','github-upgrade','project-adopt'].includes(j.operation)){const reason=workspaceReason(state,finalProject);if(reason)throw catalogUnverified(reason);}
          await verifySourceBinding(finalProject,state.workspace.mappings[j.projectId],{inspect:options.inspectSourceRepository});
          const finalQueue=queueView(state),reason=queuedJobReason({...current.value,status:'queued'},{...finalQueue,jobs:finalQueue.jobs.filter(job=>job.id!==j.id)});
          if(reason)throw catalogUnverified(reason);
        }catch(error){
          if(repository.getJob(j.id)?.revision===intent.revision)await command({operation:'recordJob',expected:[{entity:'jobs',id:j.id,revision:intent.revision}],payload:{id:j.id,patch:{status:'queued',sentAt:null,correlationToken:null,baseline:null,message:(managedQueue?'已安排，等待执行条件：':'已安排，等待完整活动核验：')+error.message},allowed:['sending']}});
          continue;
        }
        let modelGuard='';try{if(!trackedCurrentThread(j)&&!(j.connectionTest&&!j.taskId)&&(currentModel().revision!==j.modelTarget?.revision||!executor.compatible(j.threadId,currentModel())))modelGuard='默认模型变化，重新分配';const activity=sdkActivities.get(activityKey({id:j.threadId,cwd:j.path}));if(activity&&(!steeringCurrentThread(j)||(activity.status?.type??activity.status)==='waitingForApproval'))modelGuard='当前对话状态已变化，等待原对话空闲';}catch(error){modelGuard=error.message;}
        if(modelGuard){
          await command({operation:'recordJob',expected:[{entity:'jobs',id:j.id,revision:intent.revision}],payload:{id:j.id,patch:{status:'queued',sentAt:null,correlationToken:null,baseline:null,message:modelGuard+'；尚未调用发送'},allowed:['sending']}});continue;
        }
        if(!catalogHealth.fresh()){await command({operation:'recordJob',expected:[{entity:'jobs',id:j.id,revision:intent.revision}],payload:{id:j.id,patch:{status:'queued',sentAt:null,correlationToken:null,baseline:null,message:'已安排，活动快照过期，等待重新核验'},allowed:['sending']}});continue;}
        try{const receipt=await bridge.call('send_message_to_thread',{threadId:j.threadId,hostId:'local',prompt:dispatchText});receiptPatch={receipt,status:'submitted',message:'已提交桌面端，等待本次回复'};}
        catch(e){receiptPatch={status:'uncertain',error:e.message,message:'发送未确认，请核对原对话；不会自动重发'};}
        await command({operation:'recordJob',expected:[{entity:'jobs',id:j.id,revision:intent.revision}],payload:{id:j.id,patch:receiptPatch,allowed:['sending']}});
        }finally{dispatching=false;dispatchTarget=null;}
      }
    }
  }catch(e){connectionError=e.message;diagnostics.record({phase:'execution-tick',error:e});}
}
const sidecars=new BoardSidecars({getState:()=>state,getCatalog:()=>catalog,mutate,open:args=>bridge.call('open_in_codex',args),origin});
const capture=new ConversationCapture({getState:()=>state,getCatalog:()=>catalog,mutate,read:readPage});
function allocationGate(){return closing||restarting||maintenanceWaiting(state)?'MAINTENANCE_WAIT':syncRunning?'SYNC_WAIT':dispatching?'EXECUTION_WAIT':directSync.fault||repository.inspect().fault?'STORAGE_FAULT':'';}
function allocationBlocked(){const code=allocationGate(),projects=[...new Set(state.automation.plans.filter(p=>['active','paused'].includes(p.status)&&p.nodes.some(n=>!n.jobId&&!n.skipped)).map(p=>p.projectId))];diagnostics.gate(code,projects);return !!code;}
const executor=new AutoExecutor({now:refreshNow,getState:()=>executionState(),getCatalog:()=>activityCatalog(),assertCatalog:()=>catalogHealth.assertFresh(),mutate,refresh:(input={})=>refresh({automatic:input.automatic??true,force:input.force??false,threadId:input.threadId}),read,create:args=>{catalogHealth.assertFresh();return bridge.call('create_thread',args);},initialDispatch:args=>initialDispatcher.start(args),models:modelRegistry.models,getDefaultModel,modelView,label:(threadId,purpose)=>ensureThreadNaming(threadId,purpose,true),blocked:allocationBlocked,reserve:task=>reserveSyncedTask(task,true),validateAttachments:(task,project)=>{const reason=workspaceReason(state,project);if(reason)throw Object.assign(Error(reason),{needsInput:true,recoveryAction:'settings'});try{attachmentPrompt(root,task.attachments??[]);}catch(error){throw Object.assign(error,{needsInput:true,recoveryAction:'edit'});}}});
const initialDispatcher=new InitialDispatcher({getState:()=>executionState(),getCatalog:()=>activityCatalog(),read,mutate,assertCatalog:()=>catalogHealth.assertFresh(),create:args=>bridge.call('create_thread',args),refresh:input=>refresh({automatic:true,...input}),currentModel:()=>executor.currentModel(),hasModelEvidence:id=>executor.hasModelEvidence(id),compatible:(id,target)=>executor.compatible(id,target),reserve:task=>reserveSyncedTask(task,true),blocked:()=>closing||restarting||directSync.fault||maintenanceWaiting(state)||repository.inspect().fault,
  verifyProject:async project=>{const current=catalog.projects.find(p=>p.projectId===project.projectId);if(normalize(current?.path)!==normalize(project.path)||normalize(current?.sourcePath)!==normalize(project.sourcePath))throw Object.assign(Error('会话或源码关联已变化，未创建执行'),{notApplied:true});await verifySourceBinding(current,state.workspace.mappings[project.projectId],{inspect:options.inspectSourceRepository});},
  validateAllocation:(task,plan,own)=>{const syncReason=directSync.activeReason(sourceAwareJob(state,task));if(syncReason)throw Object.assign(Error(syncReason),{notApplied:true});const reason=executor.allocationReason(task,plan,own);if(reason)throw Object.assign(Error(reason),{notApplied:true});if((task.dependsOn??[]).some(id=>!dependencySatisfied(state.tasks.find(t=>t.id===id),state.jobs,plan.gate)))throw Object.assign(Error('前置任务状态已变化，未创建执行'),{notApplied:true});},
  buildPrompt:(task,job,plan)=>{const previous=task.pendingContinuation||job?.continuedFromJobId||job?.reviewedJobId,body=job?.basePrompt??task.description??task.title,feedback=job?.feedbackText??task.reviewNote??'';return developmentPrompt({prompt:previous?body+(feedback?'\n\n本次反馈：\n'+feedback:''):job?.prompt??body,allowParallel:job?.allowParallel??(plan.maxConcurrent!==1&&task.execution?.parallel!==false),writePaths:task.execution?.writePaths,sectionSnapshot:job?.sectionSnapshot??state.taskSections.find(s=>s.id===task.sectionId&&s.projectId===task.projectId)})+sourceContext(catalog.projects.find(p=>p.projectId===task.projectId))+attachmentPrompt(root,task.attachments??[]);}});
const handoffs=new HandoffCoordinator({now:refreshNow,getState:()=>state,getCatalog:()=>catalog,read,mutate,
  blocked:()=>closing||restarting||syncRunning||dispatching||directSync.fault||maintenanceWaiting(state)||repository.inspect().fault,
  activeCount:()=>managedQueue?0:executionSlotCount(dispatchQueueJobs(executionState()).filter(j=>['sending','submitted','running','uncertain'].includes(j.status))),
  start:({task,project,prompt,handoffId,validateSource})=>{
    const assertCurrent=(s=state)=>{const t=s.tasks.find(t=>t.id===task.id);if(!t||t.handoff?.id!==handoffId||!['ready','creating'].includes(t.handoff.phase)||instructionHash(t)!==t.handoff.taskHash||t.currentJobId!==t.handoff.sourceJobId)throw Error('接续请求已变化');const syncReason=directSync.activeReason(sourceAwareJob(s,task));if(syncReason)throw Object.assign(Error(syncReason),{code:'SYNC_WAIT'});const own=s.automation.routes['handoff:'+handoffId]?.initialDispatch?.jobId;const active=sourceAwareJobs(executionState(s)).filter(j=>j.id!==own&&['sending','submitted','running','uncertain'].includes(j.status));if((!managedQueue&&executionSlotCount(active)>=2)||active.some(j=>sourcePathsOverlap(j,sourceAwareJob(s,task))))throw Object.assign(Error('执行容量或项目活动已变化，未创建接续'),{code:'EXECUTION_WAIT'});const reason=workspaceReason(s,catalog.projects.find(p=>p.projectId===task.projectId));if(reason)throw Error(reason);};
    const target=executor.currentModel(),key='handoff:'+handoffId;
    return initialDispatcher.start({task,project,target,assertCurrent,handoff:{id:handoffId,validateSource,buildPrompt:latest=>{const source=state.jobs.find(j=>j.id===latest.handoff.sourceJobId);return developmentPrompt({prompt,allowParallel:!!source?.allowParallel,writePaths:source?.writePaths??latest.execution?.writePaths,sectionSnapshot:source?.sectionSnapshot??state.taskSections.find(s=>s.id===latest.sectionId&&s.projectId===latest.projectId)})+sourceContext(catalog.projects.find(p=>p.projectId===latest.projectId))+attachmentPrompt(root,latest.attachments??[]);}},route:{key,baseKey:key,projectId:task.projectId,path:task.path,sectionId:task.sectionId??null,unit:task.execution?.unit??task.title,title:task.title+' · 接续',modelKey:target.modelKey,modelProvider:target.modelProvider,modelRevision:target.revision}});
  }});

function restartBusy(allowedRequests=0){return !!desktopCheckFlight||!!releaseStaging||!!releaseScheduler?.pending||!!reconcilingExecutions||!!automaticSourceBinding.pending||executionReads.size>0||executionInspections.size>0||directMessages.active.size>0||!!composer.active||directSync.active.size>0||directSync.jobs().some(j=>j.status!=='queued')||pendingInitialDispatches(state).length>0||repository.inspect().queued>0||activeRequests>allowedRequests||syncRunning||dispatching||ticking||refreshing||metadataRefreshing||connecting||sidecars.running||Object.values(state.threadRequests??{}).some(r=>r.status==='creating');}
function hasUnresolvedUpgradeWork(value){
  return !!directMessages.fault||Array.from(directMessages.records.values()).some(receipt=>['sending','uncertain'].includes(receipt.status))
    ||value.jobs.some(job=>job.awaitingUser||job.status==='uncertain')
    ||pendingInitialDispatches(value).length>0||value.tasks.some(task=>task.initialDispatch||handoffPending(task))
    ||Object.values(value.threadRequests??{}).some(request=>['creating','pending','uncertain'].includes(request.status));
}
function productUpdateBlocked(value){return hasUnresolvedUpgradeWork(value)||value.jobs.some(job=>['queued','sending','submitted','running'].includes(job.status))||value.automation.plans.some(plan=>plan.status==='active')||value.sync.autoEnabled===true;}
function requestServiceRestart(){
  setTimeout(()=>{Promise.resolve().then(()=>options.requestRestart()).catch(async error=>{
    restarting=false;await mutate(draft=>{draft.maintenance={status:'failed',error:'重启失败：'+error.message};});
  });},100);
}
function requestServiceUpdate(id){
  setTimeout(()=>{Promise.resolve().then(()=>options.requestUpdate({id})).catch(async error=>{
    restarting=false;await mutate(draft=>{draft.maintenance={status:'failed',kind:'product-update',error:'升级启动失败：'+error.message};});
  });},100);
}
async function maintenanceTick(){
  if(closing||restarting||restartChecking||!maintenanceWaiting(state)||restartBusy()||state.jobs.some(j=>['sending','submitted','running','uncertain'].includes(j.status)))return;
  const waiting=state.maintenance,product=waiting.kind==='product-update';
  const {stageId,stageProof}=waiting,request=JSON.stringify(waiting);
  const sameRequest=value=>JSON.stringify(value.maintenance)===request;
  if(product&&productUpdateBlocked(state))return;
  let consumed=false;restartChecking=true;
  try{
    await (options.checkRestart??(()=>checkRestartCode(programRoot,{installed:separateData})))();
    // Cancellation and running work may change while the checker is outside
    // the HTTP process. Never arm an update from an obsolete waiting request.
    if(closing||!sameRequest(state)||restartBusy()||state.jobs.some(j=>['sending','submitted','running','uncertain'].includes(j.status)))return;
    if(product){
      if(productUpdateBlocked(state))return;
      if(!releaseScheduler||typeof options.requestUpdate!=='function')throw Error('当前启动方式不支持产品升级');
      const staged=await verifyStagedRelease({...releaseConfig,root,stageId});
      const saved=await releaseCheckStore(root).read();
      if(!saved?.envelope||createHash('sha256').update(JSON.stringify(saved.envelope)).digest('hex')!==stageProof)throw Error('可用更新已变化，请重新检查和下载');
      if(closing||!sameRequest(state)||restartBusy()||productUpdateBlocked(state))return;
      const backupRoot=configuredBackupRoot(root);if(!backupRoot)throw Error('请先配置本机备份目录');
      restarting=true;consumed=await mutate(draft=>{if(!sameRequest(draft)||productUpdateBlocked(draft))return false;delete draft.maintenance;return true;});
      if(!consumed){restarting=false;return;}
      fs.mkdirSync(validateBackupRoot(root,backupRoot),{recursive:true});
      const backupPath=path.join(backupRoot,localBackupStamp()+'_升级备份_'+randomUUID().slice(0,8));
      await backupInstalledData({source:root,backup:backupPath,lease:dataLock});
      const tx=beginReleaseTransaction({root,lease:dataLock,stageId,oldVersion:releaseConfig.version,newVersion:staged.version,sha256:staged.sha256});
      advanceReleaseTransaction({root,lease:dataLock,id:tx.id,phase:'backed-up',data:{backupPath}});
      requestServiceUpdate(tx.id);return;
    }
    restarting=true;await repository.backup(restartBackup);
    consumed=await mutate(draft=>{if(!sameRequest(draft))return false;armMaintenance(draft);return true;});
    if(!consumed){restarting=false;return;}
    requestServiceRestart();
  }catch(error){restarting=false;if(consumed||sameRequest(state))await mutate(draft=>{if(consumed||sameRequest(draft))draft.maintenance={status:'failed',...(product?{kind:'product-update'}:{}),error:error.message};});}
  finally{restartChecking=false;}
}
const json=(res,status,value)=>{
  res.syncTiming?.outcome(value);
  if(status>=400&&value?.error&&res.diagnosticContext){const diagnosticId=diagnostics.record({...res.diagnosticContext,phase:'http',status,error:res.diagnosticError,code:value.code,message:value.error,notApplied:value.notApplied});if(diagnosticId)value={...value,diagnosticId};}
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));
};
async function body(req,limit=1024*1024){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>limit)throw new Error('请求过大');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
async function handleRequest(req,res){
  try{
    if(closing)return json(res,503,{error:'面板正在关闭，请等待重连'});
    if(req.headers.host!==address)return json(res,403,{error:'仅允许本机地址访问'});
    if(req.headers.origin&&req.headers.origin!==origin)return json(res,403,{error:'拒绝跨站请求'});
    const url=new URL(req.url,origin);
    if(pendingStartup&&(req.method!=='GET'||url.pathname!=='/api/service/health'))return json(res,503,{error:'新版本正在核对启动，请等待重连',notApplied:true});
    if(req.headers['x-panel-token']===token)res.diagnosticContext={method:req.method,route:url.pathname};
    // Native calls keep the ordinary Host/token gates and are never accepted
    // from a web origin. The capability is held by the local stdio adapter.
    if(url.pathname==='/api/native/session'){
      if(req.method!=='POST'||req.headers.origin||req.headers['x-panel-token']!==token)return json(res,403,{error:'本机插件验证失败',notApplied:true});
      const input=await body(req);if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['mode','threadId','bootstrap'].includes(k))||Object.hasOwn(input,'bootstrap')&&typeof input.bootstrap!=='boolean')return json(res,400,{error:'不支持的插件上下文',notApplied:true});
      const session=nativePanels.open(input.mode,input.threadId);
      if(input.bootstrap===true){
        const checked=nativePanels.check(session.capability);nativePanels.request(checked,'GET','/api/view/status');
        return json(res,200,{...session,bootstrap:statusView(checked)});
      }
      return json(res,200,session);
    }
    let nativeSession;
    if(req.headers['x-leix-native-session']){
      if(req.headers.origin||req.headers['x-panel-token']!==token)return json(res,403,{error:'本机插件验证失败',notApplied:true});
      nativeSession=nativePanels.check(req.headers['x-leix-native-session']);
      if(nativeSession.mode==='thread')Object.assign(res.diagnosticContext,{projectId:nativeSession.projectId,threadId:nativeSession.threadId});
      if(req.method==='GET')nativePanels.request(nativeSession,req.method,url.pathname+url.search);
    }
    if(url.pathname.startsWith('/api/view/')&&req.method==='GET'){
      const kind=url.pathname.slice('/api/view/'.length),projectId=url.searchParams.get('projectId');
      if(res.diagnosticContext&&nativeSession?.mode!=='thread'&&projectId&&(catalog.projects.some(p=>p.projectId===projectId)||state.workspace.mappings[projectId]))res.diagnosticContext.projectId=projectId;
      if(kind!=='status'&&req.headers['x-panel-token']!==token)return json(res,403,{error:'请求验证失败，请刷新面板'});
      if(kind==='context')return json(res,200,nativeSession?nativePanels.context(nativeSession,url.searchParams.get('pageUrl')):await desktopContext.inspect(url.searchParams.get('pageUrl'),{documentId:url.searchParams.get('documentId')}));
      if(kind==='desktop-check'){
        let pageUrl;
        try{pageUrl=contextPage(url.searchParams.get('pageUrl'),origin);}catch{return json(res,400,{error:'请在 Codex 的项目白板中运行自检'});}
        const boardProject=new URL(pageUrl).searchParams.get('projectId');
        if(!catalog.projects.some(p=>p.projectId===boardProject&&p.hostId==='local'))return json(res,404,{error:'当前本机项目尚未读取'});
        if(closing||restarting||maintenanceWaiting(state)||composer.active)return json(res,409,{error:'面板正在更新或提交，请稍后检查'});
        if(desktopCheckFlight&&desktopCheckFlight.pageUrl!==pageUrl)return json(res,409,{error:'另一个白板正在自检，请稍后重试'});
        if(!desktopCheckFlight){
          const operation=checkDesktop({pageUrl,inspect:url=>desktopContext.inspect(url,{force:true}),
            findProject:id=>catalog.projects.find(p=>p.projectId===id&&p.hostId==='local'),
            findThread:id=>presentationCatalog().threads.find(t=>t.id===id),bridge,sessionReader,probe:options.probeDesktopComposer
          }).then(report=>{
            for(const row of report.rows??[])if(row.status==='fail')diagnostics.record({phase:'desktop-check-'+row.id,code:row.id==='follow'?'CONTEXT_UNVERIFIED':'DESKTOP_CHECK_FAILED',level:'warn',projectId:boardProject,hostVersion:report.hostVersion});
            return report;
          }).finally(()=>{desktopCheckFlight=undefined;});
          desktopCheckFlight={pageUrl,operation:track(operation)};
        }
        const report=await desktopCheckFlight.operation;
        return report.changed?json(res,409,{error:'检查期间切换了聊天，请在当前项目重试'}):json(res,200,report);
      }
      if(kind!=='context'&&kind!=='status')desktopContext.noteRead();
      if(projectId&&!catalog.projects.some(p=>p.projectId===projectId)&&!state.workspace.mappings[projectId])return json(res,404,{error:'项目不存在或尚未读取成功'});
      if(kind==='execution'){
        const id=url.searchParams.get('id'),snapshot=repository.getTask(id);
        if(!projectId||!snapshot||snapshot.value.projectId!==projectId)return json(res,404,{error:'任务不存在或不属于当前项目'});
        const key=projectId+'\0'+id;
        if(!executionInspections.has(key)){
          if(executionInspections.size>=16)return json(res,429,{error:'正在检查其他任务，请稍后重新检查'});
          const operation=(async()=>{
            const value=structuredClone(state),current=value.tasks.find(t=>t.id===id),job=current?.currentJobId?repository.getJob(current.currentJobId):null;
            const result=await inspectExecution({state:value,catalog:{projects:catalog.projects,threads:catalog.threads},taskId:id,projectId,root,queue:queueView(value),gate:allocationGate(),storageFault:repository.inspect().fault,connected:!connectionError&&catalogHealth.snapshot().transport==='connected',readTarget:id=>executionRead('thread:'+id,()=>readForRecovery(id)),readRemote:value.sync.config?()=>executionRead('remote:'+value.sync.config.repo+':'+value.sync.config.branch,()=>makeStore(value.sync.config).read()):null,modelReason:threadId=>{try{const model=currentModel();return !threadId||executor.compatible(threadId,model)?'':'目标对话的实际模型尚未确认或与当前默认系列不符；请核对执行目标或模型设置。';}catch(error){return error.message;}}});
            if(repository.getTask(id)?.revision!==snapshot.revision||(job&&repository.getJob(job.value.id)?.revision!==job.revision))throw Error('检查期间任务或原执行已变化，请重新检查');
            return {...result,instanceId};
          })().finally(()=>executionInspections.delete(key));executionInspections.set(key,track(operation));
        }
        return json(res,200,await executionInspections.get(key));
      }
      if(kind==='diagnostics'){
        if(!projectId)return json(res,400,{error:'请指定诊断所属项目'});
        const control=url.searchParams.get('scope')==='control';
        if(control&&(projectId!==state.workspace.controllerProjectId||nativeSession?.mode==='thread'))return json(res,403,{error:'请从全局总控查看全部诊断'});
        const scope=control?undefined:projectId;
        const blockers=diagnosticBlockers(state,directSync.jobs(),scope),gate=allocationGate();
        if(gate)blockers.unshift({kind:'gate',status:'waiting',code:gate,message:gate==='STORAGE_FAULT'?'存储或同步回执异常，执行分配已停止。':gate==='SYNC_WAIT'?'同步正在提交，执行分配暂时等待。':gate==='MAINTENANCE_WAIT'?'服务维护门禁尚未解除。':'正在提交其他执行，分配暂时等待。'});
        return json(res,200,diagnostics.view(scope,{blockers}));
      }
      try{
        if(kind==='status')return conditionalJSON(req,res,statusView(nativeSession));
        if(kind==='references')return conditionalJSON(req,res,listProjectReferences(state,projectId,catalog.projects));
        if(kind==='project'){
          if(!projectId)return json(res,400,{error:'请指定项目'});
          const automation=automationSnapshot(state,projectId),capture=captureSnapshot(state),own=row=>row.projectId===projectId;
          const control=url.searchParams.get('scope')==='control'&&projectId===state.workspace.controllerProjectId,logicalId=state.workspace.mappings[projectId]?.logicalId;
          const conflicts=control?state.sync.conflicts:state.sync.conflicts.filter(c=>logicalId&&[c.local?.logicalId,c.remote?.logicalId,c.base?.logicalId].includes(logicalId));
          const propertyUsage=Object.fromEntries(propertyGroups(state,projectId).map(g=>[g.id,state.tasks.filter(t=>own(t)&&attributesOf(t).some(a=>a.groupId===g.id)).length]));
          queries.update(state,catalog.projects);return conditionalJSON(req,res,{...queries.query('plan-context',url.searchParams),propertyUsage,taskSections:state.taskSections.filter(own),taskGroups:projectTaskGroups(state,projectId),...(control?{projectBoard:projectBoardView(state,catalog.projects)}:{}),planIntakes:planIntakeView(state).filter(own),versionIntakes:versionIntakeView(state).filter(own),automation:{plans:automation.plans.filter(own),routes:automation.routes.filter(own)},capture:{events:capture.events.filter(own)},sync:{conflicts,...boardSyncView(projectId)}});
        }
        queries.update(state,catalog.projects);return conditionalJSON(req,res,queries.query(kind,url.searchParams));
      }catch(error){return json(res,error.status??400,{error:error.message});}
    }
    if(url.pathname==='/api/service/health'&&req.method==='GET')return json(res,200,{instanceId,productVersion:releaseConfig?.version??null,...(launchId?{launchId}:{})});
    if(url.pathname==='/api/state'&&req.method==='GET')return json(res,200,{...publicCatalog(),bindings:state.bindings,jobs:state.jobs,tasks:state.tasks.map(presentTask),taskSections:state.taskSections,taskGroups:Object.values(state.workspace.taskGroups??{}).flat(),planIntakes:planIntakeView(state),versionRecords:state.versionRecords.filter(v=>!v.deletedAt),versionIntakes:versionIntakeView(state),propertyGroups:state.propertyGroups??{},capture:captureSnapshot(state),automation:automationSnapshot(state),legacyJobs:state.jobs.filter(j=>!j.taskId),boards:sidecars.snapshot(),workspace:workspaceView(state,catalog.projects),projectTransfers:projectTransferView(),sync:{config:state.sync.config,conflicts:state.sync.conflicts,lastSync:state.sync.lastSync,error:state.sync.error,running:syncRunning,automatic:autoSync.snapshot(),inbox:state.sync.base.filter(r=>!r.deleted&&!Object.values(state.workspace.mappings).some(m=>m.logicalId===r.logicalId))},workflowChecks:state.workflowChecks??{},caller:state.caller,token,connectionError,lastSync,service:{instanceId,startedAt,restarting,backupConfigSupported:true,...productCapabilities(),nativeMcpSupported:true,nativeBootstrapSupported:true,executionRecoverySupported:true,automaticRecoverySupported:true,scopedActivityRecoverySupported:true,automaticUncertainReleaseSupported:true,safeReadRecoverySupported:true,versionDeleteSupported:true,manualTaskAcceptanceSupported:true,manualPausedExecutionSupported:true,boundedThreadReadSupported:true,diagnosticsSupported:true,desktopCheckSupported:true,desktopContextSupported:true,desktopContextFastCheckSupported:true,desktopContextThreadLookupSupported:true,desktopContextDiagnostics:desktopContext.diagnostics(),connectionDiagnostics:bridge.diagnostics?.()??null,catalogHealthSupported:true,catalogRecoverySupported:true,backgroundChecksSupported:true,catalogHealth:catalogHealth.snapshot(),storage:repository.inspect(),restartSupported:typeof options.requestRestart==='function',maintenanceSupported:true,executionScopesSupported:true,intelligentDispatchSupported:true,asyncStorageSupported:true,projectSyncSupported:true,directProjectSyncSupported:true,nativeProjectSyncSupported:true,projectTransferSupported:true,workflowTasksSupported:true,taskHandoffSupported:true,projectSyncSending:directSync.snapshot(),modelRoutingSupported:true,modelSeriesRoutingSupported:true,cleanDispatchSupported:true,taskContentSupported:true,composerSupported:true,currentThreadSendSupported:true,directThreadMessageSupported:true,nativeComposerSendSupported:true,composerReceiptLookupSupported:true,projectReferencesSupported:true,projectReferenceTagManagementSupported:true,projectReferenceGroupsSupported:true,projectBoardSyncSupported:true,taskGroupsSupported:true,projectBoardSupported:true,currentThreadModesSupported:true,taskRoundsSupported:true,reviewRecoverySupported:true,taskAcceptanceSupported:true,sourceBindingSupported:true,maintenance:maintenanceView(),impact:maintenanceImpact(state,catalog.projects),activeRequests}});
    if(url.pathname.startsWith('/api/')){
      if(req.method!=='POST'||req.headers['x-panel-token']!==token)return json(res,403,{error:'请求验证失败，请刷新面板'});
      if(restarting)return json(res,503,{error:'面板正在重启，请等待重连'});
      activeRequests++;let counted=true;const release=()=>{if(counted){activeRequests--;counted=false;}};res.once('finish',release);res.once('close',release);
      if(url.pathname==='/api/attachments/read'){
        const b=await body(req);if(nativeSession)nativePanels.request(nativeSession,req.method,url.pathname,b);const file=state.attachments[b.id];if(!file||file.projectId!==b.projectId)throw Error('附件不存在或不属于本项目');
        const bytes=readAttachment(root,file);res.writeHead(200,{'Content-Type':file.type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(file.name)});return res.end(bytes);
      }
      const b=await body(req,url.pathname==='/api/attachments/upload'?15*1024*1024:1024*1024);
      if(url.pathname==='/api/projects/sync-composer'){
        res.syncTiming=beginSyncTiming(root,b,{receivedAt:req.receivedAt});
        res.syncTiming?.mark('context.begin');res.once('finish',()=>res.syncTiming?.finish(res.statusCode));
      }
      if(res.diagnosticContext){
        const task=state.tasks.find(t=>t.id===b?.id),job=state.jobs.find(j=>j.id===b?.jobId||j.id===b?.id),plan=state.automation.plans.find(p=>p.id===b?.id);
        let pageProject;try{const page=new URL(req.headers['x-panel-page']);if(page.origin===origin)pageProject=page.searchParams.get('projectId');}catch{}
        const projectId=nativeSession?.mode==='thread'?nativeSession.projectId:pageProject??b?.projectId??task?.projectId??job?.projectId??plan?.projectId;
        if(catalog.projects.some(p=>p.projectId===projectId)||state.workspace.mappings[projectId])Object.assign(res.diagnosticContext,{projectId,taskId:task?.projectId===projectId?task.id:job?.projectId===projectId?job.taskId:undefined,jobId:job?.projectId===projectId&&(!task||job.taskId===task.id)?job.id:undefined,planId:plan?.projectId===projectId?plan.id:undefined,threadId:nativeSession?.mode==='thread'?nativeSession.threadId:catalog.threads.some(t=>t.id===b?.threadId&&normalize(t.cwd)===normalize(catalog.projects.find(p=>p.projectId===projectId)?.path))?b.threadId:undefined});
      }
      if(nativeSession)nativePanels.request(nativeSession,req.method,url.pathname,b);
      if(['tasks/approve','tasks/return-to-todo','tasks/retry-review','tasks/resolve-uncertain','tasks/update','tasks/priority','tasks/archive','tasks/execute','tasks/send-current','tasks/handoff'].some(route=>url.pathname==='/api/'+route)&&state.tasks.some(task=>task.id===(b.id??b.taskId)&&task.boardSyncReplica))throw Error('该卡片来自其他电脑，请在原执行电脑审阅或修改');
      let composerSelection;
      if(['/api/projects/sync-current','/api/projects/sync-composer','/api/tasks/send-current','/api/composer/send','/api/composer/submit'].includes(url.pathname)&&!nativeSession&&!req.headers['x-panel-page'])return json(res,409,{error:'请在当前项目的对话侧栏中操作',notApplied:true});
      if(url.pathname==='/api/tasks/execute'&&b.accept===true){
        const task=state.tasks.find(t=>t.id===b.id);if(!task||b.projectId!==task.projectId)throw Error('接收项目与任务不匹配');
        if(req.headers['x-panel-page']){let page;try{page=new URL(req.headers['x-panel-page']);}catch{}if(page?.origin!==origin||page.searchParams.get('projectId')!==task.projectId)throw Error('接收页面与任务项目不匹配');}
      }
      if(!nativeSession&&req.headers['x-panel-page']&&url.pathname!=='/api/refresh'&&!(url.pathname==='/api/tasks/execute'&&b.accept===true)){
        const pageUrl=req.headers['x-panel-page'];let context;
        try{context=await desktopContext.inspectForWrite(pageUrl);}catch(error){if(url.pathname==='/api/tasks/send-current')return json(res,409,{error:error.message,notApplied:true,notSent:true});throw error;}
        const task=state.tasks.find(t=>t.id===b.id),plan=state.automation.plans.find(p=>p.id===b.id);
        if(!contextWriteAllowed(context,pageUrl,{required:['/api/projects/sync-current','/api/projects/sync-composer','/api/tasks/send-current','/api/composer/send','/api/composer/submit','/api/composer/fill'].includes(url.pathname)||req.headers['x-panel-context-required']==='true',projectId:b.projectId??task?.projectId??plan?.projectId,...(['/api/composer/fill','/api/projects/sync-current','/api/projects/sync-composer','/api/tasks/send-current','/api/composer/send','/api/composer/submit'].includes(url.pathname)?{threadId:b.threadId}:{})}))return json(res,409,{error:'当前 Codex 项目或对话已变化，操作未执行；请等待面板匹配。',notApplied:true});
        composerSelection=context.selection;
      }
      if(url.pathname==='/api/service/check-update'){
        if(!b||Array.isArray(b)||Object.keys(b).length)throw Error('更新检查不接受额外参数');
        return json(res,200,{ok:true,...await checkProductRelease(true)});
      }
      if(url.pathname==='/api/service/backup-config'){
        if(!b||Array.isArray(b)||Object.keys(b).some(key=>key!=='backupRoot'))throw Error('备份配置参数无效');
        if(!Object.hasOwn(b,'backupRoot'))return json(res,200,{ok:true,backupRoot:configuredBackupRoot(root)});
        if(options.installRoot)installedBackupRoot(options.installRoot,root,b.backupRoot);
        return json(res,200,{ok:true,...configureBackupRoot(root,b.backupRoot,{backup:(source,target)=>backupRestartState(source,target,'修改备份配置')})});
      }
      if(url.pathname==='/api/service/data-location'){
        if(typeof options.requestRelocation!=='function')throw Error('此启动入口不能修改数据位置');
        if(!b||Array.isArray(b)||Object.keys(b).some(key=>!['dataRoot','instanceId'].includes(key)))throw Error('数据位置参数无效');
        if(!Object.hasOwn(b,'dataRoot'))return json(res,200,{ok:true,dataRoot:root});
        if(b.instanceId!==instanceId)throw Error('服务实例已变化，请刷新后重试');
        const destination=installedDataRoot(options.installRoot,b.dataRoot,{missing:true});
        if(!path.relative(root,destination))return json(res,200,{ok:true,changed:false});
        const parent=safeLocalPath(path.dirname(destination),{directory:true});
        if(fs.existsSync(path.join(parent,path.basename(destination))))throw Error('请选择一个尚不存在的新数据目录');
        installedBackupRoot(options.installRoot,destination,configuredBackupRoot(root));
        if(productUpdateBlocked(state)||maintenanceWaiting(state)||restartBusy(1))throw Error('请等当前任务和同步结束，并暂停自动同步后再搬迁数据');
        restarting=true;
        res.once('finish',()=>{void options.requestRelocation(destination).catch(error=>{restarting=false;console.error(error.message);});});
        return json(res,200,{ok:true,changed:true});
      }
      if(url.pathname==='/api/service/stage-update'){
        if(!b||Array.isArray(b)||Object.keys(b).length)throw Error('更新下载不接受额外参数');
        return json(res,200,{ok:true,...await stageProductRelease()});
      }
      if(url.pathname==='/api/service/apply-update'){
        if(!b||Array.isArray(b)||Object.keys(b).length)throw Error('升级请求不接受额外参数');
        if(!releaseScheduler||typeof options.requestUpdate!=='function'||!releaseStage)throw Error('当前启动方式不支持升级，请先检查并下载更新');
        if(maintenanceWaiting(state))throw Error('已有维护操作在等待，请先取消或完成');
        const stage=releaseStage,proof=releaseStageProof;await verifyStagedRelease({...releaseConfig,root,stageId:stage.stageId});
        const saved=await releaseCheckStore(root).read();
        if(!saved?.envelope||!proof||createHash('sha256').update(JSON.stringify(saved.envelope)).digest('hex')!==proof||releaseStage!==stage)throw Error('可用更新已变化，请重新检查和下载');
        await mutate(draft=>{if(maintenanceWaiting(draft))throw Error('已有维护操作在等待');draft.maintenance={status:'waiting',kind:'product-update',requestId:randomUUID(),stageId:stage.stageId,stageProof:proof,requestedAt:new Date().toISOString()};});
        void maintenanceTick();return json(res,200,{ok:true,status:'waiting',message:'等待任务和未决操作安全结束；可取消等待。'});
      }
      if(url.pathname==='/api/service/cancel-update'){
        if(!b||Array.isArray(b)||Object.keys(b).sort().join(',')!=='instanceId'||b.instanceId!==instanceId)throw Error('服务实例已变化，请刷新后重试');
        await mutate(draft=>{if(draft.maintenance?.status!=='waiting'||draft.maintenance.kind!=='product-update')throw Error('没有可取消的产品升级');draft.maintenance=null;});
        return json(res,200,{ok:true,message:'已取消升级等待，原任务和数据保留。'});
      }
      if(url.pathname==='/api/composer/submit'){
        try{
          if(Object.hasOwn(b,'receiptOnly')){
            if(b.receiptOnly!==true)throw Error('回执查询参数无效');
            const input={...composerInput({...b,requestId:b.receiptRequestId},state,presentationCatalog(),root,origin,{verifyFiles:false}),submit:true};
            const status=composer.notSubmitted(b.receiptRequestId,input)?'not-submitted':'uncertain';
            return json(res,200,{ok:true,status});
          }
          const input=nativeComposerInput(b);
          const submission={...input,submit:true,...(composerSelection?{selection:composerSelection}:{})};
          const result=await composer.fill(b.requestId,submission);
          if(result.status==='failed'&&result.retrySafe===true)return json(res,400,{error:result.message||'当前聊天尚未发送，草稿已保留',notApplied:true});
          const status=result.status==='invoked'?'invoked':composer.notSubmitted(b.requestId,submission)?'not-submitted':'uncertain';
          return json(res,200,{ok:true,...result,status});
        }catch(error){return json(res,400,{error:error.message,notApplied:error.notApplied===true});}
      }
      if(url.pathname==='/api/composer/send'){
        try{
          if(closing||restarting||maintenanceWaiting(state))throw Object.assign(Error('面板正在更新，本次未发送'),{notApplied:true});
          const input=composerInput(b,state,presentationCatalog(),root,origin);
          const project=catalog.projects.find(p=>p.projectId===input.projectId),reason=workspaceReason(state,project);
          if(reason)throw Object.assign(Error(reason),{notApplied:true});
          const files=attachmentFields(state,input.projectId,b.attachmentIds);
          const prompt=input.description+attachmentPrompt(root,files);
          return json(res,200,{ok:true,...await directMessages.submit(b.requestId,{projectId:input.projectId,threadId:input.threadId,prompt})});
        }catch(error){return json(res,400,{error:error.message,notApplied:true,notSent:true});}
      }
      if(url.pathname==='/api/composer/fill'){
        try{
          if(maintenanceWaiting(state))throw Object.assign(Error('面板等待更新，请稍后填入窗口'),{notApplied:true});
          const input=composerInput(b,state,req.headers['x-panel-page']||nativeSession?presentationCatalog():catalog,root,origin);
          return json(res,200,{ok:true,...await composer.fill(b.requestId,{...input,...(composerSelection?{selection:composerSelection}:{})})});
        }catch(error){return json(res,400,{error:error.message,notApplied:error.notApplied===true});}
      }
      if(url.pathname==='/api/plans/command'||url.pathname==='/api/plans/begin')return json(res,200,{ok:true,...await mutate(draft=>planCommand(draft,versionProject(catalog.projects,b.projectId),root,url.pathname.endsWith('/begin'),b.id))});
      if(url.pathname==='/api/plans/cancel'){await mutate(draft=>cancelPlan(draft,b.id,versionProject(catalog.projects,b.projectId)));return json(res,200,{ok:true});}
      if(url.pathname==='/api/plans/collect')return json(res,200,{ok:true,...await collectPlan(b.id,versionProject(catalog.projects,b.projectId))});
      if(url.pathname==='/api/versions/command')return json(res,200,{ok:true,...await mutate(draft=>versionCommand(draft,versionProject(catalog.projects,b.projectId),root,b.id))});
      if(url.pathname==='/api/versions/begin')return json(res,200,{ok:true,...await mutate(draft=>beginVersionIntake(draft,versionProject(catalog.projects,b.projectId),root))});
      if(url.pathname==='/api/versions/command/cancel'){await mutate(draft=>cancelVersionIntake(draft,b.id,versionProject(catalog.projects,b.projectId)));return json(res,200,{ok:true});}
      if(url.pathname==='/api/versions/collect'){
        const project=versionProject(catalog.projects,b.projectId);let result=await collectVersionIntake(state,b.id,project,root);
        const current=versionProject(catalog.projects,b.projectId);if(normalize(current.path)!==normalize(project.path))throw Error('项目目录已变化，请重新生成版本指令');
        if(result.status==='ready')result=await mutate(draft=>acceptVersionIntake(draft,b.id,current,result));
        return json(res,200,{ok:true,...result});
      }
      if(url.pathname==='/api/versions/inspect')return json(res,200,{ok:true,...await inspectVersionGit(versionProject(catalog.projects,b.projectId),b.ref||'HEAD')});
      if(url.pathname==='/api/versions/save'){
        const project=versionProject(catalog.projects,b.projectId);
        const snapshot=!b.id&&b.ref?.trim()?await inspectVersionGit(project,b.ref.trim()):null;
        const current=versionProject(catalog.projects,b.projectId);if(normalize(current.path)!==normalize(project.path))throw Error('项目目录已变化，请重新打开版本记录');
        return json(res,200,{ok:true,...await mutate(draft=>{const result=saveVersion(draft,b,current,snapshot);if(b.intakeId){if(b.id)throw Error('请将Codex结果保存为新版本');linkVersionIntake(draft,b.intakeId,current,result.record);}return result;})});
      }
      if(url.pathname==='/api/versions/delete')return json(res,200,{ok:true,...await mutate(draft=>deleteVersion(draft,b,versionProject(catalog.projects,b.projectId)))});
      if(url.pathname==='/api/versions/prepare'){
        const project=versionProject(catalog.projects,b.projectId),expectedPath=project.path,record=repository.getEntity('versionRecords',b.id,b.projectId)?.value;
        if(!record)throw Error('版本记录不存在');
        const prepared=await prepareVersionRollback(project,record),latest=repository.getEntity('versionRecords',b.id,b.projectId)?.value;
        if(normalize(versionProject(catalog.projects,b.projectId).path)!==normalize(expectedPath)||!latest||latest.deletedAt||latest.revision!==record.revision)throw Error('版本记录或项目目录已变化，请刷新后再准备回滚');
        return json(res,200,{ok:true,...prepared});
      }
      if(url.pathname==='/api/service/restart'){
        if(typeof options.requestRestart!=='function')throw Error('请使用 npm start 或启动面板.ps1 启动，才能从设置重启');
        if(b.instanceId!==instanceId)throw Error('服务实例已变化，请刷新后重试');
        if(b.whenIdle===true){
          if(b.confirmed!==true)throw Error('请先确认公共面板重启范围与队列恢复方式');
          if(!maintenanceWaiting(state))await mutate(draft=>{draft.maintenance={status:'waiting',requestId:randomUUID(),requestedAt:new Date().toISOString()};});
          return json(res,200,{ok:true,waiting:true,message:'等待当前任务结束；重启后继续原活动计划，手动暂停的保持暂停'});
        }
        if(maintenanceWaiting(state))throw Error('已安排安全重启，请等待或取消');
        if(state.jobs.some(j=>['queued','sending','submitted','running','uncertain'].includes(j.status)))throw Error('还有在途或未决任务，未重启；请先处理这些任务');
        if(releaseStaging||releaseScheduler?.pending||reconcilingExecutions||automaticSourceBinding.pending||composer.active||repository.inspect().queued>0||activeRequests>1||syncRunning||dispatching||ticking||refreshing||sidecars.running||Object.values(state.threadRequests??{}).some(r=>r.status==='creating'))throw Error('面板正在读取或保存数据，请稍后再重启');
        let backupPath;restarting=true;
        try{await (options.checkRestart??(()=>checkRestartCode(programRoot,{installed:separateData})))();backupPath=await repository.backup(restartBackup);}catch(error){restarting=false;throw error;}
        res.once('finish',requestServiceRestart);
        return json(res,200,{ok:true,instanceId,backupPath,message:'已备份，正在重启'});
      }
      if(url.pathname==='/api/service/restart/cancel'){
        if(b.instanceId!==instanceId)throw Error('服务实例已变化，请刷新后重试');
        if(maintenanceWaiting(state))await mutate(draft=>{draft.maintenance=null;});
        return json(res,200,{ok:true});
      }
      if(maintenanceWaiting(state)&&!(url.pathname==='/api/tasks/execute'&&b.accept===true)&&(['tasks/execute','tasks/send-current','composer/send','composer/submit','tasks/handoff','tasks/retry-review','automation/start','workflow/initialize','threads/create','jobs'].some(route=>url.pathname==='/api/'+route)||(url.pathname==='/api/automation/control'&&b.action==='resume')))throw Error('公共面板等待重启，暂不接收新执行；可取消等待后继续');
      if(url.pathname==='/api/attachments/upload'){
        const file=saveAttachment(root,b,catalog.projects);await mutate(draft=>{draft.attachments[file.id]=file;});return json(res,200,{ok:true,file});
      }
      if(url.pathname==='/api/automation/start'){
        if(syncRunning)throw Error('待办同步中，请稍后启动自动执行');
        const reason=workspaceReason(state,catalog.projects.find(p=>p.projectId===b.projectId));if(reason)throw Error(reason);
        const result=await command({operation:'startPlan',payload:{input:{...b,manualAcceptance:false}}});void tick();return json(res,200,{ok:true,...result});
      }
      if(url.pathname==='/api/automation/control'){if(b.action==='confirm-initial'){if(b.confirmed!==true)throw Error('请明确选择已创建的原对话');const route=Object.values(state.automation.routes).find(r=>r.initialDispatch?.planId===b.id&&r.initialDispatch.taskId===b.taskId);if(!route)throw Error('没有对应的待核对提交');await initialDispatcher.confirm(route.key,b.threadId);return json(res,200,{ok:true});}const result=await command({operation:'controlPlan',payload:{input:b}});if(b.action==='resume')void tick();return json(res,200,{ok:true,...result});}
      if(url.pathname==='/api/sections/route')return json(res,200,{ok:true,route:await executor.bindSection(b)});
      if(url.pathname==='/api/capture/configure')return json(res,200,{ok:true,...capture.configure(b)});
      if(url.pathname==='/api/capture/scan')return json(res,200,{ok:true,automatic:false});
      if(url.pathname==='/api/capture/clear-pending'){
        if(b.confirmed!==true)throw Error('请确认清空当前项目的待整理记录');
        const project=capture.project(b.projectId);
        if(project.hostId!=='local')throw Error('只能清理本机项目的待整理记录');
        const candidates=value=>Object.keys(value.capture.events).filter(id=>{const event=value.capture.events[id];return event.projectId===b.projectId&&event.status==='candidate';});
        const ids=candidates(state);
        if(!ids.length)return json(res,200,{ok:true,deleted:0});
        const backupPath=await repository.backup(restartBackup);
        await mutate(draft=>{
          if(JSON.stringify(candidates(draft))!==JSON.stringify(ids))throw Error('待整理记录已变化，请刷新后重试');
          for(const id of ids)delete draft.capture.events[id];
        });
        return json(res,200,{ok:true,deleted:ids.length,backupPath});
      }
      if(url.pathname==='/api/capture/history')return json(res,200,{ok:true,...await capture.history(b.projectId,b.threadId,b.cursor)});
      if(url.pathname==='/api/capture/import')return json(res,200,{ok:true,...await capture.import(b)});
      if(url.pathname==='/api/capture/archive-preview')return json(res,200,{ok:true,...await capture.archivePreview(b)});
      if(url.pathname==='/api/capture/archive')return json(res,200,{ok:true,...await capture.archive(b)});
      if(url.pathname==='/api/capture/correct')return json(res,200,{ok:true,...await mutate(draft=>correctRecognition(draft,b,catalog.projects))});
      if(url.pathname==='/api/capture/task')return json(res,200,{ok:true,...await mutate(draft=>changeTaskChain(draft,b,catalog.projects))});
      if(url.pathname==='/api/references/change'){
        if(['group-create','group-update','group-remove','group-move'].includes(b.action))return json(res,200,{ok:true,...await mutate(draft=>changeProjectReferenceGroup(draft,b,catalog.projects))});
        if(['tag-add','tag-rename','tag-delete'].includes(b.action))return json(res,200,{ok:true,...await mutate(draft=>changeProjectReferenceTag(draft,b,catalog.projects))});
        const result=await mutate(draft=>{
          const reference=changeProjectReference(draft,b,catalog.projects);
          const {tags,tagRevision}=listProjectReferences(draft,b.projectId,catalog.projects);
          return {reference,tags,tagRevision};
        });
        return json(res,200,{ok:true,...result});
      }
      if(url.pathname==='/api/capture/sources'){
        const task=repository.getTask(b.id,b.projectId)?.value;if(!task)throw Error('任务不存在');
        return json(res,200,{events:(task.sourceIds??[]).map(id=>state.capture.events[id]).filter(Boolean).map(presentSource)});
      }
      if(url.pathname==='/api/capture/image'){
        const event=state.capture.events[b.id];if(!event||event.projectId!==b.projectId)throw Error('来源不存在或不属于本项目');
        const {bytes,type}=readSourceImage(event.source,b.index);res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});return res.end(bytes);
      }
      if(url.pathname==='/api/capture/event'){
        const event=state.capture.events[b.id];if(!event||event.projectId!==b.projectId)throw Error('来源不存在');return json(res,200,{event:presentSource(event)});
      }
      if(url.pathname==='/api/capture/pending')return json(res,200,{events:Object.values(state.capture.events).filter(e=>e.projectId===b.projectId&&e.status==='candidate').slice(Math.max(0,Number(b.offset)||0),Math.max(0,Number(b.offset)||0)+50).map(presentSource)});
      if(url.pathname==='/api/capture/open'){
        const event=state.capture.events[b.id],project=catalog.projects.find(p=>p.projectId===event?.projectId);if(!event||!project||b.projectId!==project.projectId)throw Error('来源不存在');
        const response=await read(event.source.threadId);capture.validate(response,{id:event.source.threadId},project);await bridge.call('navigate_to_codex_page',{threadId:event.source.threadId});return json(res,200,{ok:true});
      }
      if(url.pathname==='/api/workspace/setup'){await mutate(draft=>configureWorkspace(draft,b,catalog.projects));return json(res,200,{ok:true});}
      if(url.pathname==='/api/workspace/source/preview'||url.pathname==='/api/workspace/source'){
        const proof=await previewSourceBinding(state,b,catalog.projects,{inspect:options.inspectSourceRepository});
        if(url.pathname.endsWith('/preview'))return json(res,200,{ok:true,...proof});
        if(sourceBindingBusy(b.projectId,proof))throw Error('当前项目或共用源码仍有执行、同步或接续安排，请结束后再关联源码');
        const result=await mutate(draft=>{if(sourceBindingBusy(b.projectId,proof))throw Error('项目状态已变化，未修改源码关联');return saveSourceBinding(draft,b,proof,catalog.projects);});
        await refreshMetadata();catalog.projects=await identifyProjects(catalog.projects,options.inspectRepository,state.workspace.mappings);return json(res,200,{ok:true,...result});
      }
      if(url.pathname==='/api/workspace/map'){await mutate(draft=>mapProject(draft,b,catalog.projects));return json(res,200,{ok:true});}
      if(url.pathname==='/api/workflow/check'){
        const project=workflowProject(catalog.projects.find(p=>p.projectId===b.projectId));
        return json(res,200,await inspectProjectWorkflow(project));
      }
      if(url.pathname==='/api/workflow/acknowledge'){
        const project=workflowProject(catalog.projects.find(p=>p.projectId===b.projectId));
        if(b.confirmed!==true||normalize(b.path??'')!==normalize(project.path))throw Error('请核对当前项目目录后继续');
        await mutate(draft=>{draft.workflowChecks??={};draft.workflowChecks[project.projectId]={path:project.path,acknowledgedAt:new Date().toISOString()};});
        return json(res,200,{ok:true});
      }
      if(url.pathname==='/api/workflow/preview'){
        const project=workflowProject(catalog.projects.find(p=>p.projectId===b.projectId));
        if(b.mode==='github-upgrade'){
          if(project.sourcePath)throw Error('此会话已关联已有源码，请使用同步项目，无需重新上传');
          const upgrade=await (options.inspectUpgrade??inspectUpgrade)(project);upgrade.repository=upgradeRepository(b.repository||upgrade.suggestedRepository,upgrade.account);
          return json(res,200,{projectId:project.projectId,path:project.path,prompt:githubUpgradePrompt(project,upgrade),upgrade});
        }
        const check=await inspectProjectWorkflow(project);
        return json(res,200,{projectId:project.projectId,path:project.path,prompt:workflowReviewPrompt({...project,path:check.inspectedPath}),check,report:(()=>{const t=state.tasks.filter(t=>t.projectId===project.projectId&&t.createRequestId?.startsWith('workflow-prepare-')).at(-1),j=state.jobs.find(j=>j.id===t?.currentJobId);return j?{taskId:t.id,status:j.status,text:j.finalResult??j.result??''}:null;})()});
      }
      if(url.pathname==='/api/workflow/initialize'){
        await requireActivities({requestId:b.requestId});
        let upgrade;
        if(b.mode==='github-upgrade'&&catalog.projects.find(p=>p.projectId===b.projectId)?.sourcePath)throw Error('此会话已关联已有源码，请使用同步项目');
        if(b.mode==='github-upgrade'&&!state.jobs.some(j=>j.workflowRequestId===b.requestId)){
          const project=workflowProject(catalog.projects.find(p=>p.projectId===b.projectId));upgrade=await (options.inspectUpgrade??inspectUpgrade)(project);upgrade.repository=upgradeRepository(b.repository,upgrade.account);
          if(b.confirmed!==true||b.snapshot!==upgrade.snapshot)throw Error('上传范围已变化或未确认，请刷新范围后重新核对');
        }
        const result=await mutate(draft=>{if(maintenanceWaiting(draft))throw Error('面板等待更新，暂不接收新执行');return queueInitialization(draft,{...b,upgrade},catalog);});
        return json(res,200,{ok:true,...result});
      }
      if(url.pathname==='/api/sync/setup'){
        assertWritable();if(syncRunning||dispatching||b.confirmed!==true)throw new Error('请确认同步范围和私有仓库，等待当前提交完成');
        syncRunning=true;
        try{
          const config={repo:b.repo,branch:b.branch,...(b.includeRichFields===true?{schemaVersion:2}:{})};await makeStore(config).verify();
          await mutate(draft=>{
            if(draft.sync.config&&draft.sync.base.length&&(config.repo!==draft.sync.config.repo||config.branch!==draft.sync.config.branch))throw new Error('已有同步历史，不能直接切换同步库');
            if(draft.sync.config?.schemaVersion>=3&&config.schemaVersion===2)config.schemaVersion=draft.sync.config.schemaVersion;
            if(draft.sync.config?.schemaVersion>=2&&(config.schemaVersion??1)<2)throw Error('完整卡片同步不能降级，以免丢失附件与属性');
            if(draft.sync.conflicts.length)throw Error('请先解决同步冲突再变更范围');
            draft.sync.config=config;if(config.schemaVersion>=2)draft.sync.base=draft.sync.base.map(richRecord);if(typeof b.autoEnabled==='boolean')draft.sync.autoEnabled=b.autoEnabled;
          });return json(res,200,{ok:true});
        }finally{syncRunning=false;}
      }
      if(url.pathname==='/api/sync/auto'){if(typeof b.enabled!=='boolean'||(b.enabled&&!state.sync.config))throw Error('请先配置同步位置');await mutate(draft=>{draft.sync.autoEnabled=b.enabled;});return json(res,200,{ok:true});}
      if(url.pathname==='/api/sync/run'){
        if(b.projectId!==undefined)boardSyncTarget(b.projectId);
        const todos=await synchronizeTasks();
        const board=b.projectId===undefined?undefined:await synchronizeBoard(b.projectId);
        return json(res,200,{ok:true,...todos,...(board?{board}:{})});
      }
      if(url.pathname==='/api/sync/resolve'){
        if(b.boardConflictId){await resolveBoardConflict(b);return json(res,200,{ok:true});}
        if(syncRunning||!['local','remote'].includes(b.use))throw new Error('请在同步结束后选择冲突内容');
        await mutate(draft=>{const conflict=draft.sync.conflicts.find(c=>c.id===b.id);if(!conflict)throw new Error('冲突已变化，请刷新');draft.sync.overrides[b.id]={use:b.use,expectedRemote:conflict.remote,expectedLocal:conflict.local};});return json(res,200,{ok:true});
      }
      if(url.pathname==='/api/sync/release'){
        assertWritable();if(syncRunning||dispatching||b.confirmed!==true)throw new Error('请先核对领取结果和所有电脑执行情况');
        const task=state.tasks.find(t=>t.id===b.id),restore=!!task?.archivedAt&&!task?.syncReserved;
        if((!task?.syncReserved&&!restore)||task.status!=='todo'||state.jobs.some(j=>j.taskId===task.id&&(restore||['queued','sending','submitted','running','uncertain'].includes(j.status))))throw new Error('任务仍有执行，不能重新开放');
        const before=JSON.stringify(task);
        syncRunning=true;
        try{
          const remote=await makeStore(state.sync.config).read();
          const record=remote.records.find(r=>r.id===task.syncId),base=state.sync.base.find(r=>r.id===task.syncId);
          if(restore&&(!record||record.deleted||!base||JSON.stringify({...record,deleted:base.deleted})!==JSON.stringify(base)))throw Error('远端尚未重新开放或内容已变化，保留原任务，请先核对');
          if(restore&&repository.inspect().backend!=='json')throw Error('定向接续需要JSON备份能力');
          const backupPath=restore?await repository.backup(restartBackup):undefined;
          await mutate(draft=>{const t=draft.tasks.find(t=>t.id===b.id);if(JSON.stringify(t)!==before||t.status!=='todo'||draft.jobs.some(j=>j.taskId===t.id&&(restore||['queued','sending','submitted','running','uncertain'].includes(j.status))))throw new Error('任务状态已变化');delete t.syncReserved;delete t.syncReservationConfirmed;delete t.archivedAt;
            if(restore){draft.sync.base=draft.sync.base.map(r=>r.id===task.syncId?record:r);t.history??=[];t.history.push({id:randomUUID(),at:new Date().toISOString(),type:'sync-reopened',note:'用户已确认其他电脑未执行，核对远端重新开放后定向接续；未上传其他待办或发送任务。',remoteSha:remote.sha});}else draft.sync.base=remote.records;
          });
          return json(res,200,{ok:true,...(backupPath?{backupPath}:{}),message:restore?'已定向接续重新开放的待办，可继续原安排':'已解除本机领取标记；请同步后再执行'});
        }finally{syncRunning=false;}
      }
      if(url.pathname==='/api/projects/create'){
        if(b.confirmed!==true||!state.workspace.controllerProjectId)throw new Error('请先设置总控并确认创建项目');
        const parent=catalog.projects.find(p=>p.projectId===b.parentProjectId);if(!parent?.path)throw new Error('请选择父项目目录');
        const parentPath=fs.realpathSync(parent.path),newPath=validateProjectFolder(parentPath,b.name);
        if(fs.existsSync(newPath))throw new Error('目录已存在，请使用项目绑定；不会覆盖已有文件');
        if(b.empty!==undefined&&typeof b.empty!=='boolean')throw Error('空目录选项无效');
        fs.mkdirSync(newPath);if(b.empty!==true)fs.writeFileSync(path.join(newPath,'README.md'),'# '+b.name+'\n\n新建项目，技术栈、命令及具体任务待确定。\n',{flag:'wx'});
        const project={projectId:'panel-'+randomUUID(),label:b.name,path:newPath,hostId:'local',isGitRepository:false};
        await mutate(draft=>{draft.localProjects.push(project);});await refreshMetadata();
        return json(res,200,{ok:true,project,registrationRequired:true,message:'项目目录已创建。请在 Codex 添加此目录，再刷新并新建执行对话。'});
      }
      if(url.pathname==='/api/threads/create'){
        if(b.confirmed!==true||typeof b.requestId!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(b.requestId))throw new Error('请确认新建专用执行对话并保留请求标识');
        const existing=state.threadRequests?.[b.requestId];if(existing){if(existing.projectId!==b.projectId)throw new Error('创建请求已用于其他项目');return json(res,200,{ok:true,duplicate:true,receipt:existing.receipt,status:existing.status});}
        await requireActivities({requestId:b.requestId});
        const project=catalog.projects.find(p=>p.projectId===b.projectId);if(!project)throw new Error('项目不存在');
        if(project.projectId.startsWith('panel-')&&!project.desktopProjectId)throw new Error('请先将此目录添加到 Codex 项目，再刷新');
        if(state.threadRequests?.[b.requestId])return json(res,200,{ok:true,duplicate:true,status:state.threadRequests[b.requestId].status});
        const reservation=await mutate(draft=>{
          if(maintenanceWaiting(draft))throw Error('面板等待更新，暂不新建对话');
          catalogHealth.assertFresh();
          draft.threadRequests??={};const old=draft.threadRequests[b.requestId];if(old){if(old.projectId!==b.projectId)throw Error('创建请求已用于其他项目');return {duplicate:true,receipt:old.receipt,status:old.status};}
          draft.threadRequests[b.requestId]={projectId:b.projectId,status:'creating',createdAt:new Date().toISOString()};return {duplicate:false};
        });
        if(reservation.duplicate)return json(res,200,{ok:true,...reservation});
        try{
          catalogHealth.assertFresh();
          const receipt=await bridge.call('create_thread',{title:canonicalTitle({purpose:'面板执行',key:defaultModelKey,models:modelRegistry.models}),target:{type:'project',projectId:project.desktopProjectId??project.projectId,environment:{type:'local'}},prompt:'这是用户新建的项目专用执行对话。请只回复“执行对话已就绪”，不要调用工具、读取或修改文件，等待用户通过面板分配具体任务。'});
          await mutate(draft=>{draft.threadRequests[b.requestId].receipt=receipt;draft.threadRequests[b.requestId].status=receipt.threadId?'created':'pending';if(receipt.threadId)draft.imported=[...new Set([...(draft.imported??[]),receipt.threadId])];});await refreshMetadata();
          if(receipt.threadId){try{await ensureThreadNaming(receipt.threadId,'面板执行');}catch{/* 命名失败不阻塞创建，可在界面按规范重命名 */}}
          return json(res,200,{ok:true,receipt});
        }catch(e){await mutate(draft=>{if(draft.threadRequests[b.requestId].status==='creating')draft.threadRequests[b.requestId].status=e.notApplied===true?'failed':'uncertain';});throw e;}
      }
      if(url.pathname==='/api/threads/rename'){
        if(typeof b.threadId!=='string'||!/^[a-zA-Z0-9-]{10,80}$/.test(b.threadId))throw new Error('请选择有效对话');
        await refreshMetadata();
        if(!catalog.threads.some(t=>t.id===b.threadId))throw new Error('此对话不属于当前本机可用项目');
        if(nativeSession)nativePanels.request(nativePanels.check(req.headers['x-leix-native-session']),req.method,url.pathname,b);
        const result=await ensureThreadNaming(b.threadId,typeof b.purpose==='string'?b.purpose.slice(0,80):'');
        return json(res,200,{ok:true,...result});
      }
      if(url.pathname==='/api/connection/instances')return json(res,200,{instances:(await discoverInstances()).map(({id,label})=>({id,label})),selected:bridge.instanceId});
      if(url.pathname==='/api/connection/setup'){
        if(state.jobs.some(j=>['queued','sending','submitted','running','uncertain'].includes(j.status)))throw new Error('尚有在途任务，不能切换调度连接');
        const caller=connectionThreadId(b.caller);
        if(!caller||typeof b.instanceId!=='string')throw new Error('请选择本机实例并填写有效的 Codex 聊天链接或 ID');
        const candidate=makeBridge(caller,b.instanceId);await candidate.connect();const current=await readDesktopThread(candidate,{threadId:caller,turnLimit:1,maxOutputCharsPerItem:0},sessionReader);
        if(current.thread?.id!==caller||current.thread?.kind!=='codex'||current.thread?.hostId!=='local')throw new Error('调度任务不是所选实例可用的本机 Codex 对话');
        await mutate(draft=>{if(draft.jobs.some(j=>['queued','sending','submitted','running','uncertain'].includes(j.status)))throw Error('连接核对期间已有在途任务，未切换连接');draft.caller=caller;draft.connection={instanceId:b.instanceId};});catalogHealth.invalidate();Object.assign(bridge,candidate);await refreshMetadata();return json(res,200,{ok:true});
      }
      if(url.pathname==='/api/boards/enable'||url.pathname==='/api/boards/disable'){
        const enable=url.pathname.endsWith('/enable');await mutate(draft=>configureSidecars(draft,b,catalog,enable));
        if(enable)void sidecars.synchronize();return json(res,200,{ok:true,boards:sidecars.snapshot()});
      }
      if(url.pathname==='/api/boards/open'){
        const project=catalog.projects.find(p=>p.projectId===b.projectId&&p.hostId==='local'&&p.path);
        if(!project)throw Error('请选择已读取的本机项目');
        const key=JSON.stringify([b.projectId,b.threadId]);
        let request=openingSidebars.get(key);
        if(b.recreate!==undefined&&typeof b.recreate!=='boolean')throw Error('重新创建参数无效');
        if(!request){request=openProjectSidebar({project,threadId:b.threadId,origin,bridge,sessionReader,view:'project',attach:(candidate,options)=>sidecars.attach(candidate,options),recreate:b.recreate===true});openingSidebars.set(key,request);}
        try{return json(res,200,{ok:true,...await request});}finally{if(openingSidebars.get(key)===request)openingSidebars.delete(key);}
      }
      if(url.pathname==='/api/boards/retry'){
        await mutate(draft=>retrySidecars(draft,b,catalog));void sidecars.synchronize();return json(res,200,{ok:true,boards:sidecars.snapshot()});
      }
      if(url.pathname==='/api/properties/change')return json(res,200,{ok:true,...await mutate(draft=>changeProperties(draft,b,catalog.projects))});
      if(url.pathname==='/api/task-groups/change'){
        const project=versionProject(catalog.projects,b.projectId);
        return json(res,200,{ok:true,...await mutate(draft=>changeTaskGroup(draft,b,project.projectId))});
      }
      if(url.pathname==='/api/project-board/change'){
        return json(res,200,{ok:true,projectBoard:await mutate(draft=>changeProjectBoard(draft,b,catalog.projects))});
      }
      if(url.pathname==='/api/tasks/priority')return json(res,200,{ok:true,...await command({operation:'setTaskPriority',payload:{input:b}})});
      if(url.pathname==='/api/tasks/suggest')return json(res,200,{ok:true,...suggestTask(state,versionProject(catalog.projects,b.projectId).projectId,b,classify({text:(b.title??'')+' '+(b.description??'')},[],null).kind)});
      if(url.pathname==='/api/sections/save')return json(res,200,{ok:true,section:await mutate(draft=>saveSection(draft,b,versionProject(catalog.projects,b.projectId).projectId))});
      if(['/api/projects/sync-current','/api/projects/sync-composer'].includes(url.pathname)){
        try{
          const project=catalog.projects.find(p=>p.projectId===b.projectId);
          res.syncTiming?.mark('context.end');
          return json(res,200,{ok:true,...await directSync.submit({...b,selection:composerSelection},project,{composer:url.pathname.endsWith('sync-composer'),timing:res.syncTiming})});
        }catch(error){return json(res,400,{error:error.message,code:diagnosticCode(error),notApplied:error.notApplied===true});}
      }
      if(url.pathname==='/api/projects/transfers/refresh'){
        if(b.projectId!==state.workspace.controllerProjectId)throw Error('请在本机总控查看待接入项目');
        await refreshMetadata();await projectCatalog.refresh({force:true});return json(res,200,{ok:true,projectTransfers:projectCatalog.snapshot()});
      }
      if(url.pathname==='/api/projects/adopt'){
        assertWritable();
        const prior=state.jobs.find(j=>j.workflowRequestId===b.requestId);
        if(prior){if(prior.operation!=='project-adopt'||prior.projectId!==b.projectId||prior.threadId!==b.threadId||normalize(prior.path)!==normalize(b.path)||prior.adoption.id!==b.offerId||prior.adoption.commit!==b.commit)throw Error('接入请求已用于其他项目、目录或版本');return json(res,200,{ok:true,job:prior,duplicate:true});}
        if(maintenanceWaiting(state)||syncRunning||dispatching)throw Error('面板正在更新或同步，请稍后手动接入');
        const offer=projectCatalog.snapshot().projects.find(p=>p.id===b.offerId&&p.commit===b.commit);
        if(!offer)throw Error('项目接入说明已变化或尚未读取，请刷新后重试');
        const project=catalog.projects.find(p=>p.projectId===b.projectId);
        if(normalize(b.path)!==normalize(project?.path))throw Error('目标文件夹已变化，请重新选择');
        if(project?.sourcePath)throw Error('此会话已有源码目录关联，请使用同步项目；新接入需选择独立的实际源码目录');
        await requireActivities({requestId:b.requestId});
        await (options.inspectTransferDirectory??inspectTransferDirectory)(project,offer);
        const result=await mutate(draft=>{if(maintenanceWaiting(draft)||syncRunning||dispatching)throw Error('接入条件已变化，未安排');return queueProjectAdoption(draft,b,catalog,offer);});
        void tick();return json(res,200,{ok:true,...result});
      }
      if(url.pathname==='/api/projects/sync-task'){
        const project=catalog.projects.find(p=>p.projectId===b.projectId),reason=workspaceReason(state,project);if(reason)throw Error(reason);
        const result=await mutate(draft=>{if(maintenanceWaiting(draft))throw Error('公共面板等待重启，暂不接收同步任务');if(syncRunning)throw Error('待办正在同步，请稍后再安排');return ensureProjectSyncTask(draft,b,project);});
        return json(res,200,{ok:true,...result});
      }
      if(url.pathname==='/api/tasks/create'||url.pathname==='/api/tasks/update'){
        const creating=url.pathname.endsWith('/create');let result;
        try{result=await command({operation:creating?'createTask':'updateTask',payload:{input:b,...(creating?{projects:catalog.projects}:{})}});}
        catch(error){
          // A rejected retry may follow a lost successful create response.
          // Only unlock creation when the stored request ID is absent and
          // storage has no unknown commit; otherwise retain the receipt.
          const notApplied=!repository.inspect().fault&&error.code!=='COMMIT_UNKNOWN'&&(!creating||!repository.view().tasks.some(t=>t.createRequestId===b.requestId));
          return json(res,400,{error:error.message,...(notApplied?{notApplied:true}:{})});
        }
        return json(res,200,{ok:true,...result});
      }
      if(url.pathname==='/api/tasks/archive'){
        await mutate(draft=>{
          const task=draft.tasks.find(t=>t.id===b.id);assertNoHandoff(task);
          if(!task||!['todo','review','done'].includes(task.status))throw Error('任务仍在执行，结束后可删除');
          if(Object.hasOwn(b,'jobId')&&(b.jobId??null)!==(task.currentJobId??null))throw Error('任务轮次已变化，请刷新后核对');
          if(task.status==='todo'&&task.syncReserved)throw Error('待执行任务已领取，请先核对领取状态');
          if(draft.jobs.some(j=>j.taskId===task.id&&['queued','sending','submitted','running'].includes(j.status)))throw Error('任务仍在执行，结束后可删除');
          if(task.status==='todo'&&draft.automation.plans.some(p=>['active','paused'].includes(p.status)&&p.nodes.some(n=>n.taskId===task.id&&!n.skipped)))throw Error('任务仍有执行安排，请先停止未发送任务再删除');
          task.archivedAt??=new Date().toISOString();
        });return json(res,200,{ok:true});
      }
      if(url.pathname==='/api/tasks/restore-claimed'){
        if(b.confirmed!==true||syncRunning||dispatching)throw Error('请确认恢复本机领取卡片，并等待当前同步结束');
        const check=draft=>{
          const task=draft.tasks.find(t=>t.id===b.id),mapping=draft.workspace.mappings[task?.projectId];
          if(!task||task.status!=='todo'||!task.archivedAt||!task.syncReserved||!task.syncReservationConfirmed||task.captureCancelled||task.mergedInto)throw Error('此卡片没有可恢复的本机领取回执');
          if(draft.jobs.some(j=>j.taskId===task.id)||!mapping||!draft.sync.base.some(r=>r.id===task.syncId&&r.deleted&&r.logicalId===mapping.logicalId))throw Error('领取或执行状态需核对，未恢复');
          return task;
        };
        const before=JSON.stringify(check(state)),backupPath=await repository.backup(restartBackup);
        await mutate(draft=>{const task=check(draft);if(JSON.stringify(task)!==before)throw Error('卡片已变化，请重新核对');delete task.archivedAt;task.history??=[];task.history.push({id:randomUUID(),at:new Date().toISOString(),type:'sync-claim-visible-restored',note:'已定向恢复本机确认领取的卡片；领取锁与远端已领取标记保持，未重复发送。'});});
        return json(res,200,{ok:true,backupPath,message:'原卡片已恢复，领取状态保留；尚未发送任务'});
      }
      if(url.pathname==='/api/tasks/reconcile-delivery'){
        const project=catalog.projects.find(p=>p.projectId===b.projectId);
        if(!project||normalize(project.path)!==normalize(programRoot)||project.hostId!=='local')throw Error('只能接续当前本机源码项目');
        if(syncRunning||maintenanceWaiting(state)||repository.inspect().backend!=='json')throw Error('请等待同步/维护结束；当前接续入口仅支持JSON运行数据');
        const proof=await inspectDelivery(programRoot,b.commit),preview=deliveryPreview(state,b,proof);
        if(b.confirmed!==true||preview.duplicate)return json(res,200,{ok:true,...preview});
        if(b.previewHash!==preview.previewHash)throw Error('接续预览已变化，请重新核对');
        const backupPath=await repository.backup(restartBackup);
        const result=await mutate(draft=>{
          if(syncRunning||maintenanceWaiting(draft))throw Error('同步或维护状态已变化，未接续');
          return reconcileDelivery(draft,b,proof);
        });
        return json(res,200,{ok:true,...result,backupPath});
      }
      if(url.pathname==='/api/tasks/handoff'){
        const task=state.tasks.find(t=>t.id===b.id),project=catalog.projects.find(p=>p.projectId===task?.projectId),reason=workspaceReason(state,project);if(reason)throw Error(reason);
        if(!task||normalize(task.path)!==normalize(project?.path))throw Error('项目归属已变化');
        const result=await mutate(s=>{const t=s.tasks.find(t=>t.id===b.id);return requestHandoff(s,b,instructionHash(t));});void tick();return json(res,200,{ok:true,...result});
      }
      if(url.pathname==='/api/tasks/confirm-handoff'){
        const task=state.tasks.find(t=>t.id===b.id),h=task?.handoff,route=state.automation.routes[h?.routeKey];
        if(!h||route?.initialDispatch?.handoffId!==h.id||route.initialDispatch.phase!=='uncertain')throw Error('没有可核对的接续创建意图');
        if(typeof b.threadId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(b.threadId)||b.threadId===h.sourceThreadId)throw Error('请选择或填写新建接续对话的标识');
        await initialDispatcher.confirm(h.routeKey,b.threadId);void tick();return json(res,200,{ok:true});
      }
      if(url.pathname==='/api/tasks/cancel-handoff'){const result=await mutate(s=>cancelHandoff(s,b.id));return json(res,200,{ok:true,...result});}
      if(url.pathname==='/api/tasks/send-current'){
        let committing=false;
        try{
          const task=repository.getTask(b.id)?.value,project=catalog.projects.find(p=>p.projectId===task?.projectId);
          if(!task||b.projectId!==task.projectId)throw Error('当前任务不属于此项目');
          const reason=workspaceReason(state,project);if(reason)throw Error(reason);
          if(task.archivedAt)throw Error('此待办已移出或被其他电脑领取，请同步核对');
          attachmentPrompt(root,task.attachments??[]);
          const input={id:task.id,threadId:b.threadId,requestId:b.requestId},policy={routed:true,deliveryKind:CURRENT_THREAD_DELIVERY,deferDependencies:true,gate:'completed',...(b.currentThreadMode!==undefined?{currentThreadMode:b.currentThreadMode}:{desiredModel:currentModel()})};
          const preview=executeTask(structuredClone(state),input,catalog,policy);
          const nativeReason=!preview.duplicate&&nativeSubmitConflict(preview.job);if(nativeReason)throw Error(nativeReason);
          committing=true;if(!preview.duplicate)await reserveSyncedTask(task);
          const result=await command({operation:'enqueueTask',payload:{input,catalog,policy}});
          if(!result.duplicate)void tick();return json(res,200,{ok:true,scheduled:true,...result});
        }catch(error){return json(res,400,{error:error.message,notApplied:!committing,notSent:!committing});}
      }
      if(url.pathname==='/api/tasks/execute'){
        if(b.accept===true){const result=await command({operation:'startPlan',payload:{manualAcceptance:true,input:{id:b.id,requestId:b.requestId,pausedPlanId:b.pausedPlanId,retryPreparation:b.retryPreparation===true,expectedRevision:b.expectedRevision}}});void tick({accepted:true});return json(res,200,{ok:true,accepted:true,scheduled:true,...result});}
        const task=repository.getTask(b.id)?.value,project=catalog.projects.find(p=>p.projectId===task?.projectId),reason=workspaceReason(state,project);if(reason)throw new Error(reason);
        if(task)attachmentPrompt(root,task.attachments??[]);
        if(task?.archivedAt)throw new Error('此待办已移出或被其他电脑领取，请同步核对');
        if(task?.execution||task?.sectionId||task?.dependsOn?.length||b.pausedPlanId!==undefined){const result=await command({operation:'startPlan',payload:{input:{projectId:task.projectId,ids:[task.id],requestId:b.requestId,maxConcurrent:task.execution?.parallel===false?1:0,...(b.pausedPlanId!==undefined?{pausedPlanId:b.pausedPlanId}:{gate:'completed',includeDependencies:true})}}});void tick();return json(res,200,{ok:true,scheduled:true,...result});}
        const input=task?.pendingContinuation?{...b,threadId:task.pendingContinuation.threadId}:b,policy={routed:!!task?.pendingContinuation,desiredModel:currentModel()};
        const preview=executeTask(structuredClone(state),input,catalog,policy);
        if(!preview.duplicate)await reserveSyncedTask(task);
        const result=await command({operation:'enqueueTask',payload:{input,catalog,policy}});
        if(!result.duplicate)void tick();return json(res,200,{ok:true,...result});
      }
      if(url.pathname==='/api/tasks/retry-review'){
        const task=repository.getTask(b.id)?.value,project=catalog.projects.find(p=>p.projectId===task?.projectId);
        const reason=workspaceReason(state,project);if(reason)throw Error(reason);
        if(task)attachmentPrompt(root,task.attachments??[]);
        let uncertainVerified=false;
        const previous=state.jobs.find(j=>j.id===b.jobId&&j.taskId===b.id);
        if(previous?.status==='uncertain'){
          await requireActivities({requestId:b.requestId});
          if(b.confirmed!==true)throw Error('请先核对原对话，确认不会再产生本轮执行');
          const current=await readForRecovery(previous.threadId),t=current.thread;
          if((typeof t?.status==='string'?t.status:t?.status?.type)!=='idle'||t?.id!==previous.threadId||t?.kind!=='codex'||t?.hostId!=='local'||normalize(t?.cwd)!==normalize(previous.path))throw Error('尚未确认原对话属于本项目且已空闲，不能重新执行');
          uncertainVerified=true;
        }
        const preview=retryReviewedTask(structuredClone(state),b,catalog,{uncertainVerified,desiredModel:currentModel()});
        if(!preview.duplicate)await reserveSyncedTask(task);
        const result=await command({operation:'retryTask',payload:{input:b,catalog,policy:{uncertainVerified,desiredModel:currentModel()}}});
        if(!result.duplicate)void tick();
        return json(res,200,{ok:true,...result});
      }
      if(url.pathname==='/api/tasks/review-state'){
        const target=reviewTarget(repository,b,catalog),view=await inspectReviewThread(bridge,sessionReader,target.job.value,{read:readForRecovery});
        assertReviewTarget(repository,target);
        return json(res,200,{ok:true,jobId:target.job.value.id,archived:view.archived,idle:view.idle,threadStatus:typeof view.thread.status==='string'?view.thread.status:view.thread.status?.type});
      }
      if(url.pathname==='/api/tasks/restore-thread'){
        const target=reviewTarget(repository,b,catalog),key=target.job.value.threadId;
        if(restoringReviews.has(key))throw Error('正在恢复原对话，请等待核对结果');
        if(['queued','sending','submitted','running'].includes(target.job.value.status)||state.jobs.some(j=>j.taskId===b.id&&j.id!==b.jobId&&['queued','sending','submitted','running','uncertain'].includes(j.status)))throw Error('同任务仍有在途执行，不能恢复');
        restoringReviews.add(key);
        try{
          const view=await inspectReviewThread(bridge,sessionReader,target.job.value,{read:readForRecovery});assertReviewTarget(repository,target);
          if(!view.archived)return json(res,200,{ok:true,restored:false,idle:view.idle,message:'原对话已取消归档，请重新核对审阅状态'});
          const backupPath=await reviewBackup(sessionReader,target.job.value);
          assertReviewTarget(repository,target);
          const checked=await inspectReviewThread(bridge,sessionReader,target.job.value,{read:readForRecovery});assertReviewTarget(repository,target);
          if(!checked.archived)return json(res,200,{ok:true,restored:false,backupPath,message:'原对话已取消归档，请重新核对审阅状态'});
          await bridge.call('set_thread_archived',{threadId:key,hostId:'local',archived:false});
          await refreshMetadata();
          return json(res,200,{ok:true,restored:true,backupPath,message:'已恢复原对话；请打开原对话核对，未发送或重试任务'});
        }finally{restoringReviews.delete(key);}
      }
      if(url.pathname==='/api/tasks/approve'){
        if(b.acceptResult===true)return json(res,200,{ok:true,...await command({operation:'approveTask',payload:{input:b}})});
        if(b.manual!==true)return json(res,200,{ok:true,...await command({operation:'approveTask',payload:{input:b}})});
        const target=reviewTarget(repository,b,catalog);
        if(b.confirmed!==true||typeof b.note!=='string'||!b.note.trim())throw Error('请填写验收依据并确认成果已完成且不会再产生本轮执行');
        const view=await inspectReviewThread(bridge,sessionReader,target.job.value,{read:readForRecovery});
        if(view.archived)throw Error('原对话已归档，请先恢复原对话并核对');
        if(!view.idle)throw Error('尚未确认原对话已空闲，不能人工验收');
        const current=await readForRecovery(target.job.value.threadId);
        if(validateReviewThread(current.thread,target.job.value)!=='idle')throw Error('尚未确认原对话属于本项目且已空闲，不能人工验收');
        return json(res,200,{ok:true,...await command({operation:'approveTask',expected:target.expected,payload:{input:b,policy:{manualVerified:true}}})});
      }
      if(url.pathname==='/api/tasks/return-to-todo'){
        const task=repository.getTask(b.id),job=task?.value.currentJobId?repository.getJob(task.value.currentJobId):null;
        const expected=[];let uncertainVerified=false;
        if(job?.value.status==='uncertain'){
          if(b.confirmed!==true||b.jobId!==job.value.id)throw Error('请先核对当前轮次并确认不会再产生本轮执行');
          const current=await readForRecovery(job.value.threadId),thread=current.thread;
          if((typeof thread?.status==='string'?thread.status:thread?.status?.type)!=='idle'||thread?.id!==job.value.threadId||thread?.kind!=='codex'||thread?.hostId!=='local'||normalize(thread?.cwd)!==normalize(job.value.path))throw Error('尚未确认原对话属于本项目且已空闲，不能退回');
          expected.push({entity:'tasks',id:task.value.id,revision:task.revision},{entity:'jobs',id:job.value.id,revision:job.revision});uncertainVerified=true;
        }
        return json(res,200,{ok:true,...await command({operation:'returnTask',expected,payload:{input:b,policy:{uncertainVerified}}})});
      }
      if(url.pathname==='/api/tasks/resolve-uncertain'){
        const task=state.tasks.find(t=>t.id===b.id),job=state.jobs.find(j=>j.id===task?.currentJobId);
        if(!job||job.status!=='uncertain')throw new Error('此任务当前没有未确认的发送');
        if(b.jobId!==undefined&&b.jobId!==job.id||b.threadId!==undefined&&b.threadId!==job.threadId)throw Error('原执行或对话已变化，未解除占用');
        const current=await readForRecovery(job.threadId);
        const threadStatus=typeof current.thread?.status==='string'?current.thread.status:current.thread?.status?.type;
        if(threadStatus!=='idle')throw new Error('尚未确认原对话空闲，不能释放未决记录');
        if(current.thread?.id!==job.threadId||current.thread?.kind!=='codex'||current.thread?.hostId!=='local'||normalize(current.thread?.cwd)!==normalize(job.path))throw new Error('无法确认原对话及项目，请刷新后核对');
        const result=await mutate(draft=>{assertRecoveryInactive(job.threadId);const latest=draft.jobs.find(j=>j.id===job.id);if(draft.tasks.find(t=>t.id===b.id)?.currentJobId!==job.id||latest?.threadId!==job.threadId||normalize(latest?.path)!==normalize(job.path))throw new Error('任务已变化，请刷新');return resolveUncertainTask(draft,b);});
        return json(res,200,{ok:true,...result});
      }
      if(url.pathname==='/api/jobs/resolve-uncertain'){
        const job=state.jobs.find(j=>j.id===b.id&&!j.taskId);if(!job||job.status!=='uncertain')throw new Error('此旧记录没有未决发送');
        const current=await readForRecovery(job.threadId),t=current.thread;
        if((typeof t?.status==='string'?t.status:t?.status?.type)!=='idle'||t?.id!==job.threadId||t?.kind!=='codex'||t?.hostId!=='local'||normalize(t?.cwd)!==normalize(job.path))throw new Error('无法确认原对话属于本项目且已空闲，不能释放');
        return json(res,200,{ok:true,...await mutate(draft=>{assertRecoveryInactive(job.threadId);return resolveLegacyJob(draft,b);})});
      }
      if(url.pathname==='/api/refresh'){
        if(b.background===true){track(refreshMetadata().catch(()=>{}));return json(res,202,{ok:true,accepted:true,checking:true,catalogHealth:catalogHealth.snapshot()});}
        await requireActivities({requestId:b.requestId});return json(res,200,{ok:true,catalogHealth:catalogHealth.snapshot()});
      }
      if(url.pathname==='/api/import'){if(typeof b.threadId!=='string'||!b.threadId.match(/^[a-zA-Z0-9-]{10,80}$/))throw new Error('请输入有效任务 ID');const r=await read(b.threadId);if(r.thread?.kind!=='codex'||r.thread.hostId!=='local'||!catalog.projects.some(p=>normalize(p.path)===normalize(r.thread.cwd)))throw new Error('此任务不属于本机绑定项目');await mutate(draft=>{draft.imported=[...new Set([...(draft.imported??[]),b.threadId])];});await refreshMetadata();return json(res,200,{ok:true});}
      if(url.pathname==='/api/bind'){
        await mutate(draft=>setBinding(draft,b,catalog));return json(res,200,{ok:true});
      }
      if(url.pathname==='/api/jobs'){
        if(typeof b.batchId!=='string'||b.batchId.length>100)throw new Error('缺少批次标识');
        if(state.jobs.some(j=>j.batchId===b.batchId))return json(res,200,{ok:true,duplicate:true});
        const testPrompt='这是本地面板连接测试。请只回复“面板连接测试成功”，不要调用工具，不要读取、修改或创建文件。';
        const connectionTest=b.connectionTest===true;
        // A read-only connection test can be arranged from the saved directory.
        // The queue still forces complete live verification before any send.
        if(!connectionTest)await requireActivities({requestId:b.requestId});
        const targets=[...catalog.threads];
        if(connectionTest){
          if(!Array.isArray(b.items)||!b.items.length||b.items.length>20)throw Error('请选择 1–20 个项目');
          for(const item of b.items){
            const project=catalog.projects.find(p=>p.projectId===item?.projectId&&p.hostId==='local');
            if(!project)throw Error('项目不存在，请刷新后核对');
            if(targets.some(t=>t.id===item.threadId))continue;
            const response=await readDesktopThread(bridge,{threadId:item.threadId,hostId:'local',turnLimit:1,maxOutputCharsPerItem:0},sessionReader);
            if(response.thread?.id!==item.threadId)throw Error('无法确认指定测试对话');
            targets.push(response.thread);
          }
        }
        const rows=validateBatch(connectionTest?b.items.map(i=>({...i,prompt:testPrompt})):b.items,catalog.projects,targets);
        const result=await mutate(draft=>{
          if(maintenanceWaiting(draft))throw Error('面板等待更新，暂不接收新执行');
          if(draft.jobs.some(j=>j.batchId===b.batchId))return {duplicate:true};
          draft.jobs.push(...rows.map(r=>({...r,connectionTest:b.connectionTest===true,id:randomUUID(),batchId:b.batchId,status:'queued',createdAt:new Date().toISOString(),message:'等待发送'})));return {duplicate:false};
        });if(!result.duplicate)void tick();return json(res,200,{ok:true,...result});
      }
      if(url.pathname==='/api/cancel'){await mutate(draft=>cancelQueuedJob(draft,b));return json(res,200,{ok:true});}
      if(url.pathname==='/api/open'){if(!catalog.threads.some(t=>t.id===b.threadId))throw new Error('任务不存在');await bridge.call('navigate_to_codex_page',{threadId:b.threadId});return json(res,200,{ok:true});}
      return json(res,404,{error:'接口不存在'});
    }
    const files={'/project-board.js':'project-board.js','/task-groups.js':'task-groups.js','/project-references.js':'project-references.js','/execution-recovery.js':'execution-recovery.js','/diagnostics.js':'diagnostics.js','/plugin-host.js':'plugin-host.js','/handoff-ui.js':'handoff-ui.js','/workflow-prompts.js':'workflow-prompts.js','/project-context.js':'project-context.js','/':'index.html','/result-verification.js':'result-verification.js','/rounds.js':'rounds.js','/read-client.js':'read-client.js','/task-organization.js':'task-organization.js','/plan-ui.js':'plan-ui.js','/version-assistant.js':'version-assistant.js','/versions.js':'versions.js','/automation-ui.js':'automation-ui.js','/lineage.js':'lineage.js','/properties.js':'properties.js','/app.js':'app.js','/hub.js':'hub.js','/workflow-init.js':'workflow-init.js','/style.css':'style.css','/support-alipay.jpg':'support-alipay.jpg'};
    if(req.method!=='GET'||!files[url.pathname])return json(res,404,{error:'页面不存在'});
    res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':url.pathname.endsWith('.css')?'text/css; charset=utf-8':url.pathname==='/support-alipay.jpg'?'image/jpeg':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",'X-Content-Type-Options':'nosniff'});res.end(fs.readFileSync(path.join(programRoot,'public',files[url.pathname])));
  }catch(e){res.diagnosticError=e;json(res,e.status??400,{error:e.message,...(e.code?{code:e.code}:{}),...(e.notApplied===true?{notApplied:true}:{}),...(e.code==='CATALOG_UNVERIFIED'?{notApplied:e.notApplied===true,catalogHealth:catalogHealth.snapshot()}: {})});}
}
async function collectPlan(id,project){
  const report=readPlanReceipt(state,id,project,root);
  if(!report){const request=state.planIntakes.find(r=>r.id===id);return {status:request.status,result:request.result};}
  const result=await mutate(draft=>importPlan(draft,id,project,report));return {status:'imported',result};
}
async function collectPlans(){
  if(closing||restarting)return;
  for(const request of state.planIntakes.filter(r=>r.status==='waiting'&&Date.now()-Date.parse(r.createdAt)<86400000)){
    const project=catalog.projects.find(p=>p.projectId===request.projectId);if(!project)continue;
    try{await collectPlan(request.id,project);}catch(e){if(request.error!==e.message)await mutate(draft=>{draft.planIntakes.find(r=>r.id===request.id).error=e.message;});}
  }
}
const timers=[];
const syncTick=autoSync.tick.bind(autoSync);
autoSync.tick=()=>closing?Promise.resolve():track(syncTick());
state=await repository.activate(state,{requireUnchanged:!!pendingStartup});
diagnostics.observe(state);
serve=(req,res)=>{track(handleRequest(req,res));};
function startTimers(){if(options.autostart===false||pendingStartup||closing||timers.length)return;void lightTick().catch(()=>{});timers.push(setInterval(()=>track(collectPlans()).catch(error=>{connectionError=error.message;}),3000),setInterval(()=>void autoSync.tick(),1000),setInterval(()=>track(maintenanceTick()).catch(error=>{connectionError=error.message;}),1000),setInterval(()=>void tick(),6000),setInterval(()=>void lightTick().catch(()=>{}),1000));if(separateData&&releaseScheduler){void track(checkProductRelease(false)).catch(()=>{});timers.push(setInterval(()=>void track(checkProductRelease(false)).catch(()=>{}),60*60*1000));}for(const timer of timers)timer.unref();}
startTimers();
async function confirmStartup(){
  if(!pendingStartup)throw Error('没有待确认的升级启动');
  const result=await confirmPendingUpdate({installRoot:pendingStartup.installRoot,dataRoot:root,programRoot,lease:dataLock,id:pendingStartup.id,origin,instanceId});
  pendingStartup=null;startTimers();return result;
}
function close(){
  if(closePromise)return closePromise;
  closing=true;for(const timer of timers)clearInterval(timer);
  closePromise=(async()=>{
    // A browser may leave an HTTP connection open after the listener closes.
    // Bound that wait, then drain the handlers and storage writers below.
    await new Promise((resolve,reject)=>{
      let stalledClients;
      server.close(error=>{clearTimeout(stalledClients);error?reject(error):resolve();});
      stalledClients=setTimeout(()=>server.closeAllConnections(),options.shutdownHttpGraceMs??10000);
      stalledClients.unref();
    });
    // Requests and refreshes can start child writes before they settle. Drain
    // again after each round so no writer survives the returned close promise.
    for(;;){const pending=[...pendingOperations,...directSync.active.values(),...directMessages.active.values(),composer.active?.promise,projectCatalog.pending,ticking,refreshing,metadataRefreshing,connecting,sidecars.running].filter(Boolean);if(!pending.length)break;await Promise.allSettled(pending);}
    await desktopContext.close();await repository.close();await dataLock.release();
  })();return closePromise;
}
return {origin,refresh,refreshMetadata,lightTick,tick,autoSync,maintenanceTick,close,confirmPendingUpdate:confirmStartup,storage:()=>repository.inspect()};
}catch(error){
  if(server.listening)await new Promise(resolve=>server.close(resolve));
  try{await repository?.close();}finally{await dataLock.release();}
  throw error;
}
}
export async function runPanelProcess(options={}){
  let stopping;
  const finish=()=>{for(const signal of ['SIGINT','SIGTERM'])process.removeListener(signal,stop);process.removeListener('message',message);process.removeListener('disconnect',stop);if(process.connected)process.disconnect();};
  const shutdown=(restart=false,updateId=null,destination=null)=>stopping??=(async()=>{
    const app=await starting;
    await app.close();
    if(restart&&process.connected)await new Promise((resolve,reject)=>process.send({type:'panel-restart-ready'},error=>error?reject(error):resolve()));
    if(updateId&&process.connected)await new Promise((resolve,reject)=>process.send({type:'panel-update-ready',id:updateId},error=>error?reject(error):resolve()));
    if(destination&&process.connected)await new Promise((resolve,reject)=>process.send({type:'panel-relocation-ready',destination},error=>error?reject(error):resolve()));
    finish();
  })();
  const stop=()=>{void shutdown().catch(error=>{console.error(error.message);process.exitCode=1;finish();});};
  const message=value=>{if(value?.type==='panel-stop')stop();};
  const requestRestart=typeof process.send==='function'?()=>shutdown(true):undefined;
  const requestUpdate=typeof process.send==='function'&&options.installRoot&&options.dataRoot?({id})=>shutdown(false,id):undefined;
  const requestRelocation=typeof process.send==='function'&&options.installRoot&&options.dataRoot&&process.env.PAIBAN_DATA_LOCATION_SUPPORTED==='1'?destination=>shutdown(false,null,destination):undefined;
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
  process.on('message',message);process.on('disconnect',stop);
  const starting=createPanel({activityScope:'panel',...options,requestRestart,requestUpdate,requestRelocation});
  try{const app=await starting;if(options.pendingUpdate){try{await app.confirmPendingUpdate();if(process.connected)await new Promise((resolve,reject)=>process.send({type:'panel-update-confirmed'},error=>error?reject(error):resolve()));}catch(error){await app.close();throw error;}}return app;}catch(error){finish();throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const dataRoot=process.env.CODEXKZ_INSTALLED_DATA_ROOT;
  const pendingId=process.env.CODEXKZ_PENDING_UPDATE,installRoot=process.env.CODEXKZ_INSTALL_ROOT;
  if(pendingId&&!installRoot)throw Error('待确认升级参数不完整');
  runPanelProcess({...dataRoot?{dataRoot}:{},...installRoot?{installRoot}:{},...pendingId?{pendingUpdate:{id:pendingId,installRoot}}:{},relocationError:process.env.PAIBAN_RELOCATION_ERROR}).then(app=>console.log(`Codex 项目调度台：${app.origin}`)).catch(error=>{console.error(error.message);process.exitCode=1;});
}
