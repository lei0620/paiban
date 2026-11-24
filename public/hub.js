import {panelFetch as fetch,panelLocation as location} from './read-client.js';
let diagnosticUI;
import {taskLane} from './automation-ui.js';
import {viewAddress} from './project-context.js';
import {initVersions,updateVersions} from './versions.js';
import {initWorkflowInitialization,renderWorkflowInitialization} from './workflow-init.js';
import {projectPropertyGroups,propertyInput,readTypeInput} from './properties.js';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let api,current={},restartPending=false,restartInstance=null,observedInstance=null,sourceProof=null,sourceProjectId=null,updateBusy=false,updateMessage='',reconnectDataLocation;
let projectBoardUI,projectBoardModule;
const values=form=>Object.fromEntries(new FormData(form));
const input=(id,label,name,type='text')=>`<label for="${id}">${label}</label><input id="${id}" name="${name}" type="${type}" required>`;
const setupSteps=[
  {key:'connection',title:'连接 Codex',target:'findInstances',help:'打开 Codex 桌面应用，进入派板所在项目的聊天。查找本机实例，粘贴该聊天的链接或 ID 后保存。',prompt:'帮我配置本机派板的桌面连接。请先核对当前 Codex 桌面实例和派板项目的实际目录。使用当前聊天的真实 CODEX_THREAD_ID 或 Codex 提供的聊天链接核对会话 ID，找不到时明确告诉我如何取得。在派板「设置 → 高级设置 → 桌面连接」点击「查找实例」，指引我选择已核实的本机实例、填入 ID 并保存。只验证能读取正确的项目和聊天，别发送任务。'},
  {key:'device',title:'设置电脑与总控项目',target:'deviceLabel',help:'给这台电脑取一个容易区分的名字，选择负责汇总项目的总控项目。',prompt:'帮我设置派板的电脑名称和总控项目。请先确认本机派板已连接 Codex，列出当前可见的本机项目，让我选一个作为总控，并确认这台电脑的显示名称。告诉我在「设置 → 这台电脑 → 更改电脑与总控」填什么，保存后核对显示的名称和总控项目。'},
  {key:'project',title:'核对当前项目关联',target:'logicalName',help:'派板会识别源码仓库。需要手动关联时，核对当前聊天目录和逻辑项目名称。',prompt:'帮我核对派板当前项目的源码目录和逻辑项目身份。先在已确认的项目目录用 git rev-parse --show-toplevel 和 git remote -v 检查实际仓库。打开派板「设置 → 当前项目 → 调整项目身份」核对识别结果；有歧义时向我指出冲突并确认目标目录后再保存。保留已有项目身份和聊天，不执行任务。'},
  {key:'backup',title:'核对本机备份目录',target:'backupRoot',help:'安装时已选择目录的用户可直接核对。首次配置时，选择本机专用备份目录。',prompt:'帮我配置派板的本机备份目录。请先核对派板实际的程序和数据位置，再让我选择一个单独的本机绝对路径，验证没有重定向及目录重叠。告诉我在「设置 → 高级设置 → 备份位置」填什么，保存后重新读取核对。保留已有备份和运行数据。'},
  {key:'sync',title:'配置私有仓库同步（可选）',target:'syncRepo',help:'需要跨电脑同步时再设置。准备自己的 GitHub 私有仓库，并通过 GitHub CLI 登录。首次保存可关闭自动同步。',prompt:'帮我配置派板的跨电脑同步。请先运行 gh auth status 检查本机 GitHub CLI 登录，让我确认要用的仓库，再用 gh repo view <账号>/<仓库> --json nameWithOwner,visibility 核实它为 PRIVATE。如果需要新建，先确认账户和仓库名称，再用 gh repo create <账号>/<仓库> --private。告诉我在「设置 → 待办同步 → 同步设置」填写的 owner/repo 和 panel-tasks 分支，并核对我选择的同步范围。保存时保持自动同步关闭，等我确认后再启用。不要上传整个 data 目录或选择公开仓库。'}
];

function setupGuideMarkup(){
  return `<details id="setupGuide" class="workspace-advanced"><summary>首次设置</summary>${setupSteps.map(step=>`<details class="workspace-option" data-setup-step="${step.key}"><summary>${step.title}</summary><p class="hint">${step.help}</p><div class="setup-guide-actions"><button type="button" data-setup-target="${step.target}" aria-label="打开配置：${step.title}">打开配置</button><button type="button" data-setup-copy aria-label="复制 Codex 指令：${step.title}">复制 Codex 指令</button></div><textarea hidden readonly rows="5" aria-label="${step.title}的 Codex 指令"></textarea><p class="hint" role="status"></p></details>`).join('')}</details>`;
}

function initSetupGuide(openSettings,showSettingsSection){
  $('setupGuideEntry').onclick=()=>{
    openSettings(true);showSettingsSection('general');
    $('workspaceAdvanced').open=true;
    $('findInstances').focus();$('findInstances').click();
  };
  $('setupGuide').addEventListener('click',async event=>{
    const jump=event.target.closest('[data-setup-target]');
    if(jump){
      const target=$(jump.dataset.setupTarget);
      showSettingsSection(target.closest('[data-settings-section]').dataset.settingsSection);
      for(let panel=target.closest('details');panel;panel=panel.parentElement.closest('details'))panel.open=true;
      target.focus({preventScroll:true});target.scrollIntoView({block:'center'});return;
    }
    const copy=event.target.closest('[data-setup-copy]');
    if(!copy)return;
    const row=copy.closest('[data-setup-step]'),step=setupSteps.find(item=>item.key===row.dataset.setupStep);
    const field=row.querySelector('textarea'),status=row.querySelector('[role="status"]');
    field.value=step.prompt;
    try{await navigator.clipboard.writeText(step.prompt);status.textContent='已复制，粘贴到 Codex 聊天即可。';}
    catch{field.hidden=false;field.focus();field.select();status.textContent='指令已选中，按 Ctrl+C 复制。';}
  });
}
// The native launcher and the existing board dialog share the same operation.
// A global app has no source-chat context, so its selections start empty.
export function initSidebarOpener(api,getCurrent,{standalone=false}={}){
  const norm=value=>String(value??'').replace(/\\/g,'/').replace(/\/$/,'').toLowerCase();
  const host=document.createElement(standalone?'main':'dialog');host.id='openBoardDialog';host.setAttribute('aria-labelledby','openBoardTitle');
  if(standalone)host.className='native-launcher';
  const heading=standalone?'<h1 id="openBoardTitle">打开项目侧栏</h1>':'<div class="dialog-heading"><h2 id="openBoardTitle">打开侧面看板</h2><button type="button" id="closeOpenBoard" aria-label="关闭侧栏选择">×</button></div>';
  host.innerHTML=`<form id="openBoardForm">${heading}<label for="openBoardProject">项目</label><select id="openBoardProject" required></select><label for="openBoardThread">聊天</label><select id="openBoardThread" required></select><p id="openBoardHint" class="hint"></p><label class="check" title="默认复用已有看板，仅关闭后勾选，避免重复标签页"><input id="recreateBoard" type="checkbox">原看板已关闭，重新创建</label><p id="openBoardError" class="error" role="alert"></p><p id="openBoardResult" class="hint" role="status"></p><div class="dialog-actions"><button type="button" id="refreshOpenBoard">刷新列表</button><button type="submit" id="submitOpenBoard" class="primary">打开项目侧栏</button></div></form>`;
  document.body.append(host);let opening=false,refreshing=false;
  function controls(){host.querySelectorAll('button,select,input').forEach(el=>el.disabled=opening||refreshing);$('submitOpenBoard').disabled=opening||refreshing||!$('openBoardProject').value||!$('openBoardThread').value||!!getCurrent().state?.connectionError;}
  function threads(preferred=''){
    const state=getCurrent().state??{},id=$('openBoardProject').value,project=state.projects?.find(p=>p.projectId===id);
    const rows=[...new Map((state.threads??[]).filter(t=>project&&t.kind==='codex'&&t.hostId==='local'&&norm(t.cwd)===norm(project.path)).map(t=>[t.id,t])).values()];
    const candidates=standalone?[preferred]:[preferred,new URLSearchParams(location.search).get('threadId'),state.bindings?.[id],state.caller,rows.length===1?rows[0].id:''];
    const selected=candidates.find(value=>rows.some(t=>t.id===value))??'';
    $('openBoardThread').innerHTML='<option value="">选择已有聊天…</option>'+rows.map(t=>`<option value="${esc(t.id)}">${esc(t.title||t.id)}</option>`).join('');$('openBoardThread').value=selected;
    $('openBoardHint').textContent=project&&!rows.length?'此项目暂无可用聊天，请在 Codex 中打开后刷新。':'';
    controls();
  }
  function projects(id){const rows=(getCurrent().state?.projects??[]).filter(p=>p.hostId==='local'&&p.path);$('openBoardProject').innerHTML='<option value="">选择本机项目…</option>'+rows.map(p=>`<option value="${esc(p.projectId)}">${esc(p.label)}</option>`).join('');$('openBoardProject').value=rows.some(p=>p.projectId===id)?id:'';threads();}
  function open(projectId=''){projects(projectId);$('openBoardError').textContent='';$('openBoardResult').textContent='';$('recreateBoard').checked=false;if(!standalone)host.showModal();}
  if(!standalone){
    document.addEventListener('click',event=>{const button=event.target.closest('[data-open-board-project]');if(button)open(button.dataset.openBoardProject||getCurrent().projectId);});
    $('closeOpenBoard').onclick=()=>{if(!opening&&!refreshing)host.close();};host.addEventListener('cancel',event=>{if(opening||refreshing)event.preventDefault();});
  }
  $('openBoardProject').onchange=()=>{$('recreateBoard').checked=false;$('openBoardResult').textContent='';threads();};$('openBoardThread').onchange=()=>{$('recreateBoard').checked=false;$('openBoardResult').textContent='';controls();};
  $('refreshOpenBoard').onclick=async()=>{
    if(opening||refreshing)return;const id=$('openBoardProject').value,thread=$('openBoardThread').value;refreshing=true;controls();
    try{await api.post('refresh');await api.load();projects(id);threads(thread);$('openBoardError').textContent='';}catch(error){$('openBoardError').textContent=error.message;}finally{refreshing=false;controls();}
  };
  $('openBoardForm').onsubmit=async event=>{
    event.preventDefault();if(opening||refreshing||!$('openBoardProject').value||!$('openBoardThread').value)return;
    opening=true;const body={projectId:$('openBoardProject').value,threadId:$('openBoardThread').value,recreate:$('recreateBoard').checked};controls();$('openBoardError').textContent='';$('openBoardResult').textContent='';
    try{
      const result=await api.post('boards/open',body),message=result.reused?'已切换到所选聊天，保留现有看板。':result.status==='opened'?'已打开项目侧栏。':'已请求打开项目侧栏；切换到所选聊天后查看。';
      $('recreateBoard').checked=false;
      if(standalone)$('openBoardResult').textContent=message;else{host.close();api.notice(message);}
    }catch(error){$('openBoardError').textContent=error.message;}finally{opening=false;controls();}
  };
  if(standalone)open();
  return {host,open};
}

function select(id,projects,value){const el=$(id),old=el.value;if(el.closest('form')?.dataset.dirty==='true')return;el.innerHTML='<option value="">请选择…</option>'+projects.map(p=>`<option value="${esc(p.projectId)}">${esc(p.label)}</option>`).join('');el.value=value??old;}
function set(id,value){if($(id).closest('form')?.dataset.dirty!=='true')$(id).value=value??'';}
async function run(button,action){if(button?.disabled)return;if(button)button.disabled=true;try{await action();await api.load();}catch(e){api.notice(e.message,true);}finally{if(button)button.disabled=false;}}
export function observeDesktopContext(context){diagnosticUI?.observeDesktopContext(context);}

export function initHub(context){
  api=context;initVersions(context);initSidebarOpener(api,()=>current);initWorkflowInitialization(context);
  const host=document.createElement('section');host.id='workspaceHub';
  host.innerHTML=`<nav class="hub-nav" aria-label="工作区导航"><div class="hub-switch"><a id="controlLink">总控</a><a id="ownBoardLink">项目</a><a id="referencesLink">资料</a></div><div class="workspace-tools"><button id="workspaceToggle" class="device-status-button" aria-controls="workspaceConfig" aria-expanded="false" aria-label="工作区设置"><svg class="device-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg><span class="device-divider" aria-hidden="true"></span><span id="workspaceLabel">未设置电脑</span><span id="updateAvailable" hidden> · 有更新</span><span class="device-divider" aria-hidden="true"></span></button></div></nav>
    <button type="button" id="setupGuideEntry" hidden>连接 Codex</button>
    <details id="workspaceConfig" class="settings"><summary>工作区设置</summary><div class="workspace-panel-heading"><h1 id="workspaceHeading" tabindex="-1">设置</h1><nav id="workspaceSettingsNav" aria-label="设置分区"><button type="button" data-settings-target="general">常规</button><button type="button" data-settings-target="project">项目</button><button type="button" data-settings-target="sync">同步</button><button type="button" data-settings-target="storage">数据</button><button type="button" data-settings-target="updates">更新</button></nav><button type="button" id="closeWorkspace">返回</button></div><p id="workspaceSettingsNotice" role="status" aria-live="polite" hidden></p><p id="workspaceContext" hidden></p><div class="settings-body hub-settings">
    <form id="deviceForm"><h3>这台电脑</h3><p id="deviceSummary" class="hint"></p><details id="deviceSettings" class="workspace-option"><summary>更改电脑与总控</summary>${input('deviceLabel','电脑名称','deviceLabel')}<label for="controllerProject">总控项目</label><select id="controllerProject" name="controllerProjectId" required></select><button class="primary">保存</button></details></form>
    <form id="syncForm"><h3>待办同步</h3><p id="syncOverview" class="hint" role="status"></p><div class="workspace-sync-actions"><label class="check"><input id="syncAutoEnabled" name="autoEnabled" type="checkbox">自动同步</label><button type="button" id="syncNow">立即同步</button></div><details id="syncConfigDetails" class="workspace-option"><summary id="syncConfigSummary">同步设置</summary><p id="syncStatus" class="hint" role="status"></p><div id="syncConflicts"></div><p id="syncInbox" class="hint"></p>${input('syncRepo','GitHub 私有仓库','repo')}${input('syncBranch','同步分支','branch')}<label class="check"><input id="syncRichFields" name="includeRichFields" type="checkbox" checked>包含版块、依赖、标签与附件</label><p class="hint">自动同步适用于待办。立即同步还会同步当前项目的看板和资料。</p><label class="check"><input name="confirmed" type="checkbox" required>确认使用此私有仓库保存待办及所选附件</label><button>保存同步设置</button></details></form>
    <details id="workspaceAdvanced" class="workspace-advanced"><summary>高级设置</summary>
    <form id="sourceForm"><h3>已有源码目录</h3><p id="sourceEntry" class="hint"></p><label for="sourcePath">实际源码目录</label><input id="sourcePath" name="sourcePath" required placeholder="选择已有GitHub仓库的本机绝对目录"><p class="hint">会话、任务和原有待办身份保留；只关联已有仓库，不上传或移动文件。同一源码目录会保留执行占用保护。</p><button id="previewSource" type="button">核验源码目录</button><p id="sourceProof" class="hint" role="status"></p><label class="check"><input id="confirmSource" type="checkbox" required>已核对会话入口、源码目录和仓库</label><button id="saveSource" class="primary" disabled>保存源码关联</button></form>
    <form id="mappingForm"><p id="repositoryIdentity" class="hint" role="status"></p><p id="mappingPath" hidden></p><button id="selectRepoCopy" hidden type="button">用此副本同步</button>${input('logicalId','项目标识','logicalId')}${input('logicalName','项目名称','logicalName')}<label for="projectTags">标签</label><input id="projectTags" name="tags" placeholder="逗号分隔"><label class="check"><input name="confirmed" type="checkbox" required>已核对项目与目录</label><button class="primary">保存身份</button><button id="checkWorkflow" type="button">核验规范</button><p id="workflowResult" class="hint" role="status"></p></form>
    <form id="connectionForm"><h3>桌面连接</h3><p id="connectionRecoveryHint" class="hint"></p><p id="connectionDiagnostic" class="hint" hidden></p><button id="findInstances" type="button">查找实例</button><label for="instanceId">本机实例</label><select id="instanceId" name="instanceId" required></select><label for="connectionCaller">Codex 聊天链接或 ID</label><input id="connectionCaller" name="caller" list="connectionChats" required><datalist id="connectionChats"></datalist><button>保存连接</button></form>
    <form id="serviceForm"><h3>服务</h3><button type="button" id="restartPanel">重启面板</button><p id="restartPanelStatus" class="hint" role="status"></p></form></details>
    <section id="storageSettings" aria-labelledby="storageSettingsHeading"><h3 id="storageSettingsHeading">数据与备份</h3><form id="dataLocationForm" hidden><label for="dataLocation">本机数据目录</label><input id="dataLocation" name="dataRoot" required autocomplete="off"><p class="hint">填写尚未创建的新目录。搬迁会先备份并重启，原目录保留。</p><button type="submit">搬迁数据并重启</button><p id="dataLocationStatus" class="hint" role="status" aria-live="polite"></p></form>
    <details id="backupOptions" class="workspace-option" hidden><summary>备份位置</summary><form id="backupConfigForm"><label for="backupRoot">本机备份目录</label><input id="backupRoot" name="backupRoot" required autocomplete="off" placeholder="输入此电脑上的绝对目录"><button type="submit">保存备份位置</button><p id="backupConfigStatus" class="hint" role="status" aria-live="polite"></p></form></details></section>
    <section id="productUpdate" aria-labelledby="productUpdateHeading"><h3 id="productUpdateHeading">检测升级</h3><p id="updateVersion" class="hint" hidden></p><p id="updateNotes" class="hint" hidden></p><p id="updateStatus" class="hint" role="status" aria-live="polite" hidden></p><div class="product-update-actions"><button type="button" id="checkUpdate" hidden>检测升级</button><button type="button" id="applyUpdate" class="primary" hidden>一键升级</button><button type="button" id="cancelUpdate" hidden>取消升级等待</button><a id="downloadOfficialUpdate" href="https://github.com/lei0620/paiban/releases/latest" target="_blank" rel="noopener noreferrer" hidden>下载官方安装包</a></div><p id="updatePluginHint" class="hint" hidden>升级后请重新接入本聊天白板并确认插件版本。</p><p class="hint">个人非商业使用免费 · 商用需授权</p></section></div></details>
    <section id="controlView" hidden><div class="project-heading"><h1>项目</h1><button type="button" class="control-sidebar-action" data-open-board-project="">打开侧面看板</button></div><div id="projectOverview" class="project-overview"></div>
    <details class="settings"><summary>分配待办</summary><form id="allocateForm" class="settings-body"><label for="allocateProject">目标项目</label><select id="allocateProject" name="projectId" required></select>${input('allocateTitle','任务标题','title')}<label for="allocateDescription">任务内容与验收要求</label><textarea id="allocateDescription" name="description" rows="5" maxlength="30000"></textarea><div id="allocateProperties"></div><button class="primary">保存到待执行</button></form></details>
    <details id="projectCreateSettings" class="settings"><summary>新建项目或对话</summary><form id="projectForm" class="settings-body"><label for="parentProject">父项目目录</label><select id="parentProject" name="parentProjectId" required></select>${input('newProjectName','新目录名称','name')}<label class="check"><input id="createEmptyProject" name="empty" type="checkbox">创建空目录（接入已有仓库）</label><label class="check"><input name="confirmed" type="checkbox" required>确认创建目录，保留已有文件</label><button>创建项目目录</button><p id="newProjectResult" class="hint" role="status"></p></form><form id="threadForm" class="settings-body"><label for="threadProject">项目（已添加到 Codex）</label><select id="threadProject" name="projectId" required></select><label class="check"><input name="confirmed" type="checkbox" required>确认新建对话，仅发送就绪提示</label><button>新建执行对话</button><p id="newThreadResult" class="hint" role="status"></p></form></details></section>
    <dialog id="legacyResolve"><form id="legacyResolveForm"><h2>核对旧未决记录</h2><input name="id" type="hidden"><label for="legacyNote">核对说明</label><textarea id="legacyNote" name="note" required rows="3"></textarea><label class="check"><input type="checkbox" name="confirmed" required>已检查原对话，确认不会继续执行本轮</label><p class="hint">服务还会验证原对话属于本项目且已空闲。释放不代表成功，不会自动重发。</p><button type="button" id="closeLegacy">取消</button><button class="primary">核对后释放</button></form></dialog>`;
  $('notice').before(host);
  $('workspaceAdvanced').before($('productUpdate'));
  $('productUpdate').append($('productSupportTemplate').content.cloneNode(true));
  if(context.diagnosticsSupported)void import('./diagnostics.js').then(module=>{diagnosticUI=module;module.initDiagnostics(context);if(current?.state)module.updateDiagnostics(current.state,current.projectId);}).catch(error=>api.notice(error.message,true));
  const topNav=host.querySelector('.hub-nav'),tools=topNav.querySelector('.workspace-tools');document.querySelector('.app-bar .brand').after(topNav);document.querySelector('.app-bar').append(tools);$('workspaceToggle').append($('connection'));tools.append(document.querySelector('.project-sync-shortcut'));const refresh=$('refresh');refresh.type='button';refresh.className='connection-refresh';refresh.setAttribute('aria-label','刷新连接');refresh.title='重新读取项目、对话和连接状态';refresh.append(document.createTextNode('刷新连接'));$('findInstances').before(refresh);document.querySelector('.connection-wrap').remove();
  // Move the existing controls, preserving their handlers and drafts.
  const settingsBody=$('workspaceConfig').querySelector('.hub-settings');
  settingsBody.prepend($('settings'));settingsBody.insertAdjacentHTML('afterbegin',setupGuideMarkup());$('settings').open=true;
  const settingsSections={general:['setupGuide','deviceForm','workspaceAdvanced'],project:['settings'],sync:['syncForm'],storage:['storageSettings'],updates:['productUpdate']};
  for(const [key,ids] of Object.entries(settingsSections))for(const id of ids)$(id).dataset.settingsSection=key;
  const settingsTabs=$('workspaceSettingsNav').querySelectorAll('[data-settings-target]');
  let settingsSection='general';
  function showSettingsSection(key){
    settingsSection=key;
    for(const tab of settingsTabs)tab.setAttribute('aria-pressed',String(tab.dataset.settingsTarget===key));
    for(const [name,ids] of Object.entries(settingsSections))for(const id of ids)$(id).hidden=name!==key;
    if(key==='storage'){
      $('backupOptions').open=true;
      loadDataLocation();
    }
  }
  showSettingsSection(settingsSection);
  $('workspaceSettingsNav').onclick=event=>{
    const tab=event.target.closest('[data-settings-target]');
    if(tab){showSettingsSection(tab.dataset.settingsTarget);window.scrollTo(0,0);}
  };
  $('projectIdentitySettings').append($('sourceForm'),$('mappingForm'));
  $('projectOptions').append($('captureSettingsButton'),$('captureSetup'));
  // Keep allocation actions reachable before a long list of existing projects.
  const filters=document.createElement('div');filters.className='overview-filter';filters.innerHTML='<input id="projectSearch" type="search" aria-label="筛选项目" placeholder="搜索项目、名称或标签"><label class="check"><input id="mappedOnly" type="checkbox">仅已绑定</label><button type="button" id="addProjectStatus" hidden>新增状态</button>';
  $('controlView').append(filters,$('projectOverview'));projectTransferUI.init(context);
  $('projectSearch').oninput=$('mappedOnly').onchange=()=>renderHub(current.state,current.projectId);
  host.addEventListener('input',e=>{const form=e.target.closest('form');if(form)form.dataset.dirty='true';});
  let workspaceScroll={x:0,y:0};
  const workspaceVisibility=()=>{const open=$('workspaceConfig').open;document.body.classList.toggle('workspace-settings-open',open);$('workspaceToggle').setAttribute('aria-expanded',String(open));};
  const setWorkspaceOpen=open=>{
    if(open===$('workspaceConfig').open)return;
    if(open)workspaceScroll={x:scrollX,y:scrollY};$('workspaceConfig').open=open;workspaceVisibility();
    if(open){$('workspaceSettingsNotice').hidden=true;showSettingsSection(settingsSection);window.scrollTo(0,0);$('workspaceHeading').focus({preventScroll:true});}
    else{for(const id of ['workspaceAdvanced','backupOptions','syncConfigDetails','deviceSettings','projectOptions','projectIdentitySettings','legacyBindingSettings','projectMountOptions','captureSetup'])$(id).open=false;$('captureSettingsButton').setAttribute('aria-expanded','false');window.scrollTo(workspaceScroll.x,workspaceScroll.y);$('workspaceToggle').focus({preventScroll:true});}
  };
  const clearSourceProof=()=>{sourceProof=null;$('saveSource').disabled=true;$('confirmSource').checked=false;$('sourceProof').textContent='修改目录后请重新核验。';};
  $('sourcePath').oninput=()=>{$('sourceForm').dataset.dirty='true';clearSourceProof();};
  $('previewSource').onclick=e=>run(e.currentTarget,async()=>{const id=current.projectId,path=$('sourcePath').value;const result=await api.post('workspace/source/preview',{projectId:id,sourcePath:path});if(current.projectId!==id||$('sourcePath').value!==path)return;sourceProof=result;$('sourceForm').dataset.dirty='true';$('sourceProof').textContent='会话入口：'+result.path+'；源码目录：'+result.sourcePath+'；仓库：'+result.repository+'。原逻辑身份保持。';$('confirmSource').checked=false;$('saveSource').disabled=false;});
  $('sourceForm').onsubmit=e=>{e.preventDefault();if(!sourceProof)return;const proof=sourceProof;run(e.submitter,async()=>{await api.post('workspace/source',{...proof,sourcePath:$('sourcePath').value,confirmed:$('confirmSource').checked});sourceProof=null;$('sourceForm').dataset.dirty='false';$('saveSource').disabled=true;$('confirmSource').checked=false;await api.load();api.notice('源码关联已保存，会话和任务保留。');});};
  $('workspaceToggle').onclick=()=>setWorkspaceOpen(!$('workspaceConfig').open);
  $('closeWorkspace').onclick=()=>setWorkspaceOpen(false);
  initSetupGuide(setWorkspaceOpen,showSettingsSection);
  $('workspaceConfig').addEventListener('toggle',workspaceVisibility);
  $('workspaceConfig').addEventListener('invalid',e=>{for(let section=e.target.closest('details');section&&section!==$('workspaceConfig');section=section.parentElement.closest('details'))section.open=true;},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('workspaceConfig').open&&!document.querySelector('dialog[open]')){e.preventDefault();setWorkspaceOpen(false);}});
  const submit=(id,route,make,done)=>{$(id).onsubmit=e=>{e.preventDefault();const form=e.currentTarget,data=make(values(form));run(e.submitter,async()=>{const r=await api.post(route,data);form.dataset.dirty='false';await done?.(r,form);api.notice('设置已保存。');});};};
  submit('deviceForm','workspace/setup',v=>v);
  submit('mappingForm','workspace/map',v=>({...v,projectId:current.projectId,tags:v.tags.split(/[,，]/).map(s=>s.trim()).filter(Boolean),confirmed:v.confirmed==='on'}));
  $('selectRepoCopy').onclick=e=>run(e.currentTarget,async()=>{
    const project=current.state.projects.find(row=>row.projectId===current.projectId);
    if(!project?.repository)return;
    await api.post('workspace/select-repository',{projectId:project.projectId,repository:project.repository});
    await api.load();
  });
  submit('syncForm','sync/setup',v=>({...v,confirmed:v.confirmed==='on',includeRichFields:v.includeRichFields==='on',autoEnabled:v.autoEnabled==='on'}));
  $('syncAutoEnabled').onchange=async()=>{if(!current.state?.sync?.config)return;try{await api.post('sync/auto',{enabled:$('syncAutoEnabled').checked});await api.load();}catch(e){api.notice(e.message,true);}};
  submit('connectionForm','connection/setup',v=>v);
  submit('allocateForm','tasks/create',v=>({...v,...readTypeInput($('allocateProperties')),priority:Number(v.priority??2),execution:{mode:v.executionMode??'match',unit:(v.executionUnit||v.title).trim().slice(0,80),parallel:v.executionParallel==='on',threadId:''},dependsOn:[...$('allocateDependencies').selectedOptions].map(o=>o.value),attributeIds:Object.fromEntries([...$('allocateProperties').querySelectorAll('[data-allocate-group]')].map(el=>[el.dataset.allocateGroup,el.value]).filter(([,value])=>value)),requestId:$('allocateForm').dataset.requestId??=crypto.randomUUID()}),(r,form)=>{form.reset();delete form.dataset.requestId;});
  $('allocateProject').addEventListener('change',()=>renderAllocationProperties());
  $('allocateProperties').addEventListener('focusin',async e=>{
    if(e.target.id!=='allocateDependencies'||!api.reader)return;const select=e.target,id=$('allocateProject').value;
    try{const rows=await api.reader.allChoices(id);if(!select.isConnected||$('allocateProject').value!==id)return;const selected=new Set([...select.selectedOptions].map(o=>o.value));select.innerHTML=rows.map(t=>`<option value="${esc(t.id)}" ${selected.has(t.id)?'selected':''}>${esc(t.title)}</option>`).join('');}catch(error){api.notice(error.message,true);}
  });
  $('allocateForm').addEventListener('input',()=>{delete $('allocateForm').dataset.requestId;});
  submit('projectForm','projects/create',v=>({...v,confirmed:v.confirmed==='on',empty:v.empty==='on'}),r=>{$('newProjectResult').textContent=r.project.path+'。'+r.message;});
  submit('threadForm','threads/create',v=>({...v,confirmed:v.confirmed==='on',requestId:$('threadForm').dataset.requestId??=crypto.randomUUID()}),r=>{$('newThreadResult').textContent=r.receipt?.threadId?'已创建执行对话，请刷新后选择并保存绑定。任务 ID：'+r.receipt.threadId:r.status==='uncertain'?'创建结果未确认，请在 Codex 核对，不能重复创建。':'创建已提交，等待桌面完成后刷新绑定列表。';});
  $('threadProject').addEventListener('change',()=>{delete $('threadForm').dataset.requestId;});
  submit('legacyResolveForm','jobs/resolve-uncertain',v=>({...v,confirmed:v.confirmed==='on'}),()=>{$('legacyResolve').close();});
  $('closeLegacy').onclick=()=>$('legacyResolve').close();
  $('restartPanel').onclick=restartPanel;
  $('checkUpdate').onclick=()=>updateAction('check');
  $('applyUpdate').onclick=()=>updateAction('apply');
  $('cancelUpdate').onclick=()=>updateAction('cancel');
  let lastDataInstance='',relocationInstance='';
  async function loadDataLocation(){
    const service=current.state?.service,form=$('dataLocationForm');
    if(!service?.dataLocationSupported||form.dataset.dirty==='true'||relocationInstance===service.instanceId)return;
    const instance=service.instanceId;
    lastDataInstance=instance;
    try{
      const result=await api.post('service/data-location',{});
      if(current.state?.service?.instanceId!==instance||form.dataset.dirty==='true')return;
      $('dataLocation').value=result.dataRoot;
      $('dataLocationStatus').textContent=service.dataLocationError||(relocationInstance?'数据已搬迁，原目录保留。':'');
      relocationInstance='';
    }catch(error){$('dataLocationStatus').textContent=error.message;}
  }
  reconnectDataLocation=service=>{
    $('dataLocationForm').hidden=!service?.dataLocationSupported;
    if(settingsSection==='storage'&&service?.instanceId!==lastDataInstance)void loadDataLocation();
  };
  $('dataLocationForm').onsubmit=async event=>{
    event.preventDefault();
    const form=event.currentTarget,button=event.submitter??form.querySelector('button'),input=$('dataLocation');
    const value=input.value.trim(),instanceId=current.state?.service?.instanceId,status=$('dataLocationStatus');
    if(relocationInstance===instanceId||button.disabled)return;
    if([...$('workspaceConfig').querySelectorAll('form[data-dirty="true"]')].some(other=>other!==form)){status.textContent='请先保存其他设置，再搬迁数据。';return;}
    button.disabled=true;input.readOnly=true;status.textContent='正在核对数据位置…';
    try{
      const result=await api.post('service/data-location',{dataRoot:value,instanceId});
      form.dataset.dirty='false';
      if(result.changed){relocationInstance=instanceId;status.textContent='正在备份并搬迁数据，面板会自动重连。';}
      else status.textContent='当前已使用此数据目录。';
    }catch(error){status.textContent=error.message;}
    finally{button.disabled=false;input.readOnly=false;}
  };
  let backupRead=0,backupDirty=false;
  $('backupRoot').addEventListener('input',()=>{backupDirty=true;});
  $('backupOptions').addEventListener('toggle',()=>{
    if(!$('backupOptions').open||!current.state?.service?.backupConfigSupported)return;
    const revision=++backupRead;
    $('backupConfigStatus').textContent='正在读取备份位置…';
    void api.post('service/backup-config',{}).then(result=>{
      if(revision!==backupRead||!$('backupOptions').open||backupDirty)return;
      $('backupRoot').value=result.backupRoot??'';
      $('backupConfigStatus').textContent=result.backupRoot?'已配置本机备份位置。':'尚未配置；涉及 C 盘的备份操作需要先设置。';
    }).catch(error=>{if(revision===backupRead)$('backupConfigStatus').textContent=error.message;});
  });
  $('backupConfigForm').onsubmit=e=>{e.preventDefault();const button=e.submitter??$('backupConfigForm').querySelector('button[type="submit"]'),value=$('backupRoot').value.trim();
    if(button.disabled)return;button.disabled=true;$('backupConfigStatus').textContent='正在保存备份位置…';
    backupRead++;
    void api.post('service/backup-config',{backupRoot:value}).then(()=>{backupDirty=$('backupRoot').value.trim()!==value;if(!backupDirty)$('backupConfigForm').dataset.dirty='false';$('backupConfigStatus').textContent=backupDirty?'已保存原位置；当前修改尚未保存。':'备份位置已保存。';}).catch(error=>{$('backupConfigStatus').textContent=error.message;}).finally(()=>{button.disabled=false;});
  };
  initRestartDialog();
  $('checkWorkflow').onclick=e=>run(e.currentTarget,async()=>{const r=await api.post('workflow/check',{projectId:current.projectId});$('workflowResult').textContent=(r.status==='ready'?'结构检查通过，任务开始时仍需核实实际命令和安全规则。':'需要补齐：'+r.missing.join('、'))+' '+r.note;});
  $('findInstances').onclick=e=>run(e.currentTarget,async()=>{
    const r=await api.post('connection/instances');
    $('instanceId').innerHTML='<option value="">请选择…</option>'+r.instances.map(i=>`<option value="${esc(i.id)}">${esc(i.label)}</option>`).join('');
    if(r.selected)$('instanceId').value=r.selected;
    else if(r.instances.length===1)$('instanceId').value=r.instances[0].id;
    $('connectionChats').replaceChildren(...(r.candidates??[]).map(chat=>new Option(chat.title||chat.id,chat.id)));
  });
  $('syncNow').onclick=e=>run(e.currentTarget,async()=>{
    const {state,projectId}=current,mapping=state.workspace?.mappings?.[projectId];
    const project=state.projects.find(row=>row.projectId===projectId);
    if(state.sync?.config&&project?.repositoryReason&&(mapping?.localOnly||!mapping))throw Error(project.repositoryReason);
    const scoped=state.service?.projectBoardSyncSupported&&state.sync?.config?.schemaVersion>=2&&mapping&&!mapping.localOnly;
    let result;
    try{result=await api.post('sync/run',scoped?{projectId}:{});}
    catch(error){await api.load();throw error;}
    api.notice(result.board?`同步完成：${result.count} 项待执行、当前项目 ${result.board.cards} 张审阅及已完成卡片、${result.board.references} 张资料卡。`:`同步完成，${result.count} 项待执行。`);
  });
  document.addEventListener('click',e=>{
    const resolve=e.target.closest('[data-resolve-legacy]');if(resolve){$('legacyResolveForm').reset();$('legacyResolveForm').elements.id.value=resolve.dataset.resolveLegacy;$('legacyResolve').showModal();}
    const conflict=e.target.closest('[data-conflict]');if(conflict)run(conflict,async()=>{await api.post('sync/resolve',{id:conflict.dataset.conflict,use:conflict.dataset.use});api.notice('已记录选择，请点击同步完成合并。');});
    const boardConflict=e.target.closest('[data-board-sync-conflict]');if(boardConflict)run(boardConflict,async()=>{
      await api.post('sync/resolve',{projectId:current.projectId,boardConflictId:boardConflict.dataset.boardSyncConflict,use:boardConflict.dataset.use});
      api.notice('已记录选择，请点击同步完成合并。');
    });
    const archive=e.target.closest('[data-archive]');if(archive)run(archive,()=>api.post('tasks/archive',{id:archive.dataset.archive}));
    const release=e.target.closest('[data-release-sync]');if(release&&confirm('请先核对其他电脑和原对话，确认本轮没有执行。解除后需要重新同步，是否继续？'))run(release,()=>api.post('sync/release',{id:release.dataset.releaseSync,confirmed:true}));
  });
}
export function renderHub(state,projectId,{projectHref}={}){
  diagnosticUI?.updateDiagnostics(state,projectId);
  current={state,projectId};projectTransferUI.render(state);
  const health=state.service?.catalogHealth;
  $('connectionRecoveryHint').textContent=state.connectionError?(state.service?.catalogRecoverySupported?'连接中断，正在自动重连。':'连接异常，请刷新连接。'):'';
  $('connectionDiagnostic').textContent=health?.reason?'诊断信息：'+health.reason+(health.retryAt?'；下次自动检查：'+new Date(health.retryAt).toLocaleTimeString('zh-CN'):''):'';
  $('connectionDiagnostic').hidden=!health?.reason;
  $('restartPanel').disabled=restartPending||!state.service?.restartSupported;
  $('backupOptions').hidden=!state.service?.backupConfigSupported;
  renderProductUpdate(state.service);
  reconnectDataLocation?.(state.service);
  renderRestart(state);
  const w=state.workspace??{mappings:{}},project=state.projects.find(p=>p.projectId===projectId),mapping=w.mappings?.[projectId];
  $('setupGuideEntry').hidden=!!state.caller;
  $('setupGuide').querySelector('[data-setup-target="logicalName"]').disabled=!project;
  $('setupGuide').querySelector('[data-setup-step="backup"]').hidden=!state.service?.backupConfigSupported;
  const controller=state.projects.find(p=>p.projectId===w.controllerProjectId),reason=w.projects?.find(p=>p.projectId===projectId)?.reason;
  $('repositoryIdentity').textContent=project?.repositoryReason||(project?.repository?'源码仓库 '+project.repository:mapping?.localOnly||project?.offlineOnly?'本地项目':'正在识别源码仓库');
  $('selectRepoCopy').hidden=!project?.repository||!project.repositoryReason||!mapping?.localOnly;
  const controlAddress=viewAddress(location.href,{projectId:w.controllerProjectId??'',view:'control'});
  $('controlLink').href=controlAddress.href;
  const ownAddress=viewAddress(location.href,{view:'project',projectHref});
  if(!ownAddress.searchParams.get('projectId')&&projectId)ownAddress.searchParams.set('projectId',projectId);
  const addressParams=new URLSearchParams(location.search),currentView=addressParams.get('view');
  $('ownBoardLink').href=addressParams.get('projectId')===projectId&&!['control','versions','references'].includes(currentView)?location.href:ownAddress.href;
  const controllerLabel=controller?.label||w.mappings?.[w.controllerProjectId]?.logicalName||(w.controllerProjectId?'已保存，待连接':'未选择');
  $('deviceSummary').textContent=(w.deviceLabel||'未设置电脑')+' · 总控：'+controllerLabel;
  $('settings').hidden=!project;$('projectSettingsName').textContent=project?.label||'当前项目';
  $('projectSettingsSummary').textContent=(reason?'项目配置待核对':mapping?.automatic?'项目已自动识别':mapping?'项目已关联':'项目待识别')+' · 对话按版块分配';
  $('githubUpgradeSettings').hidden=!!project?.repository||!!mapping?.sourcePath;
  const identity=`电脑：${w.deviceLabel||'未设置'} · 逻辑项目：${mapping?.logicalName||'未绑定'} · 总控：${controllerLabel}`;
  renderWorkflowInitialization(state,projectId);
  $('workspaceContext').textContent=identity;
  $('workspaceLabel').textContent=w.deviceLabel||'未设置电脑';$('workspaceLabel').title=w.deviceLabel||'未设置电脑';
  $('updateAvailable').hidden=!state.service?.releaseCheck?.available;
  const settingsLabel='设置：'+(w.deviceLabel||'未设置电脑')+'，'+$('connection').textContent+(state.service?.releaseCheck?.available?'，有软件更新':'');
  $('workspaceToggle').setAttribute('aria-label',settingsLabel);$('workspaceToggle').title=settingsLabel;
  if(sourceProjectId!==projectId){sourceProjectId=projectId;sourceProof=null;$('sourceForm').dataset.dirty='false';$('sourcePath').value='';$('confirmSource').checked=false;$('saveSource').disabled=true;}
  $('sourceForm').hidden=!project;$('sourceEntry').textContent=project?'会话入口：'+project.path+'（保留原目录）':'';
  if($('sourceForm').dataset.dirty!=='true'){$('sourcePath').value=mapping?.sourcePath??'';$('sourceProof').textContent=mapping?.sourcePath?'已关联：'+mapping.sourceRepository+'。可核验同仓库的其他源码目录。':'填写已有源码仓库目录后核验；无需重复上传。';}
  $('previewSource').disabled=!state.service?.sourceBindingSupported;
  if(!state.service?.sourceBindingSupported)$('sourceProof').textContent='面板更新完成后可关联源码目录。';
  $('mappingForm').hidden=!project;$('mappingPath').textContent=project?project.label+' · '+project.path:'';
  set('deviceLabel',w.deviceLabel);select('controllerProject',state.projects,w.controllerProjectId);
  set('logicalId',mapping?.logicalId);set('logicalName',mapping?.logicalName);set('projectTags',mapping?.tags?.join('，'));
  set('syncRepo',state.sync?.config?.repo);set('syncBranch',state.sync?.config?.branch??'panel-tasks');set('connectionCaller',state.caller);
  const versions=currentView==='versions',references=currentView==='references'&&state.service?.projectReferencesSupported===true;
  const control=!!w.controllerProjectId&&projectId===w.controllerProjectId&&currentView==='control';
  document.querySelector('.project-sync-shortcut').hidden=!project||control||versions||references;
  $('controlView').hidden=!control;if(control||versions)$('projectView').hidden=true;
  $('versionLink').href=viewAddress(location.href,{projectId,view:'versions'}).href;updateVersions(state,projectId,versions);
  const referencesAddress=viewAddress(ownAddress.href,{view:'references'});
  $('referencesLink').href=referencesAddress.href;
  $('referencesLink').hidden=state.service?.projectReferencesSupported!==true;
  for(const [id,active] of [['controlLink',control],['ownBoardLink',!control&&!references],['referencesLink',references],['versionLink',versions]]){if(active)$(id).setAttribute('aria-current','page');else $(id).removeAttribute('aria-current');}
  if(control)renderProjectOverview(state,w,projectId);
  else projectBoardUI?.render(null);
  for(const id of ['allocateProject','parentProject','threadProject'])select(id,state.projects);renderAllocationProperties();
  const sync=state.sync??{},automatic=sync.automatic??{};if($('syncForm').dataset.dirty!=='true'){$('syncRichFields').checked=sync.config?sync.config.schemaVersion>=2:true;$('syncAutoEnabled').checked=!!automatic.enabled;}const phase={disabled:'手动同步',waiting:'等待同步',syncing:'同步中',idle:'自动同步已就绪',retrying:'稍后重试',blocked:'等待处理'}[automatic.status]??'尚未同步';$('syncStatus').textContent=(sync.running?'同步中…':phase)+(sync.error||automatic.error?' · '+(sync.error||automatic.error):'')+(sync.lastSync?' · 上次 '+new Date(sync.lastSync).toLocaleTimeString():'');$('syncNow').disabled=!!sync.running||!sync.config;
  const syncProblem=sync.error||automatic.error;
  $('syncOverview').textContent=sync.running?'同步中…':syncProblem?'同步暂时受阻':phase;
  $('syncOverview').title=syncProblem||'';$('syncConfigSummary').textContent=syncProblem?'查看同步问题':'同步设置';
  const taskConflicts=(sync.conflicts??[]).map(c=>`<details><summary>冲突：${esc(c.local?.title??c.remote?.title??c.id)}</summary><h3>本机</h3><pre>${esc(syncConflictText(c.local))}</pre><h3>远端</h3><pre>${esc(syncConflictText(c.remote))}</pre><button type="button" data-conflict="${esc(c.id)}" data-use="local">保留本机</button><button type="button" data-conflict="${esc(c.id)}" data-use="remote">保留远端</button></details>`).join('');
  const boardConflicts=(sync.boardConflicts??[]).map(({id,local,remote,choice})=>`<details><summary>看板冲突：${esc(local?.title??remote?.title??local?.name??remote?.name??'卡片分组')}${choice?'（已选择）':''}</summary><h3>本机</h3><pre>${esc(boardConflictText(local))}</pre><h3>远端</h3><pre>${esc(boardConflictText(remote))}</pre><button type="button" data-board-sync-conflict="${esc(id)}" data-use="local" aria-pressed="${choice==='local'}">保留本机</button><button type="button" data-board-sync-conflict="${esc(id)}" data-use="remote" aria-pressed="${choice==='remote'}">保留远端</button></details>`).join('');
  const conflicts=taskConflicts+boardConflicts;if($('syncConflicts').innerHTML!==conflicts)$('syncConflicts').innerHTML=conflicts;
  $('syncInbox').textContent=sync.inbox?.length?'有 '+sync.inbox.length+' 项待办尚未绑定到本机项目，逻辑标识：'+[...new Set(sync.inbox.map(r=>r.logicalId))].join('、'):'';
}

function renderProjectOverview(state,workspace,projectId){
  const tasks=(state.tasks??[]).filter(task=>!task.archivedAt);
  const search=$('projectSearch').value.trim().toLowerCase(),mappedOnly=$('mappedOnly').checked;
  const board=state.projectBoard;
  const visible=state.projects.filter(project=>{
    const mapping=workspace.mappings?.[project.projectId];
    const description=board?.cards[project.projectId]?.description;
    return (!mappedOnly||mapping)&&(!search||[project.label,mapping?.logicalName,...(mapping?.tags??[]),description].join(' ').toLowerCase().includes(search));
  });
  const renderCard=(project,details,canWrite)=>{
    const id=project.projectId,mapping=workspace.mappings?.[id],logical=mapping?.logicalName?.trim();
    const differentName=logical&&logical.toLowerCase()!==String(project.label??'').trim().toLowerCase();
    const metadata=[differentName?esc(logical):'',...(mapping?.tags??[]).map(tag=>`<span class="tag">${esc(tag)}</span>`)].filter(Boolean).join(' ');
    const counts=state.projectSummaries?.find(row=>row.projectId===id)?.counts;
    const own=counts?[]:tasks.filter(task=>task.projectId===id);
    const countHtml=[['todo','待执行'],['running','执行中'],['review','待审阅'],['done','已完成']].map(([key,label])=>{
      const count=counts?.[key]??own.filter(task=>taskLane(task,state)===key).length;
      return count?`<span><strong>${esc(count)}</strong>${label}</span>`:'';
    }).join('');
    const title=details?`<h3>${esc(project.label)}</h3><span class="project-level">${esc(details.level)} 级</span>`:`<h2>${esc(project.label)}</h2>`;
    const edit=canWrite?`<button type="button" data-project-board-action="save-project" data-id="${esc(id)}" aria-label="编辑项目 ${esc(project.label)}">编辑</button>`:'';
    return `<article class="overview-card"><div class="overview-card-heading">${title}</div>${details?.description?`<p class="project-card-description">${esc(details.description)}</p>`:''}${metadata?`<p class="hint">${metadata}</p>`:''}${countHtml?`<div class="overview-counts">${countHtml}</div>`:''}<div class="overview-actions"><a href="/?projectId=${encodeURIComponent(id)}&view=project">打开项目看板 →</a><button type="button" data-open-board-project="${esc(id)}">打开侧面看板</button>${edit}</div></article>`;
  };
  if(board&&!projectBoardModule){
    projectBoardModule=import('./project-board.js').then(module=>{
      projectBoardUI=module.initProjectBoard(api,$('controlView'));
      if(!$('controlView').hidden)renderProjectOverview(current.state,current.state.workspace,current.projectId);
    }).catch(error=>{projectBoardModule=undefined;api.notice(error.message,true);});
  }
  if(board&&projectBoardUI){
    projectBoardUI.render({board,projectId,visible,projects:state.projects,filtering:!!search||mappedOnly,canWrite:!state._snapshot&&!state.service?.restarting,instanceId:state.service?.instanceId,renderCard});
    return;
  }
  projectBoardUI?.render(null);
  const list=$('projectOverview');
  list.className='project-overview';
  list.hidden=!visible.length;
  const html=visible.sort((a,b)=>Number(b.projectId===projectId)-Number(a.projectId===projectId)).map(project=>renderCard(project)).join('');
  if(list.innerHTML!==html)list.innerHTML=html;
}

function renderAllocationProperties(){const id=$('allocateProject').value,groups=projectPropertyGroups(current.state??{},id),key=JSON.stringify([id,groups]);if($('allocateProperties').dataset.key===key)return;$('allocateProperties').dataset.key=key;$('allocateProperties').innerHTML='<label>优先级<select name="priority">'+['P0 紧急','P1 高','P2 普通','P3 低'].map((name,i)=>'<option value="'+i+'" '+(i===2?'selected':'')+'>'+name+'</option>').join('')+'</select></label>'+groups.filter(g=>!g.archived).map(g=>propertyInput(g,g.id==='type'?'feature':'','allocate')).join('')+'<h3>执行安排</h3><label>对话方式<select name="executionMode"><option value="match">自动匹配</option><option value="new">新建模块对话</option></select></label><label>所属模块<input name="executionUnit" maxlength="80" placeholder="默认使用任务标题"></label><details><summary>依赖与并行</summary><label>前置任务<select id="allocateDependencies" multiple size="3">'+(current.state?.tasks??[]).filter(t=>t.projectId===id&&!t.archivedAt).map(t=>'<option value="'+esc(t.id)+'">'+esc(t.title)+'</option>').join('')+'</select></label><label class="check"><input type="checkbox" name="executionParallel">可与其他独立模块并行</label></details><p class="hint">同名模块复用已分配对话；未匹配则新建，保存不会立即执行。</p>';}

function renderProductUpdate(service={}){
  const release=service.releaseCheck??{},maintenance=service.maintenance,waiting=maintenance?.status==='waiting'&&maintenance.kind==='product-update';
  $('updateVersion').hidden=!release.supported&&!service.productVersion;
  $('updateVersion').textContent='派板 · Paiban · 当前版本 '+(service.productVersion??'未知')+(release.available?' · 最新版 '+release.version:'');
  $('downloadOfficialUpdate').hidden=service.productInstalled===true;
  $('checkUpdate').hidden=!release.supported;
  $('updateStatus').hidden=!release.supported&&release.status!=='error';
  $('updatePluginHint').hidden=!waiting;
  $('updateNotes').hidden=!release.available;
  $('updateNotes').textContent=release.available?'更新说明：\n'+release.notes:'';
  const checkMessage=release.status==='error'?(release.message||'检测升级失败，可以稍后重试。'):release.status==='idle'?'从派板官方 GitHub Releases 检测。':release.available?(service.releaseApplySupported?'发现新版本，可点击一键升级。':'发现新版本，可下载官方安装包。'):'当前没有可用更新。';
  $('updateStatus').textContent=waiting?'等待升级：'+(maintenance.reason||'正在等待安全条件')+'。可以取消等待。':maintenance?.kind==='product-update'&&maintenance.error?'升级未完成：'+maintenance.error:updateMessage||checkMessage;
  $('checkUpdate').disabled=updateBusy||waiting||!!service.restarting;
  $('applyUpdate').hidden=!release.available||waiting||!service.releaseApplySupported;
  $('applyUpdate').disabled=updateBusy||!service.releaseApplySupported||!!service.restarting;
  $('cancelUpdate').hidden=!waiting;
  $('cancelUpdate').disabled=updateBusy||!!service.restarting;
}
async function updateAction(action){
  if(updateBusy)return;
  if(action==='apply'&&document.querySelector('#workspaceHub form[data-dirty="true"]')){updateMessage='请先保存未保存的设置，再升级。';renderProductUpdate(current.state?.service);return;}
  updateBusy=true;updateMessage=action==='check'?'正在检查更新…':action==='apply'?'正在下载并校验更新，请保持面板运行…':'正在取消升级等待…';renderProductUpdate(current.state?.service);
  try{
    if(action==='check'){await api.post('service/check-update',{});updateMessage='';}
    else if(action==='cancel'){const result=await api.post('service/cancel-update',{instanceId:current.state.service.instanceId});updateMessage=result.message;}
    else{await api.post('service/stage-update',{});updateMessage='下载和校验完成，正在申请安全升级…';renderProductUpdate(current.state?.service);await api.post('service/apply-update',{});updateMessage='升级请求已提交；面板重启后请重新连接。';}
    try{await api.load();}catch{if(action!=='apply')throw Error('操作已提交，但状态读取失败；请刷新面板核对。');}
  }catch(error){updateMessage=error.message||'操作未完成，请稍后重试。';}
  finally{updateBusy=false;renderProductUpdate(current.state?.service);}
}
function restartStatus(message){$('restartPanelStatus').textContent=message;}
function initRestartDialog(){
  const dialog=document.createElement('dialog');dialog.id='restartDialog';dialog.setAttribute('aria-labelledby','restartTitle');
  dialog.innerHTML='<div class="dialog-heading"><h2 id="restartTitle">更新公共面板</h2><button type="button" id="closeRestart" aria-label="关闭重启提示">×</button></div><p class="hint">所有项目共用此面板。当前任务继续执行，后续队列暂候；重启后继续原活动计划，已暂停的保持暂停。</p><div id="restartImpact"></div><p id="restartWaitStatus" role="status" class="hint"></p><p id="restartError" role="alert" class="error"></p><div class="dialog-actions"><button type="button" id="cancelRestart">暂不重启</button><button type="button" id="confirmRestart" class="primary">安全重启</button></div>';
  document.body.append(dialog);$('closeRestart').onclick=()=>dialog.close();
  $('confirmRestart').onclick=async()=>{
    if(restartPending)return;restartPending=true;renderRestart(current.state);$('restartError').textContent='';
    try{const before=current.state.service.instanceId;await api.post('service/restart',{instanceId:before,whenIdle:true,confirmed:true});restartInstance=before;await api.load();}
    catch(error){$('restartError').textContent=error.message;}finally{restartPending=false;renderRestart(current.state);}
  };
  $('cancelRestart').onclick=async()=>{
    if(restartPending)return;
    if(current.state.service?.maintenance?.status!=='waiting'){dialog.close();return;}
    restartPending=true;renderRestart(current.state);
    try{await api.post('service/restart/cancel',{instanceId:current.state.service.instanceId});restartInstance=null;await api.load();dialog.close();}
    catch(error){$('restartError').textContent=error.message;}finally{restartPending=false;renderRestart(current.state);}
  };
}
function renderRestart(state){
  const service=state.service??{},waiting=service.maintenance?.status==='waiting',rows=service.impact??[];
  const dirtySettings=!!document.querySelector('form[data-dirty="true"]');
  if(service.instanceId&&!observedInstance)observedInstance=service.instanceId;
  if(service.instanceId&&observedInstance!==service.instanceId&&state.lastSync&&!state.connectionError&&!dirtySettings){observedInstance=service.instanceId;restartInstance=null;location.reload();return;}
  if(restartInstance&&service.instanceId!==restartInstance&&state.lastSync&&!state.connectionError&&!dirtySettings){restartInstance=null;location.reload();return;}
  if(waiting)restartInstance=service.instanceId;
  const message=service.maintenance?.error||(waiting?(rows.some(r=>r.uncertain)?'有发送状态未确认的任务，请先核对原对话；不会重发或强制重启。':'等待当前任务结束，随后自动重启；可以取消等待。'):service.restartSupported?'安全重启会保留队列；原活动计划自动继续，已暂停的保持暂停。':'当前启动方式不支持重启，请从启动面板入口启动。');
  if(!restartPending)restartStatus(message);
  if(!$('restartDialog'))return;
  $('restartImpact').innerHTML=rows.length?rows.map(r=>`<p><strong>${esc(r.name)}</strong><br><span class="hint">${r.running} 项处理中 · ${r.queued} 项已排队 · ${r.activePlans} 组将继续 · ${r.pausedPlans} 组保持暂停</span></p>`).join(''):'<p>当前没有待恢复的执行安排。</p>';
  $('restartWaitStatus').textContent=message;
  $('confirmRestart').textContent=waiting?'正在等待':rows.some(r=>r.running)?'等待完成后重启':'安全重启';
  $('confirmRestart').disabled=restartPending||waiting||!service.restartSupported;
  $('cancelRestart').textContent=waiting?'取消等待':'暂不重启';$('cancelRestart').disabled=restartPending;
}
async function restartPanel(){
  if(!current.state.service?.maintenanceSupported)return restartPanelLegacy();
  if(document.querySelector('#workspaceHub form[data-dirty="true"]')){api.notice('请先保存未保存的设置，再重启面板。',true);return;}
  $('restartError').textContent='';renderRestart(current.state);$('restartDialog').showModal();
}
async function restartPanelLegacy(){
  if(restartPending)return;
  if(document.querySelector('#workspaceHub form[data-dirty="true"]')){api.notice('请先保存未保存的设置，再重启面板。',true);return;}
  restartPending=true;const before=current.state.service?.instanceId;
  $('restartPanel').disabled=true;
  restartStatus('正在检查并备份运行数据…');
  try{
    try{await api.post('service/restart',{instanceId:before});}
    catch(error){let observed;try{observed=await(await fetch('/api/state',{signal:AbortSignal.timeout(2000)})).json();}catch{}if(observed?.service?.instanceId===before&&!observed.service.restarting)throw error;}
    restartStatus('正在重启，等待服务恢复…');
    for(let attempt=0;attempt<45;attempt++){
      await new Promise(resolve=>setTimeout(resolve,1000));
      try{const response=await fetch('/api/state',{signal:AbortSignal.timeout(1500)});if(!response.ok)continue;const state=await response.json();if(state.service?.instanceId&&state.service.instanceId!==before&&state.lastSync&&!state.connectionError){restartStatus('已恢复，正在刷新页面…');location.reload();return;}}catch{}
    }
    throw Error('服务尚未恢复，请核对启动终端；未自动重复提交重启请求。');
  }catch(error){restartStatus(error.message);api.notice(error.message,true);}
  finally{restartPending=false;$('restartPanel').disabled=!current.state.service?.restartSupported;}
}

function syncConflictText(r){return !r?'不存在':JSON.stringify({状态:r.deleted?'已移出待执行':'待执行',标题:r.title,说明:r.description,优先级:r.priority===undefined?'P2':'P'+r.priority,标签:r.attributes??r.tag,...(r.structure?{版块:r.structure.section?.name??'无',依赖任务ID:r.structure.dependsOn,来源:r.structure.sourceKey||'无'}:{}),...(r.workflow?{讨论状态:r.workflow.stage,父任务ID:r.workflow.parentId??'无'}:{}),附件:(r.attachments??[]).map(a=>({名称:a.name,大小:a.size,哈希:a.sha256}))},null,2);}
function boardConflictText(row){
  if(!row)return '已移除';
  const {title,name,body,description,url,groupId,parentId,tags,attachments,status}=row;
  return JSON.stringify({标题:title,名称:name,内容:body??description,链接:url,状态:({review:'待审阅',done:'已完成'})[status],分组:groupId,上级:parentId,标签:tags,附件:attachments?.map(file=>file.name)},null,2);
}

// Keep project intake on the existing static entry so old backends remain usable.
const projectTransferUI=(()=>{
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=v=>String(v??'').replaceAll('\\','/').replace(/\/$/,'').toLowerCase();
let api,state={},selected=null,busy=false,opener=null;
const requestKey=(offer,project,thread)=>'project-adopt:'+JSON.stringify([offer.id,offer.commit,project.path,thread]);
function updateTargets(preferred=''){
  const project=state.projects?.find(p=>p.projectId===$('adoptProject').value),rows=(state.threads??[]).filter(t=>t.kind==='codex'&&t.hostId==='local'&&project&&norm(t.cwd)===norm(project.path));
  $('adoptPath').textContent=project?.path||'选择在本机创建或添加的项目文件夹。';
  $('adoptThread').innerHTML='<option value="">选择已有执行对话…</option>'+rows.map(t=>`<option value="${esc(t.id)}">${esc(t.title||t.id)}</option>`).join('');
  $('adoptThread').value=rows.some(t=>t.id===preferred)?preferred:rows.length===1?rows[0].id:'';
  const registered=project&&(!project.projectId.startsWith('panel-')||project.desktopProjectId);
  $('adoptHint').textContent=!registered?'请先将此文件夹添加到 Codex，再用总控下方的入口创建执行对话，完成后刷新列表。':!rows.length?'请先在该文件夹创建执行对话，再刷新列表。':'选择空文件夹，或本项目已有的干净仓库；点击后才开始接入和部署。';
  $('submitAdoption').disabled=!registered||!rows.length||!!state.connectionError||busy;
}
function updateProjects(preferred=''){
  const rows=(state.projects??[]).filter(p=>p.hostId==='local'&&p.path&&!/^(?:[e-z]:|\\\\)/i.test(p.path));
  $('adoptProject').innerHTML='<option value="">选择本机项目文件夹…</option>'+rows.map(p=>`<option value="${esc(p.projectId)}">${esc(p.label)} · ${esc(p.path)}</option>`).join('');
  $('adoptProject').value=rows.some(p=>p.projectId===preferred)?preferred:'';updateTargets();
}
function initProjectTransfers(context){
  api=context;
  const section=document.createElement('section');section.id='projectTransferInbox';section.className='settings';section.hidden=true;section.setAttribute('aria-labelledby','projectTransferTitle');
  section.innerHTML='<div class="transfer-heading"><h2 id="projectTransferTitle">待接入项目</h2><button type="button" id="createTransferDirectory">新建空目录</button><button type="button" id="refreshProjectTransfers">刷新清单</button></div><p id="projectTransferStatus" class="hint" role="status" hidden></p><div id="projectTransferList"></div>';
  $('controlView').querySelector('.project-heading').after(section);
  const dialog=document.createElement('dialog');dialog.id='projectAdoptionDialog';dialog.setAttribute('aria-labelledby','projectAdoptionTitle');
  dialog.innerHTML='<form id="projectAdoptionForm"><div class="dialog-heading"><h2 id="projectAdoptionTitle">接入并部署项目</h2><button type="button" id="closeAdoption" aria-label="关闭项目接入">×</button></div><p id="adoptSource" class="hint"></p><label for="adoptProject">部署到此项目文件夹</label><select id="adoptProject" required></select><p id="adoptPath" class="hint"></p><label for="adoptThread">执行对话</label><select id="adoptThread" required></select><p id="adoptHint" class="hint"></p><p id="adoptError" class="error" role="alert"></p><div class="dialog-actions"><button type="button" id="refreshAdoptionTargets">刷新列表</button><button id="submitAdoption" class="primary">部署到此文件夹</button></div></form>';
  document.body.append(dialog);
  $('createTransferDirectory').onclick=()=>{$('projectCreateSettings').open=true;$('createEmptyProject').checked=true;$('newProjectName').focus();$('projectCreateSettings').scrollIntoView({block:'start'});};
  $('refreshProjectTransfers').onclick=async e=>{const button=e.currentTarget;if(busy)return;button.disabled=true;try{const r=await api.post('projects/transfers/refresh',{projectId:state.workspace?.controllerProjectId});state={...state,projectTransfers:r.projectTransfers};renderProjectTransfers(state);await api.load();}catch(error){$('projectTransferStatus').textContent=error.message;$('projectTransferStatus').hidden=false;}finally{button.disabled=false;}};
  section.addEventListener('click',e=>{const button=e.target.closest('[data-adopt-project]');if(!button)return;selected=state.projectTransfers?.projects.find(p=>p.id===button.dataset.adoptProject);if(!selected)return;opener=button;const existing=state.projects?.find(p=>p.repository===selected.repository);updateProjects(existing?.projectId);$('adoptSource').textContent=selected.name+' · '+selected.repository+' · '+selected.branch+' · '+selected.commit.slice(0,10);$('adoptError').textContent='';dialog.showModal();});
  $('adoptProject').onchange=()=>updateTargets();
  $('closeAdoption').onclick=()=>{if(!busy)dialog.close();};dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('close',()=>opener?.isConnected&&opener.focus());
  $('refreshAdoptionTargets').onclick=async()=>{if(busy)return;const id=$('adoptProject').value,thread=$('adoptThread').value;try{await api.post('projects/transfers/refresh',{projectId:state.workspace?.controllerProjectId});await api.load();updateProjects(id);updateTargets(thread);}catch(error){$('adoptError').textContent=error.message;}};
  $('projectAdoptionForm').onsubmit=async e=>{
    e.preventDefault();if(busy||!selected)return;
    const project=state.projects?.find(p=>p.projectId===$('adoptProject').value),threadId=$('adoptThread').value;if(!project||!threadId)return;
    const offer=selected,key=requestKey(offer,project,threadId);let requestId;
    try{requestId=localStorage.getItem(key);if(!requestId){requestId='adopt-'+crypto.randomUUID();localStorage.setItem(key,requestId);}}catch{$('adoptError').textContent='无法保存接入请求，请保持现场并检查浏览器存储；尚未发送。';return;}
    busy=true;dialog.querySelectorAll('button,select').forEach(el=>el.disabled=true);$('adoptError').textContent='';
    let accepted=false;
    try{await api.post('projects/adopt',{offerId:offer.id,commit:offer.commit,projectId:project.projectId,path:project.path,threadId,requestId});accepted=true;try{localStorage.removeItem(key);}catch{}dialog.close();}
    catch(error){$('adoptError').textContent=error.message+'；原请求标识已保留，重试不会重复安排。';}
    finally{busy=false;dialog.querySelectorAll('button,select').forEach(el=>el.disabled=false);updateTargets(threadId);}
    if(accepted)try{await api.load();}catch(error){api.notice('接入已安排，页面刷新失败；请查看原执行记录，避免重复部署。'+error.message,true);}
  };
}
function renderProjectTransfers(next){
  state=next;if(!$('projectTransferInbox'))return;
  const transfers=state.projectTransfers??{},projects=transfers.projects??[],mappings=Object.values(state.workspace?.mappings??{});
  $('refreshProjectTransfers').disabled=!state.service?.projectTransferSupported||!transfers.configured;
  $('createTransferDirectory').disabled=!state.service?.projectTransferSupported;
  $('createEmptyProject').disabled=!state.service?.projectTransferSupported;if(!state.service?.projectTransferSupported)$('createEmptyProject').checked=false;
  $('projectTransferStatus').textContent=transfers.error||'';$('projectTransferStatus').hidden=!transfers.error;
  const incoming=state.service?.projectTransferSupported?projects.filter(p=>!mappings.some(m=>(m.sourceRepository===p.repository||m.repository===p.repository&&m.logicalId===p.logicalId))):[];
  $('projectTransferInbox').hidden=!incoming.length;
  const adoptions=transfers.adoptions??[];
  const key=JSON.stringify([incoming,adoptions]);if($('projectTransferList').dataset.key===key)return;$('projectTransferList').dataset.key=key;
  $('projectTransferList').innerHTML=incoming.map(p=>{
    const job=[...adoptions].reverse().find(j=>j.offerId===p.id),active=job&&['queued','sending','submitted','running','uncertain'].includes(job.status);
    return `<article><h3>${esc(p.name)}</h3><p class="hint">${esc(p.repository)} · ${esc(p.branch)} · ${esc(p.commit.slice(0,10))}</p>${job?`<p class="hint">${esc(job.error||job.message||job.status)}</p><button type="button" data-open="${esc(job.threadId)}">查看原执行对话</button> `:''}<button type="button" data-adopt-project="${esc(p.id)}" ${active?'disabled':''}>${active?'已有接入安排':'部署到本机文件夹'}</button></article>`;
  }).join('');
}

return {init:initProjectTransfers,render:renderProjectTransfers};
})();
