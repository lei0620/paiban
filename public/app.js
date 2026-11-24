import {panelFetch as fetch,panelLocation as location,panelHistory as history,responseError} from './read-client.js';
import {handoffMarkup,initHandoffUI} from './handoff-ui.js';
import {initTaskOrganization,updateTaskOrganization,openTaskOrganization,organizationValues,submitEditorTask,nativeReceiptNotSubmitted,renderTaskGroups,renderRecentCompleted,taskSection,cancelTaskSuggestion,taskModeContent,readTaskModeContent} from './task-organization.js';
import {initPlanUI,updatePlanUI} from './plan-ui.js';
// Check backend capabilities before requesting scripts added in newer releases.
let bootstrapState,bootstrapError='';
try{let response=await fetch('/api/view/status');if(response.status===404||response.status===403)response=await fetch('/api/state');if(!response.ok)throw Error('面板服务不可用');bootstrapState=await response.json();}catch(error){bootstrapError=error.message;}
if(!bootstrapState?.automation||!bootstrapState?.capture||!Object.hasOwn(bootstrapState,'propertyGroups')||!bootstrapState?.service?.taskRoundsSupported||!bootstrapState?.service?.reviewRecoverySupported){
  document.getElementById('connection').textContent=bootstrapError?'连接异常':'待重启';
  const notice=document.getElementById('notice');notice.className='notice error';notice.setAttribute('role','alert');notice.textContent=bootstrapError?'连接失败：'+bootstrapError+'。请确认面板服务后刷新。':'新版界面已就绪，但当前面板服务仍是旧版本。请重启当前面板服务后刷新；原任务与数据仍保留。';
  document.getElementById('setup').hidden=true;document.getElementById('projectView').hidden=true;
  document.getElementById('refresh').onclick=()=>location.reload();
}else{
const {groupRounds,roundIdOf,executionSuggestion}=await import('./rounds.js');
const {initHub,renderHub,observeDesktopContext}=await import('./hub.js');

const {initAutomation,updateAutomation,selectionControl,isSelected,selectionKey,selectedTaskIds,executionEditor,executionValues,scheduledMessage,scheduledAction,executionManagement,taskLane,scheduledTaskState,editableTask}=await import('./automation-ui.js');
const {initLineage,updateLineage,resetTaskView,readableSourceTask,readableSourceText,showTaskSourceImages,chainHint,chainBlock}=await import('./lineage.js');
const {initProperties,updateProperties,propertyBadges,priorityControl,renderPropertyEditor,readPropertyEditor,filterTasks,sortTasks,filterKey}=await import('./properties.js');
const {initExecutionRecovery}=bootstrapState.service?.executionRecoverySupported?await import('./execution-recovery.js'):{};
const {initProjectReferences}=bootstrapState.service?.projectReferencesSupported?await import('./project-references.js'):{};
const {initTaskGroups,renderBoardGroups,taskGroupOptions,taskGroupPath,matchTaskGroup}=bootstrapState.service?.taskGroupsSupported?await import('./task-groups.js'):{};
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=p=>(p??'').replaceAll('/','\\').replace(/\\+$/,'').toLowerCase();
const statuses={queued:'已手动执行，等待项目空闲',sending:'正在提交',submitted:'等待回复',running:'执行中',completed:'本轮对话已结束',failed:'执行失败',uncertain:'发送未确认，请先核对',cancelled:'已取消排队',interrupted:'执行已中断',released:'已解除未决记录'};
const eventLabels={'execution-cancelled':'已取消未发送任务','source-archived':'历史需求已归档','round-added':'原卡片追加修改轮次','round-note':'补充讨论与反馈','parent-approved':'主任务验收通过','observed':'观察到原对话执行','requirement-added':'补充需求','recognition-undone':'撤销自动识别','links-changed':'修改任务关系','plan-confirmed':'确认方案','delivery-reconciled':'跨电脑完成接续','delivery-confirmed':'核对交付状态','task-split':'拆分子任务','task-merged':'合并任务','merged-into':'并入其他任务','priority-changed':'调整优先级',created:'创建任务',edited:'修改任务',executed:'手动执行','execution-status':'执行状态更新',approved:'审阅通过',returned:'稍后处理，已保存到待执行','round-continued':'继续当前轮次','uncertain-resolved':'人工解除未决记录'};
const lanes=[['todo','待执行','单项执行，或多选后批量安排','写下下一件要做的事'],['running','执行中','已手动提交，跟踪本轮进度','执行后，进度会出现在这里'],['review','待审阅','满意点通过，继续可立即处理或稍后处理','对话结束后等你审阅'],['done','已完成','已审阅或已核对完成','保留每一次完成记录']];
const query=new URLSearchParams(location.search),locked=query.has('projectId');
const {ProjectFollower}=bootstrapState.service?.desktopContextSupported?await import('./project-context.js'):{};
const canFollowProject=bootstrapState.service?.desktopContextSupported===true&&bootstrapState.service?.nativeMode!=='thread'&&locked;
const followsProject=()=>canFollowProject&&!['control','versions'].includes(query.get('view'));
if(canFollowProject){const address=new URL(location.href);if(address.searchParams.get('follow')==='off'){address.searchParams.delete('follow');query.delete('follow');}if(!address.searchParams.has('panelSession'))address.searchParams.set('panelSession',crypto.randomUUID());query.set('panelSession',address.searchParams.get('panelSession'));history.replaceState(history.state,'',address);}
// 旧版侧栏曾把总控视图写入对话地址；带对话绑定的看板一律回到项目看板，总控只由项目级入口打开。
if(query.get('view')==='control'&&query.has('threadId')){query.delete('view');const clean=new URL(location.href);clean.searchParams.delete('view');history.replaceState(null,'',clean);}
let projectId=query.get('projectId')??'',state={projects:[],threads:[],bindings:{},tasks:[],jobs:[]},connected=false,loading=false,detailId='',editId='',boardKey='',catalogKey='',detailKey='',bindingDirty=false;
let taskGroupsUI;
const {PanelReader,catalogConnectionView,catalogExecutionBlock}=await import('./read-client.js');
const {PanelSnapshots}=await import('./read-client.js');
const {internalView,automaticAddress}=await import('./project-context.js');
let snapshotStorage;try{snapshotStorage=localStorage;}catch{}
const snapshots=new PanelSnapshots({storage:snapshotStorage});
const documentId=crypto.randomUUID();
const reader=bootstrapState.service?.querySupported?new PanelReader():null;
if(reader)await reader.status(bootstrapState);
let initialReadStatus=bootstrapState;
let verificationPending=0;
let loadAgain=false;
let routeVersion=0;
const routeStates=new Map();
const routeScrolls=new Map();
let projectAddress=history.state?.projectHref??location.href;
let activeViewAddress=location.href;
const pageFilters=()=>{const f=JSON.parse(filterKey())[0];return {sort:f.sort,priority:f.priority,attributes:JSON.stringify(f.attributes)};};
const pageMode=()=>{
  const view=query.get('view');
  if(view==='versions'||(view==='references'&&initProjectReferences))return view;
  return view==='control'&&projectId===(state.workspace??bootstrapState.workspace)?.controllerProjectId?'control':'project';
};
const pending=new Set(),compactView=matchMedia('(max-width:1099px)');
let contextBlocked=false,contextReason='',pageDataReady=false;
const follower=canFollowProject?new ProjectFollower({
  allowPreview:false,
  enabled:()=>followsProject()&&state.service?.desktopContextSupported===true&&!document.hidden,
  current:()=>location.href,projects:()=>state.projects,
  read:async pageUrl=>{const response=await fetch('/api/view/context?'+new URLSearchParams({pageUrl,documentId}),{headers:{'X-Panel-Token':state.token},signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error('当前项目核对暂不可用');const context=await response.json();observeDesktopContext(context);return context;},
  canApply:()=>pending.size===0&&!uploading&&!$('referenceEditor')?.open&&!$('referenceTagManager')?.open&&!$('taskGroupDialog-references')?.open,
  block:blockContext,
  apply:url=>{if($('editor').open)persistEditor();saveStore(draftKey(),drafts);if(url.searchParams.get('projectId')===projectId){const thread=url.searchParams.get('threadId');if(thread)query.set('threadId',thread);else query.delete('threadId');projectAddress=activeViewAddress=url.href;history.replaceState({...history.state,projectHref:projectAddress},'',url);return false;}navigateView(url,true,true);return false;}
}):null;
function blockContext(blocked,reason=''){
  contextBlocked=blocked;contextReason=reason;document.documentElement.dataset.projectContext=blocked?'pending':'ready';
  // Context gates commands in post() and again on the server. Browsing and
  // local drafts stay responsive while the native window is being identified.
  const readOnly=!pageDataReady;
  for(const element of [...['projectView','controlView','versionsView'].map($),...document.querySelectorAll('dialog[open]')])if(element){element.inert=readOnly;element.style.visibility='';}
  if($('notice').dataset.source==='context')notice('');
}
let executionRecovery;
let selectedLane='todo',reviewFeedbackOpen=false,detailReadOnly=false;
let manualReviewMode=false,reviewRecovery={},reviewInspection=0;
function reviewBlockReason(t,job){
  if(!job)return '缺少本轮执行记录，暂不能通过。';
  const dependency=chainBlock(t,true);if(dependency)return dependency;
  if(job.awaitingUser)return '等待你的回复；回答后继续记录在本轮，暂不能通过。';
  if(job.status==='uncertain')return '发送状态未确认。请核对原对话，确认本轮不会继续执行后退回或人工验收。';
  if(job.status==='failed')return '本轮执行失败。可退回处理；成果已完成时可填写依据人工验收。';
  if(job.status==='interrupted')return '本轮执行被中断。可继续处理；成果已完成时可填写依据人工验收。';
  if(job.status==='released')return '未决记录已解除，本轮未标记成功。可退回处理或填写依据人工验收。';
  if(job.status==='completed'&&!job.turnId)return '缺少可靠的本轮关联，不能自动确认正常完成；请核对后人工验收。';
  if(job.status!=='completed')return '本轮尚未结束，暂不能通过。';
  return '';
}
async function inspectReview(){
  const t=task(detailId),job=t&&currentJob(t);if(t?.status!=='review'||!job||!connected)return;
  const id=t.id,jobId=job.id,inspection=++reviewInspection;
  reviewRecovery={id,jobId,loading:true};renderDetail();
  try{
    const result=await post('tasks/review-state',{id,jobId});
    if(inspection===reviewInspection&&detailId===id&&currentJob(task(id))?.id===jobId)reviewRecovery={id,...result};
  }catch(error){if(inspection===reviewInspection&&detailId===id)reviewRecovery={id,jobId,error:error.message};}
  finally{if(inspection===reviewInspection&&detailId===id)renderDetail();}
}
let editorFiles=[],uploading=false,editorDraft='edit:';const fileUrls=new Map(),fileUrlRequests=new Map();let fileTrimTimer;
function readStore(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function saveStore(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{notice('浏览器无法保存草稿，请保持此页面打开。',true);}}
const draftKey=()=>`codex-board-drafts:${projectId}`;
let drafts={};
function getProject(){return state.projects.find(p=>p.projectId===projectId);}
function task(id){return state.tasks.find(t=>t.id===id&&t.projectId===projectId);}
function time(value,short=false){return value?new Date(value).toLocaleString('zh-CN',short?{month:'2-digit',day:'2-digit'}:undefined):'—';}
let noticeTimer;
function notice(text,error=false,source='action'){
  const set=(element,settings=false)=>{
    if(!element||(source==='connection'&&element.dataset.source==='action'&&element.classList.contains('error')&&element.textContent))return false;
    element.dataset.source=source;element.textContent=text;element.className=settings?(error?'error':'hint'):(text?'notice'+(error?' error':''):'');element.setAttribute('role',error?'alert':'status');if(settings)element.hidden=!text;return true;
  };
  if($('workspaceConfig')?.open)set($('workspaceSettingsNotice'),true);
  if(set($('notice'))){clearTimeout(noticeTimer);if(text&&!error&&source!=='connection'&&!/未确认|失败|核对|冲突|异常/.test(text))noticeTimer=setTimeout(()=>{$('notice').textContent='';$('notice').className='';},4500);}
}
function clearConnectionNotice(){
  for(const id of ['notice','workspaceSettingsNotice']){const element=$(id);if(element?.dataset.source!=='connection')continue;element.textContent='';element.className='';element.setAttribute('role','status');delete element.dataset.source;if(id==='workspaceSettingsNotice')element.hidden=true;}
}
async function prepareProjectSync(address){
  const page=new URL(address),sameProject=page.searchParams.get('projectId')===projectId;
  const refuse=message=>{throw Object.assign(Error(message),{notApplied:true});};
  if(!followsProject()||!sameProject||!pageDataReady||location.href!==page.href)refuse('请打开当前项目的已有聊天，在其侧栏中同步');
  const beforeRoute=routeVersion;
  const verified=await follower.check();
  const current=new URL(location.href),threadId=current.searchParams.get('threadId');
  current.searchParams.delete('threadId');
  if(beforeRoute!==routeVersion||current.href!==page.href||!followsProject())refuse('核对期间项目或页面已切换，请在目标聊天重新点击同步');
  if(!verified||!follower.canWrite()||contextBlocked)refuse(contextReason||'暂时无法确认旁边的聊天，请切回要同步的聊天后重试');
  if(!threadId)refuse('当前白板尚未识别到已有聊天，请打开要同步的聊天后重试');
  return location.href;
}
async function post(route,data={},options={}){
  if(route!=='refresh'&&(!pageDataReady||state._snapshot))throw Object.assign(Error('正在读取当前项目，暂时只读；草稿已保留。'),{notApplied:true});
  if(route!=='refresh'&&!(route==='tasks/execute'&&data.accept===true)&&followsProject()&&state.service?.desktopContextSupported){
    const requestedPage=location.href;
    if(!follower.verified||!follower.canWrite()||contextBlocked)await follower.check();
    if(location.href!==requestedPage||!follower.canWrite()||contextBlocked)throw Object.assign(Error('当前 Codex 项目已变化或尚未确认，草稿已保留，请等待面板匹配。'),{notApplied:true});
  }
  const background=state.service?.backgroundChecksSupported===true;
  if(route==='refresh'&&background)data={...data,background:true};
  const queueing=background&&(['tasks/execute','tasks/send-current','automation/start'].includes(route)||(route==='automation/control'&&data.action==='resume')||(route==='tasks/retry-review'&&state.jobs.find(job=>job.id===data.jobId)?.status!=='uncertain'));
  if(!Object.hasOwn(state,'propertyGroups')&&(/^(properties\/|attachments\/|tasks\/(create|update|priority)$)/.test(route)))throw new Error('面板服务尚未加载新版功能，请重启面板服务后刷新页面');
  const verifying=!queueing&&!(route==='refresh'&&background)&&state.service?.catalogHealthSupported&&(['tasks/execute','tasks/retry-review','automation/start','workflow/initialize','threads/create','jobs','refresh'].includes(route)||(route==='automation/control'&&data.action==='resume'));
  if(verifying){$("connection").dataset.catalog="checking";verificationPending++;$('connection').textContent='正在核对任务状态';render();}
  try{const r=await fetch('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Panel-Token':state.token,...(canFollowProject&&route!=='refresh'&&(followsProject()||route==='tasks/send-current'||route==='composer/send'||route==='composer/submit')&&state.service?.desktopContextSupported?{'X-Panel-Page':location.href,'X-Panel-Context-Required':String(follower.matched)}:{})},body:JSON.stringify(data)});const v=await r.json();if(v.catalogHealth)state.service.catalogHealth=v.catalogHealth;if(!r.ok)throw Object.assign(responseError({...v,error:(v.code==='CATALOG_UNVERIFIED'&&state.service?.catalogRecoverySupported?(v.notApplied===true?'本次未发送，草稿已保留。任务状态同步后可再次执行。':'原安排已保留。请查看原任务状态，避免重复操作。'):(v.error||'操作未成功')+(v.code==='CATALOG_UNVERIFIED'&&v.notApplied===true?'；本次未发送，可稍后重新核验':''))}),{notApplied:v.notApplied===true,notSent:v.notSent===true||(v.notApplied===true&&(v.code==="CATALOG_UNVERIFIED"||route==="tasks/send-current")),code:v.code});return v;}finally{if(verifying){verificationPending--;$("connection").dataset.catalog=state.service?.catalogHealth?.recovering?"recovering":state.service?.catalogHealth?.activities??"";const view=catalogConnectionView(state);$('connection').textContent=view.text;render();}}
}
function request(key,signature){const old=drafts[key];if(!old||old.signature!==signature){drafts[key]={id:crypto.randomUUID(),signature};saveStore(draftKey(),drafts);}return drafts[key].id;}
function executionReason(target,{manualPaused=false}={}){const p=getProject(),id=state.bindings[projectId],t=state.threads.find(t=>t.id===id);if(!connected&&!state.service?.backgroundChecksSupported)return state.service?.catalogRecoverySupported?'连接正在自动恢复，恢复后可执行':'连接已断开，请刷新连接后执行';if(verificationPending&&!state.service?.backgroundChecksSupported)return '正在检查连接，请稍候';const catalogBlock=catalogExecutionBlock(state);if(catalogBlock)return catalogBlock;if(state.sync?.running)return '待办正在同步，请稍后执行';const identity=state.workspace?.projects?.find(p=>p.projectId===projectId)?.reason;if(identity)return identity;if(['waiting','ready'].includes(state.service?.maintenance?.status))return '面板等待安全更新';if(manualPaused)return '';if(target?.execution||target?.sectionId)return target?.execution?.mode==='match'&&!target.sectionId&&!target.execution.unit?'请先选择所属版块，同版块共用一个对话':'';if(!id)return '请先在上方选择并保存执行对话';if(!t||!p||t.kind!=='codex'||t.hostId!=='local'||norm(t.cwd)!==norm(p.path))return '已保存的对话不属于当前本机项目，请重新绑定';return '';}
function currentJob(t){return state.jobs.find(j=>j.id===t.currentJobId&&j.taskId===t.id);}
function plainQueuedJob(t){const j=currentJob(t);return t.status==='running'&&j?.status==='queued'?j:null;}
function openCard(id){const t=task(id);if(editableTask(t,state))return openEditor(id);return showDetail(id);}
function projectChanged(renderNow=true){taskGroupsUI?.close();for(const id of ['editor','detail','propertyManager','recognitionDialog','historyDialog','pendingDialog','autoPlanDialog','planImportDialog','sectionEditor'])$(id).close();detailId='';editId='';bindingDirty=false;boardKey=catalogKey=detailKey='';drafts=readStore(draftKey(),{});selectedLane=lanes.some(l=>l[0]===drafts.selectedLane)?drafts.selectedLane:'todo';$('reviewNote').value='';$('importId').value='';$('board').scrollLeft=0;if(renderNow)render();}
function renderCatalog(){const p=getProject();$('setup').hidden=locked;$('projectView').hidden=!p;
  if(!locked){const key=JSON.stringify(state.projects);if($('projectSelect').dataset.key!==key){$('projectSelect').innerHTML='<option value="">选择项目…</option>'+state.projects.map(p=>`<option value="${esc(p.projectId)}">${esc(p.label)}</option>`).join('');$('projectSelect').dataset.key=key;}$('projectSelect').value=projectId;}
  if(!p){if(locked){notice(state.connectionError?(state.service?.catalogRecoverySupported?'连接正在自动恢复，已保存的项目和任务会保留。':'桌面连接暂不可用：'+state.connectionError+' 已保存的项目配置仍保留，连接恢复后会重新读取。'):state.lastSync?'此项目不存在或尚未读取成功，请刷新连接；不会显示其他项目的数据。':'正在连接桌面并读取本机项目，已保存配置会保留。',!!state.connectionError||!!state.lastSync);$('notice').dataset.catalogNotice='true';}return;}if($('notice').dataset.catalogNotice){notice('');delete $('notice').dataset.catalogNotice;}
  $('projectTitle').textContent=p.label;$('projectPath').textContent=p.path;$('context').textContent=locked?'CODEX / 当前项目':'项目预览 / 首次挂载设置';
  const threads=state.threads.filter(t=>t.kind==='codex'&&t.hostId==='local'&&norm(t.cwd)===norm(p.path)),bound=state.bindings[projectId],qThread=threads.find(t=>t.id===query.get('threadId')),key=JSON.stringify([threads,bound]);
  if(catalogKey!==key){const previous=$('binding').value;$('binding').innerHTML='<option value="">选择执行对话…</option>'+threads.map(t=>`<option value="${esc(t.id)}">${esc(t.title)}${t.modelSource==='unknown'||!t.modelLabel?' · 模型未确认':' · '+esc(t.modelLabel)}${t.titleIssue?' · 命名待修正':''}${t.id===qThread?.id?' · 当前对话':''}</option>`).join('');$('binding').value=bindingDirty&&(previous===''||threads.some(t=>t.id===previous))?previous:(bound??'');catalogKey=key;}
  const boundThread=threads.find(t=>t.id===bound),indexIssue=state.modelIndex&&state.modelIndex.available===false?'本机对话索引不可读：模型只按标题后缀识别。'+String(state.modelIndex.error||''):'';
  $('bindingSummary').textContent=bound?`已绑定：${boundThread?.title??'对话不可用'} · ${boundThread?.modelLabel??'模型未确认'}`:'自动分配，无需设置';
  $('renameThread').hidden=!(boundThread&&(boundThread.titleIssue||boundThread.modelSource==='unknown'));
  $('bindingHint').textContent=['仅用于未指定版块或执行安排的旧任务。',boundThread?.modelSource==='unknown'?'此对话模型未确认：先让该对话运行一轮，或在标题补模型后缀。':boundThread?.titleIssue?'命名待修正：'+boundThread.titleIssue+'；可点击“按规范重命名”。':'',indexIssue].filter(Boolean).join(' ');
  $('saveBinding').disabled=!connected||pending.has('bind')||(!bindingDirty&&$('binding').value===(bound??''));
  const nameIssues=threads.filter(t=>t.titleIssue).length;
  $('threadNameCount').textContent=nameIssues?`（${nameIssues} 项待修正）`:'（已检查）';
  const names=threads.length?threads.map(t=>{
    const model=t.modelSource==='unknown'?'模型未确认':`${t.modelLabel||'模型未确认'}${t.modelSource==='title'?' · 按标题识别':''}`;
    const status=t.titleIssue||'名称已规范';
    return `<div class="thread-name-row"><div class="thread-name-text"><strong>${esc(t.title||'未命名对话')}</strong><span>${esc(model)} · ${esc(status)}</span></div>${t.titleIssue&&t.modelKey?`<button type="button" data-rename-thread="${esc(t.id)}" ${!connected||pending.has('rename')?'disabled':''}>按规范重命名</button>`:''}</div>`;
  }).join(''):'<p class="hint">当前项目没有可用的本机对话。</p>';
  const namesKey=JSON.stringify([threads.map(t=>[t.id,t.title,t.modelLabel,t.modelSource,t.modelKey,t.titleIssue]),connected,pending.has('rename')]);
  if($('threadNameList').dataset.key!==namesKey){$('threadNameList').innerHTML=names;$('threadNameList').dataset.key=namesKey;}
}
function emptyState(id,filtered){
  const copy={todo:['暂无待执行任务','点击右上角的 ＋ 添加任务'],running:['暂无执行中的任务','开始执行后，这里会显示进度'],review:['暂无待审阅结果','本轮结束后，在这里核对结果'],done:['暂无已完成任务','审阅通过或已接续完成的任务保留在这里']};
  const icons={todo:'<path d="M4 14 7 5h10l3 9v5H4z"/><path d="M4 14h5l1 3h4l1-3h5"/>',running:'<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',review:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6m-6 4h6m-6 4h3"/>',done:'<circle cx="12" cy="12" r="8"/><path d="m8 12 3 3 5-6"/>'};
  const [title,hint]=filtered?['没有匹配的任务','调整筛选条件试试']:copy[id];
  const icon=filtered?'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>':icons[id];
  return '<div class="board-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icon+'</svg><div><p class="empty-title">'+title+'</p><p class="empty-hint">'+hint+'</p></div></div>';
}
function cardProperties(t){
  const attrs=t.attributes;if(!attrs||attrs.length<2)return propertyBadges(t);
  const primary=attrs.find(a=>a.groupId==='type')??attrs[0],rest=attrs.filter(a=>a!==primary);
  return propertyBadges({...t,attributes:[primary]})+'<span class="card-property-more" title="'+esc(rest.map(a=>a.groupName+'：'+a.name).join('；'))+'">+'+rest.length+'</span>';
}
function conciseCardHint(text){return text.replace('请先在上方选择并保存执行对话','未绑定对话').replace('请先核对并绑定当前项目的逻辑名称和本机目录','项目待绑定').replace('等待前置任务审阅通过','等待前置审阅').replace('等待前置任务本轮正常结束','等待前置结束').replace('先确认方案，再执行','待确认方案').replace('等待执行空位或同项目顺序任务','等待执行空位').replace(/ · (自动匹配，未匹配则新建|模块专用对话|指定对话)$/,'');}
function card(t,dependencies=''){
  const lane=taskLane(t,state),scheduled=lane==='running'&&t.status==='todo'?scheduledTaskState(t,state):null;
  const manualPaused=scheduled?.canManual===true,accepting=state.service?.manualTaskAcceptanceSupported===true,actionOptions={blocked:accepting?'':executionReason(t,{manualPaused})||chainBlock(t),pending:pending.has(t.id)};
  const job=currentJob(t),reason=scheduledMessage(t)||actionOptions.blocked,warning=!scheduled&&['uncertain','failed','interrupted'].includes(job?.status);
  const displayStatus=t.initialDispatch?(t.initialDispatch.phase==='creating'?'正在提交':'提交待核对'):scheduled?scheduled.label:t.historyOnly?'历史归档':job?.awaitingUser?'等待你的回复':warning?({uncertain:'发送未确认',failed:'执行失败',interrupted:'执行中断'})[job.status]:lane==='todo'&&['discussion','confirmation'].includes(t.workflowStage)?(t.workflowStage==='discussion'?'方案讨论':'待确认'):lane==='running'?({queued:'排队中',sending:'提交中',submitted:'等待回复',running:'执行中'})[job?.status]??'执行中':lanes.find(l=>l[0]===lane)?.[1]??lane;
  const rawSummary=['review','done'].includes(lane)&&job?.result?job.result:t.sourceKind==='conversation'?(t.summary??'原始需求与对话来源已记录'):t.description??'';
  const summary=rawSummary.trim()===t.title.trim()?'':rawSummary.replace(/\s+/g,' ').trim().slice(0,160);
  const hint=warning?displayStatus:lane==='todo'?reason:'';
  const executeAction=scheduledAction(t,actionOptions)||`<button class="primary" data-action="execute" data-id="${esc(t.id)}" ${(!accepting&&reason)||pending.has(t.id)?'disabled':''}>${pending.has(t.id)?'提交中…':'执行'}</button>`;
  const recovery=executionRecovery?.cardParts(t)??{message:'',actions:'',actionKinds:[]};
  const planManage=lane==='running'&&!recovery.actionKinds.includes('plan')?executionManagement(t):'';
  const queuedActions=lane==='running'&&!scheduled&&!planManage&&job?.status==='queued'?`<button data-action="return-queued" data-id="${esc(t.id)}" ${pending.has(t.id)||(!connected&&!state.service?.backgroundChecksSupported)?'disabled':''} title="取消排队并回到待执行，未发送">回退</button>${recovery.actionKinds.includes('edit')?'':`<button data-action="edit" data-id="${esc(t.id)}" ${pending.has(t.id)?'disabled':''}>修改</button>`}`:'';
  const todoActions=lane!=='todo'?'':t.syncReserved?`<button data-release-sync="${esc(t.id)}">核对同步领取</button>`:`<button data-archive="${esc(t.id)}" title="移出待执行，保留记录">移除</button>`;
  const cardHint=t.boardSyncReplica?'查看同步卡片':editableTask(t,state)?'编辑任务内容':'查看任务结果与详情';
  const management=lane==='running'?(scheduled&&(!accepting||scheduled.status==='paused'&&scheduled.canManual)?scheduledAction(t,actionOptions):'')+planManage:'';
  const move=taskGroupsUI&&(state.taskGroups?.some(group=>group.projectId===t.projectId)||t.boardGroupId)?`<button type="button" class="card-move-group" draggable="true" data-move-task="${esc(t.id)}" aria-label="移动任务分组：${esc(t.title)}" title="拖到其他分组，或点击选择分组" ${canChangeTaskGroups()?'':'disabled'}>⇄</button>`:'';
  return `<article class="task-card" tabindex="0" aria-label="${cardHint}：${esc(t.title)} · ${esc(displayStatus)}" data-task="${esc(t.id)}" data-selected="${isSelected(t.id)}" data-status="${esc(lane)}" data-job-status="${esc(job?.status??'')}">
    ${lane==='running'?`<div class="card-progress">${taskGroupsUI?'':`<span class="card-section-label">${esc(taskSection(state,t)?.name??'未分版块')}</span>`}<span class="card-status-label">${esc(displayStatus)}</span></div>`:''}<div class="card-heading">${lane==='todo'?selectionControl(t):''}<h3 class="task-title" title="${esc(t.title)}">${esc(t.title)}</h3><div class="card-badges">${priorityControl(t,pending.has(t.id)||t.boardSyncReplica)}${cardProperties(t)}</div></div>${summary?`<p class="card-description" title="${esc(cardHint==='编辑任务内容'?'点击卡片编辑任务内容':'点击卡片查看完整需求与结果')}">${esc(summary)}</p>`:''}
    ${scheduled?`<p class="card-message" title="${esc(scheduled.diagnosticReason||scheduled.waitReason)}">${esc(scheduled.waitReason)}</p>`:recovery.message}${dependencies}<div class="card-footer"><div class="card-meta">${t.historyOnly?'<span class="card-archive-label">历史归档</span>':''}${t.shortId?`<span class="card-short-id" title="任务编号">${esc(t.shortId)}</span>`:''}<time class="card-time" datetime="${esc(t.createdAt)}" title="创建于 ${time(t.createdAt)}">${time(t.createdAt,true)}</time>${hint&&!scheduled?`<span class="card-route-hint" title="${esc(hint+(job?.error?' · '+job.error:''))}">${esc(conciseCardHint(hint))}</span>`:''}</div>
    <div class="card-actions">${t.boardSyncReplica?'':`${executionRecovery&&!accepting?`<button type="button" data-recovery-task="${esc(t.id)}" aria-label="检查任务执行条件">检查执行</button>`:''}${lane==='todo'?`${todoActions}${executeAction}`:`${queuedActions}${lane==='review'&&!recovery.actionKinds.includes('review')?`<button class="review-action" data-action="detail" data-id="${esc(t.id)}" aria-label="查看并审阅">审阅</button>`:''}`}${recovery.actions}${management}`}${move}</div></div></article>`;
}
function canChangeTaskGroups(){return state.service?.taskGroupsSupported===true&&pageDataReady&&!state._snapshot&&!!getProject();}
function renderBoard(){
  if(taskGroupsUI?.isDragging())return;
  const canGroup=canChangeTaskGroups();
  const allTasks=state.tasks.filter(t=>t.projectId===projectId&&!t.archivedAt&&!t._reference),tasks=filterTasks(allTasks),key=JSON.stringify([allTasks,state.query,state.taskSections,state.taskGroups,canGroup,allTasks.length,selectionKey(),filterKey(),state.jobs.filter(j=>j.taskId&&tasks.some(t=>t.id===j.taskId)),executionReason(),executionRecovery?.key(),state.bindings[projectId],state.threads.find(t=>t.id===state.bindings[projectId])?.title,state.legacyJobs??state.jobs.filter(j=>!j.taskId),[...pending]]);if(key===boardKey)return;boardKey=key;
  const active=document.activeElement,focus=active?.closest('[data-task]')?{id:active.dataset.id??active.closest('[data-task]').dataset.task,action:active.dataset.action,priority:active.hasAttribute('data-priority'),selection:active.hasAttribute('data-select-task'),move:active.hasAttribute('data-move-task')}:null;
  const groupFocus=active?.matches('[data-group-drop]')?active.parentElement.dataset.sectionGroup:undefined;
  const groupAddFocus=active?.hasAttribute('data-add-task-group');
  const taskAddFocus=active?.matches('[data-group-create-task]')?active.closest('.board-task-group').dataset.sectionGroup:undefined;
  $('total').textContent=state.query?`已加载 ${tasks.length} / ${state.query.projectTotal} 项任务 · ${state.query.counts.done??0} 项完成`:`${tasks.length} / ${allTasks.length} 项任务 · ${tasks.filter(t=>t.status==='done').length} 项完成`;
  if(!$('laneNav').children.length)$('laneNav').innerHTML=lanes.map(([id,label])=>`<button id="tab-${id}" data-lane="${id}"><span>${label}</span><span class="tab-count">0</span></button>`).join('');
  for(const [id] of lanes)$('tab-'+id).querySelector('.tab-count').textContent=state.query?.counts[id]??tasks.filter(t=>taskLane(t,state)===id).length;
  const groupState=new Map([...$('board').querySelectorAll('.task-section-group')].map(el=>[el.dataset.sectionGroup,{open:el.open,hasTasks:Number(el.dataset.groupCount)>0}]));
  const dependencyState=new Set([...$('board').querySelectorAll('[data-dependency-task][open]')].map(el=>el.dataset.dependencyTask));
  const dependencyFocus=active?.closest('[data-dependency-task]'),dependencyFocusId=dependencyFocus?.dataset.dependencyTask,dependencyTarget=active?.closest('[data-dependency-target]')?.dataset.dependencyTarget;
  const pendingSources=$('pendingSources');pendingSources.remove();
  $('board').innerHTML=lanes.map(([id,label,description])=>{
    const items=tasks.filter(t=>taskLane(t,state)===id).sort(sortTasks),empty=emptyState(id,tasks.length!==allTasks.length);
    const groupRenderer=taskGroupsUI?renderList=>renderBoardGroups(state,projectId,id,items,renderList,{empty,canChange:canGroup}):undefined;
    const groups=renderTaskGroups(state,items,id,card,groupRenderer)||empty;
    const add=id==='todo'&&taskGroupsUI?`<button type="button" class="board-add-button" data-add-task-group aria-haspopup="dialog" ${canGroup?'':'disabled'}>＋ 添加分组</button>`:'';
    return `<section id="lane-${id}" class="lane lane-${id}" aria-labelledby="heading-${id}"><div class="lane-head"><span class="dot" aria-hidden="true"></span><h2 id="heading-${id}">${label}</h2><span class="count">${state.query?.counts[id]??items.length}</span></div><p class="lane-description">${description}</p>${id==='done'&&!taskGroupsUI?renderRecentCompleted(items,card):''}${groups}${state.query?.pages[id]?.cursor?`<button data-more-lane="${id}">加载更多${label}</button>`:''}${add}</section>`;
  }).join('');
  $('board').querySelectorAll('.task-section-group').forEach(el=>{const previous=groupState.get(el.dataset.sectionGroup);if(previous&&previous.hasTasks===(Number(el.dataset.groupCount)>0))el.open=previous.open;});
  $('board').querySelectorAll('[data-dependency-task]').forEach(el=>{el.open=dependencyState.has(el.dataset.dependencyTask);});
  $('lane-review').querySelector('.lane-description').after(pendingSources);
  updateLaneView();
  if(focus){const button=focus.move?[...$('board').querySelectorAll('[data-move-task]')].find(b=>b.dataset.moveTask===focus.id):focus.selection?[...$('board').querySelectorAll('[data-select-task]')].find(b=>b.dataset.selectTask===focus.id):focus.priority?[...$('board').querySelectorAll('[data-priority]')].find(b=>b.dataset.priority===focus.id):[...$('board').querySelectorAll('button')].find(b=>b.dataset.id===focus.id&&b.dataset.action===focus.action);(button&&!button.disabled&&!button.closest('[hidden]')?button:$(compactView.matches?'tab-'+selectedLane:'lane-'+selectedLane))?.focus({preventScroll:true});}
  if(groupFocus||taskAddFocus)[...$('board').querySelectorAll('.board-task-group')].find(el=>el.dataset.sectionGroup===(groupFocus??taskAddFocus))?.querySelector(taskAddFocus?'[data-group-create-task]':'summary')?.focus({preventScroll:true});
  if(groupAddFocus)$('board').querySelector('[data-add-task-group]')?.focus({preventScroll:true});
  if(dependencyFocusId){const details=[...$('board').querySelectorAll('[data-dependency-task]')].find(el=>el.dataset.dependencyTask===dependencyFocusId);if(details&&!details.closest('[hidden]'))([...details.querySelectorAll('[data-dependency-target]')].find(el=>el.dataset.dependencyTarget===dependencyTarget)??details.querySelector('summary'))?.focus({preventScroll:true});}
  const legacy=(state.legacyJobs??state.jobs.filter(j=>!j.taskId)).filter(j=>j.projectId===projectId||(!j.projectId&&norm(j.path)===norm(getProject()?.path)));
  $('legacyCount').textContent=`（${state.query?.legacy?.total??legacy.length}）`;$('legacy').hidden=!legacy.length;
  const legacyKey=JSON.stringify([legacy,state.query?.legacy?.cursor]);if($('legacyList').dataset.key!==legacyKey){const open=new Set([...$('legacyList').querySelectorAll('details[open]')].map(el=>el.dataset.record));$('legacyList').innerHTML=legacy.map(j=>`<article><h3>${esc(j.title||j.project)}</h3><p class="hint">${time(j.createdAt)} · ${esc(statuses[j.status]??j.status)}</p>${jobRecord(j,open.has(j.id))}</article>`).join('')||'<p class="hint">暂无旧记录</p>';if(state.query?.legacy?.cursor)$('legacyList').insertAdjacentHTML('beforeend','<button data-more-legacy="true">加载更多旧记录</button>');$('legacyList').dataset.key=legacyKey;}
}
function jobRecord(j,open=false,index){return `<details class="record" data-record="${esc(j.id)}" ${open?'open':''}><summary>${index!==undefined?`第 ${index+1} 轮 · `:''}${esc(statuses[j.status]??j.status)} · ${time(j.createdAt)}</summary><p class="hint">目标对话：${esc(j.title||j.threadId)} · ${esc(j.threadId)}</p><h3>本轮指令</h3><pre>${esc(j.prompt)}</pre><h3>本轮回复</h3><pre>${esc(j.result||'尚未收到本轮回复')}</pre>${j.error?`<p class="error">${esc(j.error)}</p>`:''}${j.message?`<p class="hint">${esc(j.message)}</p>`:''}<button data-open="${esc(j.threadId)}">打开原对话 ↗</button>${!j.taskId&&j.status==='uncertain'?`<button data-resolve-legacy="${esc(j.id)}">核对并释放旧记录</button>`:''}${j.status==='queued'?`<button data-cancel="${esc(j.id)}">取消本轮排队</button>`:''}</details>`;}
function sectionRounds(t){
  if(reader){const history=state.query?.history,records=history?._taskId===t.id?history.items:[];const job=currentJob(t),jobs=job&&!records.some(j=>j.id===job.id)?[...records,job]:records;return jobs.map(job=>({job,owner:state.tasks.find(row=>row.id===job.taskId)??t})).sort((a,b)=>(a.job._roundIndex??0)-(b.job._roundIndex??0));}
  const owners=new Map(state.tasks.filter(row=>row.projectId===t.projectId&&(t.sectionId?row.sectionId===t.sectionId:row.id===t.id)).map(row=>[row.id,row]));
  return groupRounds(state.jobs.filter(job=>owners.has(job.taskId))).map(r=>({job:{...r.job,_stepCount:r.steps.length},owner:owners.get(r.job.taskId)}));
}
function roundMarkup({job,owner},index,open){
  index=job._roundIndex??index;
  const reviews=(owner.history??[]).filter(event=>event.jobId===job.id&&['approved','returned'].includes(event.type));
  if(owner.reviewReceipt?.jobId===job.id&&!reviews.some(event=>event.id===owner.reviewReceipt.id))reviews.push(owner.reviewReceipt);
  const approval=reviews.findLast(event=>event.type==='approved'),approved=!!approval||(owner.status==='done'&&owner.currentJobId===job.id);
  const label=job.origin==='archive'?'历史归档':approval?.mode==='manual'?'人工验收通过':approved?'已审阅':job.awaitingUser?'等待你的回复':job.status==='completed'?'待审阅':job.status==='running'?'执行中':statuses[job.status]??job.status;
  return `<details class="detail-round" data-record="${esc(job.id)}" ${open?'open':''}><summary><span><strong>第 ${index+1} 轮 · ${esc(owner.title)}</strong><small>${time(job.finishedAt??job.createdAt)}</small></span><span class="round-state">${esc(label)}</span></summary><div class="round-content">${job.modelMismatch?'<p class="hint">'+esc(job.modelMismatch)+'</p>':''}<h4>${job.origin==='archive'?'原始需求':'本轮修改'}</h4><p>${esc(readableSourceText(job.prompt)||'未记录本轮说明')}</p><h4>${job.origin==='archive'?'原对话处理结果':'执行结果'}</h4>${job.origin==='archive'?'<p class="hint">仅归档历史，未发送执行指令。</p>':''}<pre class="result-text">${esc(job.result||'本轮结果尚未回收。')}</pre>${job.error?'<p class="error">'+esc(job.error)+'</p>':''}${(job._stepCount??1)>1?'<button type="button" data-round-steps="'+esc(roundIdOf(job))+'" data-round-owner="'+esc(owner.id)+'">查看本轮问答（'+job._stepCount+' 条）</button><div class="round-steps"></div>':''}${attachmentList(job.attachments??[])}${reviews.map(event=>'<p class="round-review"><strong>'+(event.type==='approved'?(event.mode==='manual'?'人工验收通过 · 原执行状态：'+esc(statuses[event.originalStatus]??event.originalStatus):'已审阅'):'修改反馈')+'</strong>'+ (event.note?' · '+esc(event.note):'')+'</p>').join('')}</div></details>`;
}
function renderDetail(){
  if(!$('detail').open)return;const t=task(detailId);if(!t||(t.archivedAt&&!detailReadOnly)){$('detail').close();return;}
  const records=sectionRounds(t),section=taskSection(state,t),groupName=taskGroupPath?.(state,t.projectId,t.boardGroupId),key=JSON.stringify([t,records.map(({job,owner})=>[job,owner.title,owner.status,owner.currentJobId,owner.history]),section,groupName]);
  if(detailKey!==key){
    const active=document.activeElement,focusRecord=active?.closest('[data-record]')?.dataset.record,wasSummary=active?.matches('summary');
    const previous=[...$('detailExtras').querySelectorAll('[data-record]')],seen=new Set(detailKey?previous.map(el=>el.dataset.record):[]),open=new Set(detailKey?previous.filter(el=>el.open).map(el=>el.dataset.record):[]);
    const descriptionOpen=!detailKey||$('taskDescriptionPanel')?.open,othersOpen=!!detailKey&&$('otherRounds')?.open;
    const indexed=records.map((row,index)=>({row,index})),current=indexed.find(({row})=>row.job.id===t.currentJobId),other=indexed.filter(item=>item!==current).reverse();
    const resultFirst=['review','done'].includes(t.status);
    const recordHtml=({row,index})=>roundMarkup(row,index,open.has(row.job.id)||(!resultFirst&&!seen.has(row.job.id)&&row.job.id===t.currentJobId));
    $('detailTitle').textContent=t.title;
    const membership=taskGroupsUI?`<section class="detail-section-membership"><h3>所属分组</h3><strong>${esc(groupName)}</strong>${section?`<button type="button" data-section-edit="${esc(section.id)}" title="${esc(section.name)}">执行版块设置</button>`:''}</section>`:`<section class="detail-section-membership"><h3>所属版块</h3><strong>${esc(section?.name||'未分版块')}</strong></section>`;
    const description=`<details id="taskDescriptionPanel" class="task-background" ${descriptionOpen?'open':''}><summary>任务说明与附件</summary><p class="detail-description">${t.boardSyncPrivateDescription?'原聊天说明保存在来源电脑。':esc(readableSourceText(t.description)||'未填写任务说明')}</p>${attachmentList(t.attachments??[])}<div id="detailSourceImages"></div></details>`;
    if(t.boardSyncReplica){
      $('detailContent').innerHTML=`<p class="hint">来自其他电脑。请在原执行电脑审阅，回复和执行记录保存在原电脑。</p>`+membership+description;
      $('detailExtras').replaceChildren();$('reviewActions').hidden=true;$('reviewSection').hidden=true;$('reviewBlockReason').hidden=true;$('deleteTask').hidden=true;
      detailKey=key;hydrateImages();return;
    }
    const returned=t.status==='todo'&&!t.currentJobId?(t.returnedResult??state.jobs.find(j=>j.taskId===t.id&&j.id===t.history?.findLast(e=>e.type==='returned')?.jobId)):null;
    const result=currentJob(t)??returned,completion=t.completionReceipt??t.history?.findLast(e=>e.type==='delivery-reconciled'),completionText=completion?'跨电脑完成接续\n提交：'+completion.commit+'\n依据：'+completion.evidencePath+' · '+completion.taskCode+'\n'+completion.note:'';
    const modelWarning=result&&result.modelMismatch?'<p class="hint">'+esc(result.modelMismatch)+'</p>':'';const currentResult=`<section class="detail-current-result"><h3>本次任务处理结果</h3>${result?'<p class="hint">'+esc(time(result.finishedAt??result.createdAt))+'</p>':''}${modelWarning}<pre class="result-text">${esc(result?.result||completionText||'尚未记录本次任务的处理结果，可在下方版块记录中核对。')}</pre>${result?.error?'<p class="error">'+esc(result.error)+'</p>':''}</section>`;
    $('detailContent').innerHTML=(detailReadOnly?'<p class="hint">已归档 · 仅查看任务说明与已有记录</p>':'')+(resultFirst?membership+description+currentResult:description+membership+(returned?'<section><h3>退回修改意见</h3><p class="detail-description">'+esc(t.reviewNote||'')+'</p></section>'+currentResult.replace('本次任务处理结果','退回轮次执行结果'):''));
    $('detailContent').insertAdjacentHTML('beforeend',handoffMarkup(t,state.service,detailReadOnly,state.threads));
    $('detailExtras').innerHTML=`<section class="detail-rounds"><h3>版块修改轮次记录 <span>${t.roundCount??records.length}</span></h3>${records.length?(current?recordHtml(current):'')+(other.length?'<details id="otherRounds" class="other-rounds" '+(othersOpen?'open':'')+'><summary>其他轮次 · '+other.length+'</summary>'+other.map(recordHtml).join('')+'</details>':''):'<p class="hint">暂未关联执行轮次。</p>'}</section>`;
    if(reader&&(t.roundCount??0)>1){const button=document.createElement("button");button.type="button";button.dataset.loadHistory="true";button.textContent=state.query?.history?"加载更多轮次":"查看版块历史轮次";button.hidden=!!state.query?.history&&!state.query.history.cursor;$("detailExtras").append(button);}
    detailKey=key;hydrateImages();void showTaskSourceImages($('detailSourceImages'),t);
    if(focusRecord&&wasSummary)[...$('detailExtras').querySelectorAll('[data-record]')].find(el=>el.dataset.record===focusRecord)?.querySelector('summary').focus({preventScroll:true});
  }
  if(t.boardSyncReplica)return;
  const job=currentJob(t),uncertain=job?.status==='uncertain',busy=pending.has(t.id)||detailReadOnly,feedback=!!$('reviewNote').value.trim();
  if(reviewRecovery.jobId&&reviewRecovery.jobId!==job?.id){manualReviewMode=false;$('resolveConfirm').checked=false;reviewRecovery={};void inspectReview();}
  const abnormal=!!job&&!job.awaitingUser&&(['failed','interrupted','released','uncertain'].includes(job.status)||(job.status==='completed'&&!job.turnId)),reason=reviewBlockReason(t,job);
  if(manualReviewMode&&!abnormal){manualReviewMode=false;$('resolveConfirm').checked=false;}
  const recovery=reviewRecovery.id===t.id&&reviewRecovery.jobId===job?.id?reviewRecovery:{};
  $('reviewBlockReason').hidden=true;
  $('reviewBlockReason').textContent=reason;
  $('manualReview').parentElement.hidden=true;
  $('manualReview').disabled=busy||!connected||!!chainBlock(t,true);
  $('restoreReviewThread').hidden=!recovery.archived;
  $('restoreReviewThread').disabled=busy||!connected||recovery.loading;
  $('checkReviewState').disabled=busy||!connected||recovery.loading;
  $('reviewRecoveryHint').hidden=true;
  $('reviewRecoveryHint').textContent=recovery.loading?'正在核对原对话状态…':recovery.error|| (recovery.archived?'原对话已归档。请先恢复，再打开原对话核对；不会自动发送。':recovery.idle?'已确认原对话空闲；人工通过仍需填写验收依据并勾选确认。':'尚未确认原对话空闲，请定位原聊天后重新核对。');
  $('reviewActions').hidden=t.status!=='review'||detailReadOnly;
  $('openReviewChat').disabled=busy||!connected||!job?.threadId||pending.has('open-review:'+t.id);
  $('openReviewChat').title=job?.threadId?'打开本轮执行所在的原对话':'本轮尚未关联聊天';
  $('reviewSection').hidden=t.status!=='review'||!reviewFeedbackOpen||detailReadOnly;
  const handoffActive=!!t.handoff&&!['submitted','complete','cancelled'].includes(t.handoff.phase);
  $('approveTask').disabled=busy||handoffActive;
  $('approveTask').textContent='通过';
  $('approveTask').title='按你的人工验收归入已完成，保留原执行记录';
  $('deleteTask').hidden=detailReadOnly;
  $('deleteTask').disabled=busy||handoffActive||!['todo','review','done'].includes(t.status)||state.jobs.some(j=>j.taskId===t.id&&['queued','sending','submitted','running'].includes(j.status));
  $('retryReview').disabled=busy||handoffActive||(reviewFeedbackOpen&&(!connected||(uncertain&&!$('resolveConfirm').checked)));
  $('returnReview').disabled=busy||handoffActive||(reviewFeedbackOpen&&uncertain&&(!connected||!$('resolveConfirm').checked));
  $('returnReview').textContent='稍后处理';
  $('returnReview').title=uncertain?'核对原对话后退回待执行，不会重新发送':'保留本轮结果与反馈，稍后接续原对话';
  $('reviewNote').disabled=$('resolveConfirm').disabled=busy;
  document.querySelector('label[for="reviewNote"]').textContent=manualReviewMode?'验收依据':uncertain?'核对说明':'处理反馈';
  $('reviewNote').placeholder=manualReviewMode?'写明成果已完成的核对依据，例如验证结果或实际使用结论；不会重新发送任务。':uncertain?'写下原对话是否已结束、为什么退回。核对并退回不会重新发送。':'填写本次回答或处理意见；立即处理会发送，稍后处理只保存…';
  $('resolveLabel').hidden=!uncertain&&!manualReviewMode;
  $('resolveText').textContent=manualReviewMode?'已核对成果完成，且不会再产生本轮执行':'已核对原对话，确认不会再产生本轮执行';
  $('approveTask').classList.toggle('primary',!reviewFeedbackOpen||!feedback);$('retryReview').classList.toggle('primary',!uncertain&&reviewFeedbackOpen&&feedback);$('returnReview').classList.toggle('primary',uncertain&&reviewFeedbackOpen);
  $('retryReview').textContent=busy?'提交中…':'立即处理';
  $('retryReview').setAttribute('aria-expanded',String(!$('reviewSection').hidden));
  $('retryReview').setAttribute('aria-controls','reviewSection');
  $('returnReview').setAttribute('aria-expanded',String(!$('reviewSection').hidden));
  $('reviewHint').textContent=manualReviewMode?'人工通过会记录验收依据，保留原失败、中断或未决记录，不发送任务。':uncertain?'请先填写核对说明并勾选确认。稍后处理只保存；立即处理接续原对话，不自动重发。':chainBlock(t,true)||((job?.status==='completed'&&job?.turnId)?job?.awaitingUser?'等待你的回复；本轮尚未通过，回答后继续记录在本轮。':'通过前都属于当前轮次；立即处理发送本次反馈，空反馈则继续当前任务。':'本轮未正常结束，可填写反馈后重新执行。');
}
function renderMount(){
  const boards=state.boards??{mode:'off',projectIds:[],attachments:{}},enabled=boards.mode==='all'||boards.projectIds.includes(projectId),records=Object.values(boards.attachments).filter(a=>a.projectId===projectId);
  const content=`<p class="hint">自动打开本项目对话的侧面看板。</p><div class="input-row"><button data-mount="${enabled?'disable':'enable'}" ${!connected||pending.has('mount')?'disabled':''}>${enabled?'停用自动挂载':'启用此项目右侧看板'}</button>${enabled?`<button data-mount="retry" ${!connected||pending.has('mount')?'disabled':''}>重试失败的挂载</button>`:''}</div><p class="hint">${enabled?'已启用。停用只停止新挂载，不关闭已打开的白板。':'尚未启用。'} ${records.filter(a=>a.status==='attached').length} 个挂载请求成功 · ${records.filter(a=>a.status==='queued').length} 个待切到对应对话显示 · ${records.filter(a=>a.status==='attaching').length} 个挂载中</p>${records.filter(a=>a.status==='failed').map(a=>`<p class="error">挂载失败：${esc(state.threads.find(t=>t.id===a.threadId)?.title??a.threadId)} · ${esc(a.error)}</p>`).join('')}${boards.error?`<p class="error">${esc(boards.error)}</p>`:''}`;
  $('mountOptionsSummary').textContent='侧栏 · '+(enabled?'自动挂载已开启':'自动挂载未开启');
  if($('mountSettings').innerHTML!==content)$('mountSettings').innerHTML=content;
  let global=$('globalMount');if(!global){global=document.createElement('div');global.id='globalMount';$('setup').append(global);}
  const globalContent=`<p class="hint">为每个项目自动挂载，之后切换 Codex 对话即可查看对应项目。</p><button data-mount="${boards.mode==='all'?'disable':'enable'}" data-all="true" ${!connected||pending.has('mount')?'disabled':''}>${boards.mode==='all'?'停用所有项目自动挂载':'启用所有项目右侧看板'}</button>`;if(global.innerHTML!==globalContent)global.innerHTML=globalContent;
}
function render(){executionRecovery?.update();updateTaskOrganization(state,projectId);updatePlanUI(state,projectId);updateAutomation(state,projectId);updateLineage(state,projectId,pageMode()==='references');updateProperties(state,projectId);renderCatalog();$('newTask').disabled=!pageDataReady||!Object.hasOwn(state,'propertyGroups');$('projectSelect').disabled=pending.size>0;renderMount();if(getProject()){renderBoard();renderDetail();}renderHub(state,projectId,{projectHref:projectAddress});blockContext(contextBlocked,contextReason);placeIdentityReminder();updateLineage(state,projectId,pageMode()==='references');updateAutomation(state,projectId);updateProjectMenu();alignFrozenBackground();}
let loadingVersion=-1,readGeneration=0,refreshSuspended=true,refreshTimer=null;
function scheduleRefresh(){
  clearTimeout(refreshTimer);refreshTimer=null;
  if(refreshSuspended||document.hidden)return;
  const watchingCurrentThread=state.jobs.some(job=>job.deliveryKind==='current-thread'&&['queued','sending','submitted','running'].includes(job.status));
  refreshTimer=setTimeout(()=>{refreshTimer=null;if(refreshSuspended||document.hidden)return;void load().finally(scheduleRefresh);},watchingCurrentThread?2000:4000);
}
function pauseRefresh(){
  if(refreshSuspended)return;
  refreshSuspended=true;readGeneration++;loadAgain=false;initialReadStatus=null;
  clearTimeout(refreshTimer);refreshTimer=null;follower?.pause();
}
function resumeRefresh(){
  if(document.hidden){initialReadStatus=null;return;}
  if(!refreshSuspended)return;
  refreshSuspended=false;readGeneration++;
  if(followsProject())follower?.resume();void load();scheduleRefresh();
}
const routeKey=()=>JSON.stringify([projectId,pageMode(),pageMode()==='versions'?$('versionSearch')?.value??'':pageFilters(),compactView.matches?selectedLane:'all']);
function rememberRoute(){if(!pageDataReady||state._snapshot)return;if(routeStates.size>=8&&!routeStates.has(routeKey()))routeStates.delete(routeStates.keys().next().value);routeStates.set(routeKey(),state);snapshots.put(routeKey(),state.service?.instanceId,projectId,state);}
function navigateView(address,replace=false,followed=false){
  const next=canFollowProject?automaticAddress(new URL(address,location.href).href):new URL(address,location.href);if(!internalView(next.href,location.href))return false;
  if(canFollowProject&&!next.searchParams.has('panelSession'))next.searchParams.set('panelSession',new URL(activeViewAddress).searchParams.get('panelSession'));
  if(!state.projects.some(p=>p.projectId===next.searchParams.get('projectId'))&&!state.workspace?.mappings?.[next.searchParams.get('projectId')]){notice('此项目尚未读取成功，请稍后重试。',true);return true;}
  if(next.href===activeViewAddress)return true;
  if(pending.size||uploading||$('referenceEditor')?.open||$('referenceTagManager')?.open||$('taskGroupDialog-references')?.open){if(replace)history.pushState({projectHref:projectAddress},'',activeViewAddress);notice('当前操作完成后再切换，草稿已保留。',true);return true;}
  if($('editor').open)persistEditor();saveStore(draftKey(),drafts);rememberRoute();
  if(routeScrolls.size>=8&&!routeScrolls.has(routeKey()))routeScrolls.delete(routeScrolls.keys().next().value);
  routeScrolls.set(routeKey(),{x:scrollX,y:scrollY,board:$('board').scrollLeft,lanes:lanes.map(([id])=>[id,$('lane-'+id)?.scrollTop??0])});
  const wasBlocked=contextBlocked;
  if(!replace&&pageMode()==='project'){
    const boardAddress=new URL(location.href);
    if(projectId)boardAddress.searchParams.set('projectId',projectId);
    projectAddress=boardAddress.href;
  }
  if(!followed)follower?.pause();routeVersion++;loadAgain=false;
  for(const key of [...query.keys()])query.delete(key);next.searchParams.forEach((value,key)=>query.set(key,value));
  projectId=query.get('projectId')??'';if(pageMode()==='project'||(followed&&pageMode()==='references'))projectAddress=next.href;
  if(followed)history.replaceState({...history.state,projectHref:projectAddress},'',next);else if(!replace)history.pushState({projectHref:projectAddress},'',next);else projectAddress=history.state?.projectHref??projectAddress;
  activeViewAddress=next.href;
  const memory=routeStates.get(routeKey()),cached=memory?.service?.instanceId===state.service?.instanceId?memory:snapshots.get(routeKey(),state.service?.instanceId,projectId);pageDataReady=!!cached&&!cached._snapshot;
  if(cached)state=cached._snapshot?{...state,...cached}:cached;else state={...state,tasks:[],jobs:[],legacyJobs:[],versionRecords:[],query:null,_snapshot:false};
  projectChanged(false);blockContext(!followed&&followsProject()&&wasBlocked);
  if(cached)render();else{$('projectView').hidden=true;renderHub(state,projectId,{projectHref:projectAddress});}
  const position=routeScrolls.get(routeKey());if(position){scrollTo(position.x,position.y);$('board').scrollLeft=position.board;for(const [id,top] of position.lanes)if($('lane-'+id))$('lane-'+id).scrollTop=top;}
  if(!followed&&followsProject()&&!document.hidden)follower?.resume();void load();return true;
}
async function load(){
  if(loading&&loadingVersion===routeVersion){loadAgain=true;return;}loading=true;loadingVersion=routeVersion;const capturedProject=projectId,capturedRoute=routeVersion,capturedGeneration=readGeneration,capturedRecovery=executionRecovery?.taskId()??'';
  try{
    const initialStatus=initialReadStatus;initialReadStatus=null;
    let next;if(reader)next=await reader.load({projectId,initialStatus,mode:pageMode(),lanes:compactView.matches?[selectedLane]:lanes.map(l=>l[0]),filters:pageMode()==='versions'?{search:$('versionSearch')?.value??''}:pageFilters(),detailId:$('detail').open?detailId:capturedRecovery,selectedIds:selectedTaskIds()});
    else{const r=await fetch('/api/state');if(!r.ok)throw Error('面板服务不可用');next=await r.json();}
    if(capturedProject!==projectId||capturedRoute!==routeVersion||capturedGeneration!==readGeneration)return;if(capturedRecovery!==(executionRecovery?.taskId()??'')){loadAgain=true;return;}if(state.service?.instanceId&&next.service?.instanceId!==state.service.instanceId)routeStates.clear();state=next;pageDataReady=true;state.tasks=(state.tasks??[]).map(readableSourceTask);state.jobs??=[];rememberRoute();blockContext(contextBlocked,contextReason);
    const connection=catalogConnectionView(state);connected=connection.connected;$("connection").dataset.catalog=state.service?.catalogHealth?.recovering?"recovering":state.service?.catalogHealth?.activities??"";$('connection').textContent=verificationPending?'正在核对任务状态':connection.text;if(connection.reason)notice(connection.reason,!state.service?.catalogRecoverySupported,'connection');else if(connected)clearConnectionNotice();
  }catch(e){if(capturedRoute!==routeVersion||capturedGeneration!==readGeneration)return;connected=false;const recovering=state.service?.catalogRecoverySupported;$('connection').textContent=recovering?'自动恢复中':'连接断开';notice(recovering?'面板正在重新连接，请稍候。任务和草稿已保留。':'服务读取失败：'+e.message,!recovering,'connection');}
  finally{if(capturedRoute===routeVersion){loading=false;if(capturedGeneration===readGeneration){$('connection').dataset.ok=String(connected);render();}if(loadAgain){loadAgain=false;void load();}}}
}
async function ensureTask(id){
  if(!reader)return task(id);const captured=projectId,value=await reader.detail(captured,id);if(captured!==projectId)return null;
  const old=task(id);state.tasks=state.tasks.filter(t=>t.id!==id);state.tasks.push(readableSourceTask({...value.task,_listed:old?._listed,_reference:old?._reference??true}));
  if(value.job){state.jobs=state.jobs.filter(j=>j.id!==value.job.id);state.jobs.push(value.job);}return task(id);
}
async function ensureChoices(id=projectId){
  if(!reader)return;const captured=projectId,choices=await reader.allChoices(id);if(captured!==projectId)return;
  for(const t of choices)if(!state.tasks.some(row=>row.id===t.id))state.tasks.push(t);render();
}
function setTaskMode(mode){
  for(const [value,id,label] of [['goal','taskGoalToggle','目标'],['plan','taskPlanToggle','计划']]){
    $(id).setAttribute('aria-pressed',String(mode===value));
    $(id).textContent=mode===value?label+'已开启':'开启'+label;
  }
  $('taskModeHint').hidden=!mode;
  $('taskModeHint').textContent=mode==='goal'?'根据任务内容判断是否需要建立持续目标。':'根据任务内容判断是否需要制定执行计划。';
}
function editorContent(){return {description:$('taskDescription').value,taskMode:$('taskGoalToggle').getAttribute('aria-pressed')==='true'?'goal':$('taskPlanToggle').getAttribute('aria-pressed')==='true'?'plan':''};}
function executionContent(){
  const value=editorContent();
  if(!value.description.trim())throw Error('请填写任务内容');
  const description=taskModeContent(value.description,value.taskMode);
  if(description.trim().length>30000)throw Error('任务内容与所选模式要求合计不能超过 30,000 字符');
  return description;
}
for(const [mode,id] of [['goal','taskGoalToggle'],['plan','taskPlanToggle']])$(id).onclick=()=>{setTaskMode(editorContent().taskMode===mode?'':mode);persistEditor();};
async function openEditor(id='',sectionId='',groupId=null,{matchGroup=false}={}){
  const captured=projectId,capturedRoute=routeVersion;try{await ensureChoices();if(id&&!await ensureTask(id))return;if(captured!==projectId||capturedRoute!==routeVersion)return;}catch(e){if(capturedRoute===routeVersion)notice(e.message,true);return;}
  if(id&&!editableTask(task(id),state))return showDetail(id);
  const section=state.taskSections.find(s=>s.projectId===projectId&&s.id===sectionId),group=state.taskGroups?.find(row=>row.projectId===projectId&&row.id===groupId);
  editId=id;editorDraft=id?'edit:'+id:group?'new-group:'+group.id:groupId===''?'new-group:default':section?'new-section:'+section.id:'edit:';
  const receipt=drafts['receipt:'+editorDraft];
  let legacyReceipt=false;
  if(receipt?.savePending||receipt?.attempted)try{const values=JSON.parse(receipt.signature);legacyReceipt=Object.hasOwn(values,'sectionName')||Object.hasOwn(values,'sectionId');}catch{}
  const t=id?task(id):null,d=drafts[editorDraft]??t??{description:'',...(group?{boardGroupId:group.id}:{}),...(section?{sectionId:section.id,sectionName:section.name,autoProperties:{section:false,priority:true,type:true}}:{})},queuedJob=t?plainQueuedJob(t):null;
  const scheduled=t?scheduledTaskState(t,state):null,arranged=!!(queuedJob||scheduled);
  const content=Object.hasOwn(d,'taskMode')?d:readTaskModeContent(d.description||d.title||'');
  $('editorTitle').textContent=scheduled?.status==='paused'?'修改暂停任务':arranged?'修改排队任务':id?'编辑任务':group?'在此分组新建任务':section?'在此版块新建任务':'新建任务';$('taskDescription').value=content.description;renderPropertyEditor(d,!!id);executionEditor(d,id);editorFiles=structuredClone(d.attachments??[]);renderEditorFiles();$('taskFiles').value='';$('editorError').className='error';$('editorError').setAttribute('role','alert');$('editorError').textContent='';$('taskEditorHelp').open=false;openTaskOrganization(d,!!id,{legacyReceipt,matchGroup:matchGroup&&!receipt?.savePending&&!receipt?.attempted});
  $('taskExecution').hidden=!!queuedJob;$('executeEditorTask').hidden=arranged;$('sendEditorWindow').hidden=arranged;$('saveTask').textContent='保存';$('editorQueuedHint').hidden=!arranged;$('editorQueuedHint').textContent=scheduled?.status==='paused'?'保存后保持暂停，点击继续时使用最新内容。':'保存后原队列使用最新内容，不会重复安排。';
  setTaskMode(content.taskMode);
  $('editor').showModal();$('taskDescription').focus();
}
function persistEditor(){if(pending.has('editor'))return;drafts[editorDraft]={...editorContent(),...readPropertyEditor(),...organizationValues({draft:true}),...executionValues(),attachments:editorFiles};saveStore(draftKey(),drafts);}
$('taskForm').addEventListener('input',persistEditor);
$('taskForm').addEventListener('change',persistEditor);
// Capture the final values before dismissal; close must not recreate a draft
// already cleared by a successful save or execution.
$('editor').addEventListener('cancel',()=>{if(!pending.has('editor'))persistEditor();});
$('editor').addEventListener('click',e=>{if(e.target.closest('[data-close="editor"]')&&!pending.has('editor'))persistEditor();},true);
window.addEventListener('pagehide',()=>{if($('editor').open)persistEditor();});
async function submitEditor(e,execute=false,currentThread=false){
  e.preventDefault();if(pending.has('editor')||uploading)return;
  const currentThreadId=currentThread?query.get('threadId'):undefined;
  if(currentThread&&(!currentThreadId||!state.service?.currentThreadModesSupported)){$('editorError').textContent=currentThreadId?'发送到此对话需要新版后端，请等待面板安全更新。':'请在当前聊天的侧栏中发送到此对话。';return;}
  cancelTaskSuggestion();
  let description;try{description=executionContent();}catch(error){$('editorError').className='error';$('editorError').setAttribute('role','alert');$('editorError').textContent=error.message;return;}
  const values={autoTitle:true,description,...readPropertyEditor(),...organizationValues(),...executionValues(),attachmentIds:editorFiles.map(f=>f.id)},key=editorDraft,receiptKey='receipt:'+key,owner=projectId;
  persistEditor();pending.add('editor');$('projectSelect').disabled=true;$('taskForm').setAttribute('aria-busy','true');$('taskEditorScroll').inert=true;
  const buttons=[...$('taskForm').querySelectorAll('.dialog-actions button,.dialog-actions select,.dialog-heading button')];for(const b of buttons)b.disabled=true;
  $('editorError').className='error';$('editorError').setAttribute('role','alert');$('editorError').textContent='';
  try{
    const nativeKey='native-receipt:'+key;
    const saveNativeReceipt=receipt=>{
      if(receipt)drafts[nativeKey]=receipt;
      else{delete drafts[nativeKey];delete drafts['editor:'+key+':message'];}
      saveStore(draftKey(),drafts);
    };
    if(drafts[nativeKey]&&state.service?.composerReceiptLookupSupported===true&&await nativeReceiptNotSubmitted({receipt:drafts[nativeKey],projectId:owner,threadId:query.get('threadId'),post}))saveNativeReceipt(null);
    if(drafts['direct-receipt:'+key]||drafts[nativeKey])throw Error('上次消息回执待核对，请先在原对话核对；本次未保存或另行执行');
    if(!state.service?.taskContentSupported)throw Error('任务内容编辑需要新版后端，请等待面板安全更新后再保存');
    if(!values.description.trim())throw Error('请填写任务内容');
    if(execute&&!currentThreadId&&!state.service?.manualTaskAcceptanceSupported){const reason=executionReason({...values,execution:{...values.execution,unit:values.sectionName||values.description.slice(0,80)}});if(reason)throw Error(reason);}
    const result=await submitEditorTask({manualAcceptance:state.service?.manualTaskAcceptanceSupported===true,projectId:owner,id:editId,values,execute,currentThreadId,currentThreadMode:currentThreadId?'queue':undefined,receipt:drafts[receiptKey],post,readTask:async id=>{if(reader)return (await reader.detail(owner,id)).task;const response=await fetch('/api/state');if(!response.ok)throw Error('原卡片状态读取失败，请稍后重试');return (await response.json()).tasks.find(t=>t.id===id);},request:(kind,signature)=>request('editor:'+key+':'+kind,signature),onReceipt:receipt=>{if(!receipt){const old=drafts[receiptKey];delete drafts['editor:'+key+':create'];if(old?.id)delete drafts['editor:'+key+':execute:'+old.id];delete drafts[receiptKey];}else drafts[receiptKey]=receipt;saveStore(draftKey(),drafts);}});
    delete drafts[key];delete drafts['composer:'+key];delete drafts[receiptKey];delete drafts['editor:'+key+':create'];delete drafts['editor:'+key+':execute:'+result.saved.id];saveStore(draftKey(),drafts);$('editor').close();
    if(currentThreadId&&result.scheduled)selectLane('running',true);
    await load();
    if(currentThreadId&&result.scheduled)scheduleRefresh();
  }catch(error){$('editorError').textContent=(drafts[receiptKey]?.savePending?'保存未完成或回执待核对，内容已保留。':drafts[receiptKey]?.id?'卡片已保存。':'')+error.message+(drafts[receiptKey]?.attempted?'；不会自动重发，请先核对卡片执行状态。':'');$('taskEditorScroll').scrollTop=$('taskEditorScroll').scrollHeight;}
  finally{pending.delete('editor');$('taskForm').removeAttribute('aria-busy');$('taskEditorScroll').inert=false;for(const b of buttons)b.disabled=false;render();}
};
$('taskForm').onsubmit=e=>submitEditor(e);
$('executeEditorTask').onclick=()=>{if($('taskForm').reportValidity())void submitEditor({preventDefault(){}},true);};
$('sendEditorWindow').onclick=()=>{if($('taskForm').reportValidity())void submitEditor({preventDefault(){}},true,true);};
$('editor').addEventListener('cancel',e=>{if(pending.has('editor'))e.preventDefault();});
$('board').addEventListener('click',e=>{const b=e.target.closest('[data-section-create]');if(b){e.preventDefault();e.stopPropagation();void openEditor('',b.dataset.sectionCreate);}},true);
$('newTask').onclick=()=>openEditor('','',null,{matchGroup:true});
$('projectSelect').onchange=()=>{projectId=$('projectSelect').value;state.tasks=[];state.jobs=[];state.query=null;projectChanged();void load();};
$('binding').onchange=()=>{bindingDirty=true;renderCatalog();};
async function renameProjectThread(id){if(!id||pending.has('rename'))return;pending.add('rename');render();try{const result=await post('threads/rename',{threadId:id});notice(result.renamed?'已按规范重命名为：'+result.title:result.reason?'未改写标题：'+result.reason:'当前标题已符合规范：'+result.title);await load();}catch(e){notice(e.message,true);}finally{pending.delete('rename');render();}}
$('renameThread').onclick=()=>renameProjectThread($('binding').value||state.bindings[projectId]);
$('threadNameList').onclick=e=>{const button=e.target.closest('button[data-rename-thread]');if(button)void renameProjectThread(button.dataset.renameThread);};
$('saveBinding').onclick=async()=>{if(pending.has('bind'))return;pending.add('bind');render();try{await post('bind',{projectId,threadId:$('binding').value});bindingDirty=false;notice('执行对话已保存。');await load();}catch(e){notice(e.message,true);}finally{pending.delete('bind');render();}};
$('importThread').onclick=async()=>{try{await post('import',{threadId:$('importId').value.trim()});notice('对话已添加，请选择并保存绑定。');await load();}catch(e){notice(e.message,true);}};
$('refresh').onclick=async()=>{$('refresh').disabled=true;try{const result=await post('refresh');notice(result.accepted?'正在后台同步，可继续操作。':'连接已恢复，可以继续执行。');}catch(e){notice(e.message,true,'connection');}finally{await load();$('refresh').disabled=false;}};
function updateLaneView(){
  const compact=compactView.matches,active=document.activeElement;$('projectView').dataset.selectedLane=selectedLane;
  $('laneNav').setAttribute('role',compact?'tablist':'navigation');
  for(const [id] of lanes){const tab=$('tab-'+id),panel=$('lane-'+id);if(!tab||!panel)continue;
    tab.setAttribute('role',compact?'tab':'button');tab.setAttribute('aria-controls',panel.id);tab.tabIndex=compact&&id!==selectedLane?-1:0;
    if(compact)tab.setAttribute('aria-selected',String(id===selectedLane));else tab.removeAttribute('aria-selected');
    panel.setAttribute('role',compact?'tabpanel':'region');panel.setAttribute('aria-labelledby',compact?tab.id:'heading-'+id);panel.hidden=compact&&id!==selectedLane;panel.tabIndex=compact?0:-1;
  }
  if(active?.closest('.lane[hidden]'))$('tab-'+selectedLane)?.focus({preventScroll:true});
  if(!compact&&active?.closest('#laneNav'))$('lane-'+selectedLane)?.focus({preventScroll:true});
}
function selectLane(id,focus=false){selectedLane=id;drafts.selectedLane=id;saveStore(draftKey(),drafts);updateLaneView();if(reader){routeVersion++;loadAgain=false;void load();}if(focus)$('tab-'+id)?.focus({preventScroll:true});}
function locateDependency(id,{openDetail=true}={}){
  const target=task(id);if(!target||target.projectId!==projectId)return;
  const element=[...$('board').querySelectorAll('[data-task]')].find(el=>el.dataset.task===id);
  if(!element){if(openDetail)showDetail(id);return;}
  const lane=taskLane(target,state);
  if(lane!==selectedLane)selectLane(lane);
  for(let parent=element.parentElement;parent&&parent!==$('board');parent=parent.parentElement)if(parent.matches('details'))parent.open=true;
  element.focus({preventScroll:true});element.scrollIntoView({block:'center',behavior:'instant'});
}
$('board').addEventListener('click',e=>{const link=e.target.closest('[data-dependency-target]');if(link)locateDependency(link.dataset.dependencyTarget);});
$('laneNav').onclick=e=>{const id=e.target.closest('[data-lane]')?.dataset.lane;if(id)selectLane(id);};
$('laneNav').onkeydown=e=>{if(!compactView.matches||!['ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;e.preventDefault();const index=lanes.findIndex(l=>l[0]===selectedLane),next=e.key==='Home'?0:e.key==='End'?3:(index+(e.key==='ArrowRight'?1:3))%4;selectLane(lanes[next][0],true);};
compactView.addEventListener('change',()=>{const focused=document.activeElement?.closest('.lane');if(compactView.matches&&focused)selectedLane=focused.id.slice(5);updateLaneView();if(reader){routeVersion++;loadAgain=false;void load();}});
$('board').onclick=async e=>{const recovery=e.target.closest('[data-execution-action]');if(recovery){await executionRecovery?.activate(recovery.dataset.id,recovery.dataset.executionAction);render();return;}const b=e.target.closest('button[data-action]');if(!b){const card=e.target.closest('[data-task]');if(card&&!e.target.closest('button,a,input,textarea,select,label,summary')&&!window.getSelection()?.toString())openCard(card.dataset.task);return;}const id=b.dataset.id;let t=task(id);if(!t)return;if(b.dataset.action==='edit')return openEditor(id);if(b.dataset.action==='detail'){showDetail(id);return;}if(b.dataset.action==='return-queued'){const j=currentJob(t);if(!j||j.status!=='queued'||pending.has(id))return;pending.add(id);render();try{await post('cancel',{id:j.id});await load();}catch(e){notice(e.message,true);}finally{pending.delete(id);render();}return;}if(b.dataset.action==='execute')return executeCard(id,b.dataset.pausedPlanId);};
async function executeCard(id,pausedPlanId,retryPreparation=false){
  const project=projectId,instance=state.service?.instanceId,chosenRevision=task(id)?.executionRevision;let t;
  try{t=await ensureTask(id);}catch(error){notice(error.message,true);return;}
  if(!t||project!==projectId||instance!==state.service?.instanceId||pending.has(id))return;
  if(state.service?.manualTaskAcceptanceSupported){
    pending.add(id);executionRecovery?.clear(id);render();
    try{if(chosenRevision&&chosenRevision!==t.executionRevision)throw Error('卡片内容已变化，请查看最新内容后重新执行');
      await post('tasks/execute',{id,projectId:project,accept:true,expectedRevision:t.executionRevision,retryPreparation:retryPreparation||!!pausedPlanId,...(pausedPlanId?{pausedPlanId}:{}),requestId:request('accept:'+id,JSON.stringify([t.executionRevision,t.jobIds]))});selectedLane='running';updateLaneView();await load();
    }catch(error){executionRecovery?.note(id,error.message);await load();}finally{pending.delete(id);render();}return;
  }
  const scheduled=scheduledTaskState(t,state),manualPaused=!!pausedPlanId&&scheduled?.id===pausedPlanId&&scheduled.canManual===true;
  const reason=scheduledMessage(t)&&!manualPaused?scheduledMessage(t):executionReason(t,{manualPaused})||chainBlock(t);
  if(reason){notice(reason+'；可点击“检查执行”查看恢复入口。',true);return;}
  pending.add(id);render();
  try{
    const threadId=state.bindings[projectId];
    await post('tasks/execute',{id,threadId,...(manualPaused?{pausedPlanId}:{}),requestId:request('execute:'+id,JSON.stringify([t.title,t.description,t.tag,t.reviewNote,t.sectionId,taskSection(state,t)?.revision,t.execution,t.dependsOn,t.attributes,t.attachments,threadId,t.jobIds,state.automation.plans.filter(p=>p.status==='cancelled'&&p.nodes.some(n=>n.taskId===id)).map(p=>p.id),...(manualPaused?[pausedPlanId]:[])]))});
    await load();
  }catch(e){notice(e.message+'；不会自动重发，再次点击执行将使用同一请求标识。',true);}
  finally{pending.delete(id);render();}
}
$('reviewNote').oninput=()=>{drafts['review:'+detailId]=$('reviewNote').value;saveStore(draftKey(),drafts);renderDetail();};
$('resolveConfirm').onchange=renderDetail;
async function review(route){
  const id=detailId,t=task(id),note=$('reviewNote').value,jobId=t?.currentJobId;
  const manual=route==='approve';
  if(pending.has(id))return;
  if(route!=='approve'&&currentJob(t)?.status==='uncertain'&&!note.trim()){$('reviewError').textContent=currentJob(t)?.status==='uncertain'?'请先填写核对情况':'请先填写需要修改的地方';$('reviewNote').focus();return;}
  pending.add(id);render();
  try{
    if(manual&&!state.service?.taskAcceptanceSupported)throw Error('人工通过需要新版后端，请等待面板安全更新后再点击');
    await post('tasks/'+route,{id,jobId,note,confirmed:$('resolveConfirm').checked,...(manual?{acceptResult:true}:{}),...(route==='retry-review'?{requestId:request('review-retry:'+id,JSON.stringify([jobId,note.trim()]))}:{})});
    delete drafts['review:'+id];saveStore(draftKey(),drafts);$('reviewError').textContent='';
    if(route==='return-to-todo')selectedLane='todo';
    await load();$('detail').close();render();
    if(route!=='approve')notice(route==='return-to-todo'?'已保存到待执行，稍后接续原对话与当前轮次。':'已加入原对话队列，继续当前轮次。');
  }catch(e){$('reviewError').textContent=e.message;}finally{pending.delete(id);render();}
}
$('openReviewChat').onclick=async()=>{
  const id=detailId,t=task(id),job=t&&currentJob(t),key='open-review:'+id;
  if(t?.status!=='review'||!job?.threadId||!connected||pending.has(id)||pending.has(key))return;
  pending.add(key);$('reviewError').textContent='';renderDetail();
  try{await post('open',{threadId:job.threadId});}
  catch(error){if(detailId===id&&$('detail').open)$('reviewError').textContent='定位聊天失败：'+error.message;}
  finally{pending.delete(key);renderDetail();}
};
$('approveTask').onclick=()=>review('approve');
$('deleteTask').onclick=async()=>{
  const id=detailId,t=task(id);if(!t||pending.has(id)||detailReadOnly)return;
  pending.add(id);renderDetail();
  try{
    if(!state.service?.taskAcceptanceSupported)throw Error('删除审阅任务需要新版后端，请等待面板安全更新');
    await post('tasks/archive',{id,jobId:t.currentJobId??null});await load();$('detail').close();
  }catch(error){if(t.status==='review')$('reviewError').textContent=error.message;else notice(error.message,true);}finally{pending.delete(id);render();}
};
$('manualReview').onclick=()=>{
  manualReviewMode=true;reviewFeedbackOpen=true;$('resolveConfirm').checked=false;$('reviewError').textContent='';
  renderDetail();$('reviewSection').scrollIntoView({block:'nearest'});$('reviewNote').focus();
};
$('checkReviewState').onclick=()=>inspectReview();
$('restoreReviewThread').onclick=async()=>{
  const id=detailId,t=task(id),job=t&&currentJob(t);if(!job||pending.has(id))return;
  pending.add(id);$('reviewError').textContent='';renderDetail();
  try{
    const result=await post('tasks/restore-thread',{id,jobId:job.id});notice(result.message);await load();
  }catch(error){if(detailId===id)$('reviewError').textContent=error.message+'；请重新核对原对话状态，不会自动重试。';}
  finally{pending.delete(id);if(detailId===id){renderDetail();void inspectReview();}}
};
$('retryReview').onclick=()=>{
  if(manualReviewMode){manualReviewMode=false;$('resolveConfirm').checked=false;renderDetail();}
  if(currentJob(task(detailId))?.status==='uncertain'&&!$('resolveConfirm').checked){reviewFeedbackOpen=true;renderDetail();$('reviewNote').focus();return;}
  return review('retry-review');
};
$('returnReview').onclick=()=>{
  if(manualReviewMode){manualReviewMode=false;reviewFeedbackOpen=false;$('resolveConfirm').checked=false;}
  if(!reviewFeedbackOpen){
    reviewFeedbackOpen=true;$('reviewError').textContent='';
    if(!$('reviewNote').value.trim()&&currentJob(task(detailId))?.status!=='uncertain'){
      const job=currentJob(task(detailId)),suggestion=job?.suggestion??executionSuggestion(job?.finalResult??job?.result);
      if(suggestion.tooLong)$('reviewError').textContent='本轮建议超过 10,000 字符，请从当前结果中摘录要处理的内容；未截断或发送。';
      else if(suggestion.note){$('reviewNote').value=suggestion.note;drafts['review:'+detailId]=suggestion.note;saveStore(draftKey(),drafts);}
    }
    renderDetail();$('reviewSection').scrollIntoView({block:'nearest'});$('reviewNote').focus();return;
  }
  return review('return-to-todo');
};
$('detailExtras').addEventListener('click',async e=>{
  const button=e.target.closest('[data-round-steps]');if(!button||button.disabled)return;
  button.disabled=true;const project=projectId,card=detailId;
  try{
    const page=await reader.get('round-steps',{projectId:project,id:button.dataset.roundOwner,roundId:button.dataset.roundSteps,limit:20,cursor:button.dataset.cursor});
    if(project!==projectId||card!==detailId||!button.isConnected)return;
    const target=button.nextElementSibling;
    if(!button.dataset.cursor)target.replaceChildren();
    for(const step of page.items){const section=document.createElement('section');section.className='round-step';const h=document.createElement('h4');h.textContent=time(step.createdAt)+' · '+(step.inputKind==='feedback'?'处理反馈':step.inputKind==='answer'?'你的回答':'任务内容');const input=document.createElement('pre');input.className='result-text';input.textContent=step.prompt??'';const result=document.createElement('pre');result.className='result-text';result.textContent=step.result||'等待回复';section.append(h,input,result);target.append(section);}
    button.dataset.cursor=page.cursor??'';button.hidden=!page.cursor;button.textContent='加载更多本轮问答';
  }catch(error){$('reviewError').textContent=error.message;}finally{button.disabled=false;}
});

document.addEventListener('click',async e=>{const close=e.target.closest('[data-close]');if(close)$(close.dataset.close).close();const mount=e.target.closest('[data-mount]');if(mount&&!pending.has('mount')){pending.add('mount');render();try{await post('boards/'+mount.dataset.mount,mount.dataset.all?{all:true}:{projectId});notice('挂载设置已保存，正在更新桌面右侧看板。');await load();}catch(e){notice(e.message,true);}finally{pending.delete('mount');render();}}const b=e.target.closest('[data-open],[data-cancel]');if(b){try{if(b.dataset.open)await post('open',{threadId:b.dataset.open});else{await post('cancel',{id:b.dataset.cancel});await load();}}catch(e){notice(e.message,true);}}});
const references=initProjectReferences?.({
  read:owner=>reader.get('references',{projectId:owner}),post,upload:uploadPanelAttachment,attachmentList,hydrateImages,
  manageTags:bootstrapState.service?.projectReferenceTagManagementSupported===true,
  grouped:bootstrapState.service?.projectReferenceGroupsSupported===true,
  run:async operation=>{pending.add('project-reference');try{return await operation();}finally{pending.delete('project-reference');}}
});
initLineage({post,load,notice,render,showDetail,ensureChoices,references});
taskGroupsUI=initTaskGroups?.({board:$('board'),state:()=>state,projectId:()=>projectId,canChange:canChangeTaskGroups,post,notice,
  openTask:id=>openEditor('','',id),focusTask:id=>locateDependency(id,{openDetail:false}),
  commit:async(result,owner)=>{
    if(owner!==projectId)return;
    routeVersion++;loadAgain=false;
    if(result.taskId){
      const current=task(result.taskId),from=current?.boardGroupId??'',to=result.groupId??'',lane=current&&taskLane(current,state);
      const page=state.query?.pages[lane];
      let query=state.query;
      if(page?.groupCounts&&from!==to){
        const groupCounts={...page.groupCounts,[from]:Math.max(0,(page.groupCounts[from]??0)-1),[to]:(page.groupCounts[to]??0)+1};
        query={...query,pages:{...query.pages,[lane]:{...page,groupCounts}}};
      }
      state={...state,query,tasks:state.tasks.map(t=>t.id===result.taskId?{...t,boardGroupId:result.groupId??undefined}:t)};
    }else{
      const groups=state.taskGroups??[],id=result.group?.id??result.id;
      const taskGroups=result.group?(groups.some(group=>group.id===id)?groups.map(group=>group.id===id?result.group:group):[...groups,result.group]):groups.filter(group=>group.id!==id);
      state={...state,taskGroups};
    }
    render();await load();
  }
});
initTaskOrganization({post,changed:persistEditor,groupOptions:taskGroupOptions,matchGroup:matchTaskGroup});
initPlanUI({post,load});
initAutomation({post,load,notice,render,showDetail,selectTodo:()=>{selectedLane='todo';}});
initProperties({post,load,notice,render:()=>{render();if(reader)void load();},saveDraft:persistEditor});
initHub({post,load,notice,ensureChoices,reader,prepareProjectSync,diagnosticsSupported:bootstrapState.service?.diagnosticsSupported===true});
executionRecovery=initExecutionRecovery?.({fetch,state:()=>state,projectId:()=>projectId,detailId:()=>detailId,notice,post,load,ensure:ensureTask,edit:openEditor,review:async id=>{await showDetail(id);if(detailId===id&&$('detail').open){reviewFeedbackOpen=true;renderDetail();$('reviewSection').scrollIntoView({block:'nearest'});$('reviewNote').focus();}},execute:executeCard});
$('board').addEventListener('click',event=>{const button=event.target.closest('[data-recovery-task]');if(button)void executionRecovery.open(button.dataset.recoveryTask).catch(error=>notice(error.message,true));});

initHandoffUI({getTask:()=>task(detailId),post,load,render:()=>{detailKey='';renderDetail();},notice});
initDialogLayouts();
document.addEventListener('click',async e=>{
  if(!reader)return;const more=e.target.closest('[data-more-lane],[data-load-history],[data-more-legacy]');if(!more)return;
  more.disabled=true;const captured=projectId;
  try{
    if(more.dataset.moreLane)await reader.list('tasks',{projectId,lane:more.dataset.moreLane,limit:40,...pageFilters()},true);
    else if(more.hasAttribute('data-load-history'))await reader.history(projectId,detailId,reader.histories.has(projectId+':'+detailId));
    else await reader.list('jobs',{projectId,limit:20},true);
    if(captured===projectId)await load();
  }catch(error){notice(error.message,true);}finally{more.disabled=false;}
});
document.addEventListener('toggle',async e=>{
  const el=e.target;if(!reader||!el.open||!el.matches('#legacyList [data-record]'))return;
  const id=el.dataset.record,record=state.legacyJobs.find(j=>j.id===id);if(!record?._partial)return;
  try{const captured=projectId,{job}=await reader.get('job',{projectId,id});if(captured!==projectId||!el.isConnected)return;Object.assign(record,job,{_partial:false});el.innerHTML=jobRecord(record,true).replace(/^<details[^>]*>|<\/details>$/g,'');}catch(error){notice(error.message,true);}
},true);
const frozenControls=document.createElement('div');frozenControls.id='projectFrozenControls';
const projectHeading=$('projectView').querySelector('.project-heading');projectHeading.before(frozenControls);frozenControls.append(projectHeading,document.querySelector('.lane-tools'));
function placeIdentityReminder(){
  const reminder=$('identityReminder');
  if(!$('projectView').hidden){if(reminder.previousElementSibling!==frozenControls)frozenControls.after(reminder);}
  else if(reminder.parentElement!==$('workspaceHub'))$('workspaceConfig').before(reminder);
}
const mobileDock=document.createElement('nav');mobileDock.id='mobileDock';mobileDock.setAttribute('aria-label','移动端导航');mobileDock.innerHTML='<div class="mobile-dock-nav"></div>';document.body.append(mobileDock);
const dockNav=mobileDock.querySelector('.mobile-dock-nav');
const hubSwitch=document.querySelector('.hub-switch'),workspaceTools=document.querySelector('.app-bar>.workspace-tools'),taskViewSwitch=document.querySelector('.task-view-switch'),organizePlan=$('organizePlan');
document.querySelector('#projectView .heading-actions').prepend(organizePlan);
const projectMenu=document.createElement('div');projectMenu.id='projectMenu';projectMenu.setAttribute('popover','auto');projectMenu.setAttribute('role','dialog');projectMenu.setAttribute('aria-label','项目功能');projectMenu.append(taskViewSwitch);document.body.append(projectMenu);
const versionEntry=document.createElement('a');versionEntry.id='versionLink';versionEntry.textContent='版本';taskViewSwitch.append(versionEntry);
const projectEntry=$('ownBoardLink');
let projectMenuWasOpen=false;
function onProjectBoard(){return pageMode()==='project'&&!$('projectView').hidden&&!$('board').hidden&&!$('workspaceConfig').open;}
function updateProjectMenu(){
  if(!onProjectBoard()){
    if(projectMenu.matches(':popover-open'))projectMenu.hidePopover();
    for(const attr of ['aria-controls','aria-haspopup','aria-expanded'])projectEntry.removeAttribute(attr);
    return;
  }
  projectEntry.setAttribute('aria-controls','projectMenu');
  projectEntry.setAttribute('aria-haspopup','dialog');
  projectEntry.setAttribute('aria-expanded',String(projectMenu.matches(':popover-open')));
}
function toggleProjectMenu(){
  if(projectMenu.matches(':popover-open')){projectMenu.hidePopover();return;}
  projectMenu.showPopover({source:projectEntry});
  const anchor=projectEntry.getBoundingClientRect(),box=projectMenu.getBoundingClientRect();
  projectMenu.style.left=Math.max(8,Math.min(anchor.left,innerWidth-box.width-8))+'px';
  projectMenu.style.top=Math.max(8,Math.min(mobileDockQuery.matches?mobileDock.getBoundingClientRect().top-box.height-8:anchor.bottom+8,innerHeight-box.height-8))+'px';
  projectMenu.querySelector('button').focus({preventScroll:true});
}
projectEntry.addEventListener('pointerdown',()=>{projectMenuWasOpen=projectMenu.matches(':popover-open');});
projectEntry.addEventListener('click',e=>{
  if(e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
  if(onProjectBoard()){
    e.preventDefault();
    // The browser can light-dismiss before click reaches the same link.
    if(e.detail>0&&projectMenuWasOpen){
      if(projectMenu.matches(':popover-open'))projectMenu.hidePopover();
    }else toggleProjectMenu();
    return;
  }
  resetTaskView();
  const inSettings=$('workspaceConfig').open;
  if(inSettings)$('closeWorkspace').click();
  if(pageMode()==='project'&&projectEntry.href===activeViewAddress){
    e.preventDefault();render();
    if(inSettings)projectEntry.focus({preventScroll:true});
  }
});
projectEntry.addEventListener('keydown',e=>{
  if(e.key===' '&&onProjectBoard()){e.preventDefault();projectEntry.click();}
  if(e.key==='ArrowDown'&&onProjectBoard()){e.preventDefault();toggleProjectMenu();}
});
document.addEventListener('click',e=>{const link=e.target.closest('#controlLink,#ownBoardLink,#referencesLink,#versionLink,.overview-actions a');if(!link||e.defaultPrevented||e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();if(!navigateView(link.getAttribute('href')))notice('当前入口无法切换，请重新选择。',true);});
addEventListener('popstate',()=>{if(!navigateView(location.href,true))notice('当前地址无法切换，请重新选择项目。',true);});
projectMenu.addEventListener('toggle',updateProjectMenu);
projectMenu.addEventListener('click',e=>{if(e.target.closest('button,a[href]'))projectMenu.hidePopover();},true);
const mobileDockQuery=matchMedia('(max-width:480px)');
function placeMobileDock(){
  if(projectMenu.matches(':popover-open'))projectMenu.hidePopover();
  if(mobileDockQuery.matches)dockNav.append(hubSwitch,workspaceTools);
  else{document.querySelector('.hub-nav').prepend(hubSwitch);document.querySelector('.app-bar').append(workspaceTools);}
  mobileDock.hidden=!mobileDockQuery.matches;
  sizeFrozenHeader();
}
mobileDockQuery.addEventListener('change',placeMobileDock);
new MutationObserver(updateProjectMenu).observe($('projectView'),{attributes:true,attributeFilter:['hidden']});
$('workspaceConfig').addEventListener('toggle',updateProjectMenu);
placeMobileDock();
function sizeFrozenHeader(){
  const root=document.documentElement,main=getComputedStyle(document.querySelector('main'));
  root.style.setProperty('--app-header-height',document.querySelector('.app-bar').getBoundingClientRect().height+'px');
  root.style.setProperty('--project-header-gap',main.paddingTop);root.style.setProperty('--project-header-inset',main.paddingLeft);
  alignFrozenBackground();
}
function alignFrozenBackground(){
  const controls=document.getElementById('projectFrozenControls');
  if(!controls?.getClientRects().length)return;
  const main=getComputedStyle(document.querySelector('main'));
  controls.style.setProperty('--frozen-background-top',(controls.getBoundingClientRect().top-parseFloat(main.paddingTop))+'px');
  controls.toggleAttribute('data-scroll-fade',scrollY>0&&!$('board').hidden);
}
new ResizeObserver(sizeFrozenHeader).observe(document.querySelector('.app-bar'));new ResizeObserver(alignFrozenBackground).observe(document.querySelector('main'));window.addEventListener('resize',sizeFrozenHeader);let frozenBackgroundFrame=0;window.addEventListener('scroll',()=>{if(!frozenBackgroundFrame)frozenBackgroundFrame=requestAnimationFrame(()=>{frozenBackgroundFrame=0;alignFrozenBackground();});},{passive:true});sizeFrozenHeader();
async function showDetail(id){try{if(!await ensureTask(id))return;}catch(e){notice(e.message,true);return;}detailId=id;detailKey='';detailReadOnly=!!task(id).archivedAt;reviewFeedbackOpen=false;manualReviewMode=false;reviewRecovery={};reviewInspection++;$('reviewNote').value=drafts['review:'+id]??'';$('reviewError').textContent='';$('resolveConfirm').checked=false;$('detail').showModal();renderDetail();$('detailScroll').scrollTop=0;}
$('board').addEventListener('keydown',e=>{if(e.target.matches('[data-task]')&&['Enter',' '].includes(e.key)){e.preventDefault();openCard(e.target.dataset.task);}});
function attachmentList(files){return files.map(f=>`<div class="attachment-item">${f.type.startsWith('image/')?`<img data-file-image="${esc(f.id)}" data-project="${esc(f.projectId)}" alt="${esc(f.name)}">`:''}<button type="button" data-download="${esc(f.id)}" data-project="${esc(f.projectId)}" data-name="${esc(f.name)}">${esc(f.name)} · ${Math.ceil(f.size/1024)} KB</button></div>`).join('');}

function renderEditorFiles(){$('attachmentList').innerHTML=editorFiles.map(f=>{const image=f.type.startsWith('image/'),download=`data-download="${esc(f.id)}" data-project="${esc(f.projectId)}" data-name="${esc(f.name)}"`,content=image?`<button type="button" class="attachment-image" ${download} aria-label="下载附件：${esc(f.name)}" title="${esc(f.name)}"><img data-file-image="${esc(f.id)}" data-project="${esc(f.projectId)}" alt="${esc(f.name)}"></button>`:attachmentList([f]);return `<div class="attachment-edit-item${image?' image':''}">${content}<button type="button" class="attachment-remove" data-remove-file="${esc(f.id)}" aria-label="移除附件：${esc(f.name)}" title="移除附件"><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3.2 3.2L8.8 8.8M8.8 3.2L3.2 8.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></div>`;}).join('');hydrateImages();}
const fileKey=(id,project)=>project+'\0'+id;
function trimFileUrls(){
  if(fileUrls.size<=24)return;
  const images=[...document.querySelectorAll('img[data-file-image]')];
  for(const [key,url] of fileUrls){
    if(fileUrls.size<=24)break;
    const owners=images.filter(img=>img.src===url),visible=owners.some(img=>{if(!img.isConnected||!img.getClientRects().length)return false;const rect=img.getBoundingClientRect();return rect.bottom>=-200&&rect.top<=innerHeight+200;});
    if(visible)continue;
    for(const img of owners){img.removeAttribute('src');delete img.dataset.fileReady;}
    fileUrls.delete(key);URL.revokeObjectURL(url);
  }
}
function scheduleFileTrim(){if(fileTrimTimer)return;fileTrimTimer=setTimeout(()=>{fileTrimTimer=null;trimFileUrls();},100);}
document.addEventListener('scroll',scheduleFileTrim,true);
async function fileUrl(id,project){
  const key=fileKey(id,project),cached=fileUrls.get(key);if(cached){fileUrls.delete(key);fileUrls.set(key,cached);return cached;}
  if(fileUrlRequests.has(key))return fileUrlRequests.get(key);
  const request=(async()=>{const r=await fetch('/api/attachments/read',{method:'POST',headers:{'Content-Type':'application/json','X-Panel-Token':state.token},body:JSON.stringify({id,projectId:project})});if(!r.ok)throw Error('附件读取失败，请刷新后重试');const url=URL.createObjectURL(await r.blob());fileUrls.set(key,url);scheduleFileTrim();return url;})();
  fileUrlRequests.set(key,request);try{return await request;}finally{if(fileUrlRequests.get(key)===request)fileUrlRequests.delete(key);}
}
const fileImageObserver=new IntersectionObserver(entries=>{for(const {target:img,isIntersecting} of entries){if(!isIntersecting||!img.isConnected||img.dataset.fileReady||img.dataset.fileLoading)continue;
  img.dataset.fileLoading='true';void fileUrl(img.dataset.fileImage,img.dataset.project).then(url=>{if(img.isConnected){img.src=url;img.dataset.fileReady='true';}}).catch(()=>{if(img.isConnected&&!img.alt.includes('（预览不可用）'))img.alt+='（预览不可用）';}).finally(()=>{delete img.dataset.fileLoading;scheduleFileTrim();});
}},{rootMargin:'200px'});
const observedFileImages=new Set();
function hydrateImages(){
  for(const img of observedFileImages)if(!img.isConnected){fileImageObserver.unobserve(img);observedFileImages.delete(img);}
  document.querySelectorAll('img[data-file-image]').forEach(img=>{if(img.dataset.fileObserved)return;img.dataset.fileObserved='true';observedFileImages.add(img);fileImageObserver.observe(img);});
}
async function uploadPanelAttachment(file,owner){
  const base64=await new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);
    reader.onerror=()=>reject(Error('读取文件失败'));reader.readAsDataURL(file);
  });
  return (await post('attachments/upload',{projectId:owner,name:file.name,base64})).file;
}
async function addFiles(files){if(uploading||pending.has('editor'))return;uploading=true;$('saveTask').disabled=true;$('executeEditorTask').disabled=true;$('sendEditorWindow').disabled=true;$('taskFiles').disabled=true;pending.add('upload');render();$('editorError').className='error';$('editorError').setAttribute('role','alert');$('editorError').textContent='';try{for(const file of files){if(editorFiles.length>=8)throw Error('每个任务最多 8 个附件');if(file.size>10*1024*1024||editorFiles.reduce((n,f)=>n+f.size,0)+file.size>40*1024*1024)throw Error('附件超过单文件 10 MB 或总计 40 MB 限制');$('uploadStatus').textContent='正在上传：'+file.name;editorFiles.push(await uploadPanelAttachment(file,projectId));persistEditor();renderEditorFiles();}}catch(e){$('editorError').textContent=e.message;}finally{uploading=false;pending.delete('upload');$('saveTask').disabled=false;$('executeEditorTask').disabled=false;$('sendEditorWindow').disabled=false;$('taskFiles').disabled=false;$('taskFiles').value='';$('uploadStatus').textContent='已添加 '+editorFiles.length+' 个附件';render();}}
$('taskFiles').onchange=e=>addFiles([...e.target.files]);
$('editor').addEventListener('cancel',e=>{if(uploading)e.preventDefault();});
$('editor').addEventListener('click',e=>{if(uploading&&e.target.closest('[data-close], [data-remove-file]')){e.preventDefault();e.stopImmediatePropagation();}},true);
$('editor').addEventListener('dragover',e=>{e.preventDefault();});
$('editor').addEventListener('drop',e=>{e.preventDefault();if(e.dataTransfer.files.length)addFiles([...e.dataTransfer.files]);});
$('editor').addEventListener('paste',e=>{if(e.clipboardData.files.length){e.preventDefault();addFiles([...e.clipboardData.files]);}});
document.addEventListener('click',async e=>{const remove=e.target.closest('[data-remove-file]');if(remove&&!uploading){editorFiles=editorFiles.filter(f=>f.id!==remove.dataset.removeFile);persistEditor();renderEditorFiles();}const button=e.target.closest('[data-download]');if(button){try{const a=document.createElement('a');a.href=await fileUrl(button.dataset.download,button.dataset.project);a.download=button.dataset.name;a.click();}catch(error){notice(error.message,true);}}});
window.addEventListener('pagehide',()=>{fileImageObserver.disconnect();observedFileImages.clear();clearTimeout(fileTrimTimer);for(const url of fileUrls.values())URL.revokeObjectURL(url);fileUrls.clear();});

drafts=readStore(draftKey(),{});selectedLane=lanes.some(l=>l[0]===drafts.selectedLane)?drafts.selectedLane:'todo';updateProperties(bootstrapState,projectId);state=bootstrapState;const restored=snapshots.get(routeKey(),bootstrapState.service.instanceId,projectId);if(restored){state={...bootstrapState,...restored};render();blockContext(followsProject());}
addEventListener('pagehide',pauseRefresh);addEventListener('pageshow',resumeRefresh);document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseRefresh();else resumeRefresh();});resumeRefresh();

}

// Shared modal layout: keep existing nodes, form ownership and business handlers.
function initDialogLayouts(){
  const groupLayout={root:'form',scroll:'.task-group-dialog-body',actions:'.dialog-actions'};
  const layouts={
    editor:{root:'#taskForm',scroll:'#taskEditorScroll',actions:'.dialog-actions'},
    detail:{scroll:'#detailScroll',actions:'#reviewActions'},
    recognitionDialog:{root:'#recognitionForm',actions:'.compact-actions'},
    pendingDialog:{actions:'.compact-actions'},
    historyDialog:{actions:'#importSelected'},
    versionEditor:{root:'#versionForm',actions:'.dialog-actions'},
    versionPreview:{actions:'#copyVersionGuide, #versionCopyStatus'},
    openBoardDialog:{root:'#openBoardForm',actions:'.dialog-actions'},
    projectAdoptionDialog:{root:'#projectAdoptionForm',actions:'.dialog-actions'},
    restartDialog:{actions:'.dialog-actions'},
    workflowInitDialog:{actions:'.dialog-actions'},
    legacyResolve:{root:'#legacyResolveForm',actions:'#closeLegacy, button.primary'},
    autoPlanDialog:{root:'#autoPlanForm',actions:'button[type=submit]'},
    planImportDialog:{actions:'#copyPlanCommand, #cancelPlanImport'},
    sectionEditor:{actions:'#sectionForm > button.primary, #saveSectionThread'}
  };
  const prepared=new WeakSet();
  function prepare(dialog){
    for(const button of dialog.querySelectorAll('.dialog-heading button')){
      if(button.textContent.trim()==='×'||!button.textContent.trim()&&button.querySelector('svg'))button.classList.add('dialog-icon-button');
    }
    const config=dialog.classList.contains('board-group-dialog')?groupLayout:layouts[dialog.id];if(!config||prepared.has(dialog))return;
    const root=config.root?dialog.querySelector(config.root):dialog;
    const heading=dialog.querySelector('.dialog-heading, h2');
    const actions=[...dialog.querySelectorAll(config.actions)];
    if(!root||!heading||!actions.length)return;
    prepared.add(dialog);
    const focused=dialog.contains(document.activeElement)?document.activeElement:null;
    if(root!==dialog){
      // Recognition/plan headings and previews used to sit outside their form.
      const siblings=[...dialog.children],index=siblings.indexOf(root);
      root.prepend(...siblings.slice(0,index));root.append(...siblings.slice(index+1));
      root.classList.add('dialog-layout-root');
    }
    let footer=actions.length===1&&actions[0].matches('.dialog-actions, .compact-actions, #reviewActions')?actions[0]:null;
    if(!footer){footer=document.createElement('div');footer.className='dialog-actions';}
    // The section editor has two independent forms; keep each submit target.
    for(const button of actions.flatMap(el=>el.matches('button')?[el]:[...el.querySelectorAll('button')])){
      if(button.form&&root!==button.form)button.setAttribute('form',button.form.getAttribute('id'));
    }
    if(!actions.includes(footer))footer.append(...actions);
    let scroll=config.scroll?dialog.querySelector(config.scroll):null;
    if(!scroll){
      scroll=document.createElement('div');
      scroll.id=dialog.id+'Scroll';
      // Extract the header/footer before collecting the remaining body nodes.
      heading.remove();footer.remove();
      scroll.append(...root.childNodes);root.append(heading,scroll,footer);
    }
    dialog.classList.add('dialog-shell');heading.classList.add('dialog-layout-heading');
    scroll.classList.add('dialog-scroll');footer.classList.add('dialog-footer');
    if(!scroll.hasAttribute('tabindex'))scroll.tabIndex=0;
    scroll.setAttribute('role','region');
    if(!scroll.hasAttribute('aria-label'))scroll.setAttribute('aria-label',(heading.querySelector('h2')??heading).textContent.trim()+'内容');
    if(focused?.isConnected&&document.activeElement!==focused)focused.focus({preventScroll:true});
    let frame=0;
    const update=()=>{
      frame=0;if(!dialog.open)return;
      scroll.dataset.overflow=String(scroll.scrollHeight>scroll.clientHeight+1);
      scroll.dataset.moreBelow=String(scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop>1);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
    scroll.addEventListener('scroll',schedule,{passive:true});
    const resize=new ResizeObserver(schedule);resize.observe(scroll);resize.observe(footer);resize.observe(heading);
    const sizedChildren=new Set();
    const watchContent=()=>{
      for(const child of sizedChildren)if(child.parentElement!==scroll){resize.unobserve(child);sizedChildren.delete(child);}
      for(const child of scroll.children)if(!sizedChildren.has(child)){resize.observe(child);sizedChildren.add(child);}
    };
    watchContent();
    const content=new MutationObserver(records=>{
      if(records.some(r=>r.target===dialog&&r.attributeName==='open')&&dialog.open)scroll.scrollTop=0;
      if(records.some(r=>r.type==='childList'))watchContent();
      schedule();
    });
    content.observe(dialog,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['open','hidden']});
    // Images can change scroll height without changing the scroll viewport.
    scroll.addEventListener('load',schedule,true);
    scroll.addEventListener('input',schedule);
    scroll.addEventListener('focusin',e=>{
      if(e.target!==scroll)e.target.scrollIntoView({block:'nearest',inline:'nearest'});
      schedule();
    });
    dialog.addEventListener('close',()=>{scroll.scrollTop=0;schedule();});
    schedule();
  }
  document.querySelectorAll('dialog').forEach(prepare);
  // Some confirmations (e.g. safe restart) are created only on first use.
  new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes){
      if(node.nodeType!==1)continue;
      if(node.matches('dialog'))prepare(node);
      node.querySelectorAll('dialog').forEach(prepare);
    }
  }).observe(document.body,{childList:true,subtree:true});
}
