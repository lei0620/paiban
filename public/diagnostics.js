import {panelLocation} from './read-client.js';

const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let api,current,report,busy=false,version=0,currentKey='';
let desktopReport,renderedDesktopReport,desktopFlight,desktopVersion='',desktopPage='',unconfirmedAt=0,followWarning=false;
const reference=row=>[['任务',row.taskId],['执行',row.jobId],['安排',row.planId],['对话',row.threadId]].filter(([,value])=>value).map(([label,value])=>`${label} ${value}`).join(' · ');
const desktopStates={pass:'通过',fail:'异常',pending:'待实测'};
const desktopEnabled=()=>current?.state.service?.desktopCheckSupported===true&&!current.state.service.nativeMode&&!!new URL(panelLocation.href).searchParams.get('panelSession')&&!['control','versions'].includes(new URL(panelLocation.href).searchParams.get('view'));

function updateDesktopPage(){
  const page=panelLocation.href;
  if(desktopPage===page)return;
  desktopPage=page;desktopReport=null;unconfirmedAt=0;followWarning=false;
  $('desktopCheckStatus').textContent='此对话尚未自检。';
}
function renderDesktopCheck(){
  const rows=desktopReport?.rows??[];
  const alert=followWarning?'当前聊天待确认，可打开独立看板记任务。':'';
  $('desktopCheckNotice').hidden=!desktopEnabled()||!alert;
  if($('desktopCheckMessage').textContent!==alert)$('desktopCheckMessage').textContent=alert;
  if(alert&&current.projectId){
    const url=new URL('/',panelLocation.href);
    url.searchParams.set('projectId',current.projectId);
    url.searchParams.set('standalone','1');
    $('standaloneBoard').href=url.href;
  }
  $('desktopCheckRun').disabled=!!desktopFlight;
  if(renderedDesktopReport!==desktopReport){
    renderedDesktopReport=desktopReport;
    $('desktopCheckRows').innerHTML=rows.map(row=>`<li><div><strong>${esc(row.label)}</strong><span data-status="${esc(row.status)}">${esc(desktopStates[row.status])}</span></div><p class="hint">${esc(row.detail)}</p></li>`).join('');
  }
}
async function loadDesktopCheck(){
  if(desktopFlight||!desktopEnabled()||document.hidden)return;
  const pageUrl=panelLocation.href,observedVersion=desktopVersion;
  const flight=api.reader.get('desktop-check',{pageUrl});
  desktopFlight=flight;
  $('desktopCheckStatus').textContent='正在检查当前 Codex 窗口…';renderDesktopCheck();
  try{
    const value=await flight;
    if(panelLocation.href!==pageUrl||observedVersion!==desktopVersion)return;
    desktopReport=value;
    $('desktopCheckStatus').textContent=(value.hostVersion?'Codex '+value.hostVersion+' · ':'')+new Date(value.checkedAt).toLocaleString('zh-CN');
  }catch(error){
    if(panelLocation.href===pageUrl&&observedVersion===desktopVersion)$('desktopCheckStatus').textContent=error.message;
  }finally{desktopFlight=null;renderDesktopCheck();}
}
export function observeDesktopContext(context){
  if(!desktopEnabled()||document.hidden||context.pageUrl!==panelLocation.href)return;
  updateDesktopPage();
  if(context.hostVersion&&context.hostVersion!==desktopVersion){
    desktopVersion=context.hostVersion;desktopReport=null;unconfirmedAt=0;
    $('desktopCheckStatus').textContent='等待核对当前项目对话。';
  }
  const page=new URL(context.pageUrl);
  const confirmed=context.status==='confirmed'&&context.projectId===page.searchParams.get('projectId')&&context.threadId===(page.searchParams.get('threadId')??'');
  const now=Date.now();
  if(confirmed){unconfirmedAt=0;followWarning=false;}
  else if(context.status==='unresolved'&&context.matched===true){unconfirmedAt||=now;followWarning=now-unconfirmedAt>=5000;}
  else{unconfirmedAt=0;followWarning=false;}
  renderDesktopCheck();
}
function scope(){return currentKey;}
function render(){
  $('diagnosticExport').disabled=!report||busy;
  $('diagnosticRows').title=report?.note||'';
  if(!report){$('diagnosticRows').textContent='';return;}
  const blockers=report.blockers.length?`<h3 title="暂停记录不代表正在执行">待核对（${report.blockers.length}）</h3>`+report.blockers.map(row=>`<article class="diagnostic-row"><strong>${esc(row.message)}</strong><p>${esc(row.status)} · ${esc(row.code)}</p><p class="hint">${esc(reference(row))}</p></article>`).join(''):'';
  const items=report.items.length?`<h3>故障与状态变化（${report.items.length}）</h3>`+report.items.map(row=>`<article class="diagnostic-row"><strong>${esc(row.message)}</strong><p>${esc(new Date(row.lastAt).toLocaleString('zh-CN'))} · ${esc(row.phase)} · ${esc(row.code)}${row.hostVersion?' · Codex '+esc(row.hostVersion):''}${row.count>1?' · 重复 '+row.count+' 次':''}</p><p class="hint">${esc(row.id)}${row.errorSignature?' · 指纹 '+esc(row.errorSignature):''}</p><p class="hint">${esc(reference(row))}</p>${row.bytes?`<p>日志大小 ${(row.bytes/1048576).toFixed(1)} MiB / 上限 ${(row.limitBytes/1048576).toFixed(0)} MiB</p>`:''}<p>${esc(row.hint)}</p></article>`).join(''):'';
  $('diagnosticRows').innerHTML=(report.storageError?`<p class="error">${esc(report.storageError)}</p>`:'')+blockers+(report.blockersTruncated?'<p class="hint">记录已截断，请按项目查看。</p>':'')+items+(!blockers&&!items&&!report.storageError&&!report.blockersTruncated?'<p class="hint">暂无记录</p>':'');
}
async function load(){
  if(busy||!current?.projectId)return;
  const captured=scope(),generation=++version;busy=true;$('diagnosticRefresh').disabled=true;$('diagnosticStatus').textContent='正在读取本机记录…';render();
  try{const value=await api.reader.get('diagnostics',{projectId:current.projectId,...(captured.endsWith(':control')?{scope:'control'}:{})});if(generation!==version||captured!==scope())return;report=value;$('diagnosticStatus').textContent='';render();}
  catch(error){if(generation===version)$('diagnosticStatus').textContent=error.message;}
  finally{busy=false;$('diagnosticRefresh').disabled=false;if(generation===version)render();}
}
export function initDiagnostics(context){
  api=context;
  const section=document.createElement('details');section.className='workspace-option';section.innerHTML='<summary>故障日志</summary><button id="diagnosticOpen" type="button">查看故障日志</button>';$('serviceForm').after(section);
  const dialog=document.createElement('dialog');dialog.id='diagnosticDialog';dialog.setAttribute('aria-labelledby','diagnosticTitle');dialog.innerHTML='<div class="dialog-heading"><h2 id="diagnosticTitle">故障日志</h2><button id="diagnosticClose" type="button" aria-label="关闭故障日志">×</button></div><p id="diagnosticStatus" class="hint" role="status"></p><div class="dialog-actions"><button id="diagnosticRefresh" type="button">刷新记录</button><button id="diagnosticExport" type="button" disabled>导出诊断 JSON</button></div><div id="diagnosticRows" class="diagnostic-rows" tabindex="0" role="region" aria-label="故障与阻塞记录"></div>';document.body.append(dialog);
  $('diagnosticOpen').onclick=()=>{dialog.showModal();void load();};$('diagnosticClose').onclick=()=>dialog.close();$('diagnosticRefresh').onclick=()=>void load();
  $('diagnosticExport').onclick=()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='leix-diagnostics-'+new Date().toISOString().replaceAll(':','-')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const openCheck=document.createElement('button');openCheck.id='desktopCheckOpen';openCheck.type='button';openCheck.textContent='Codex 兼容性自检';openCheck.hidden=true;section.append(openCheck);
  const banner=document.createElement('div');banner.id='desktopCheckNotice';banner.className='desktop-check-notice';banner.hidden=true;banner.innerHTML='<span id="desktopCheckMessage" role="status"></span><a id="standaloneBoard" target="_blank" rel="noopener">打开独立看板</a>';
  $('projectTitle').closest('.project-heading').after(banner);
  const check=document.createElement('dialog');check.id='desktopCheckDialog';check.setAttribute('aria-labelledby','desktopCheckTitle');
  check.innerHTML='<div class="dialog-heading"><h2 id="desktopCheckTitle">Codex 兼容性自检</h2><button id="desktopCheckClose" type="button" aria-label="关闭自检">×</button></div><p id="desktopCheckStatus" class="hint" role="status">等待检查当前项目对话。</p><ul id="desktopCheckRows" class="desktop-check-rows"></ul><div class="dialog-actions"><button id="desktopCheckRun" type="button">重新检查</button></div>';
  document.body.append(check);
  openCheck.onclick=()=>{check.showModal();if(!desktopReport)void loadDesktopCheck();};
  $('desktopCheckClose').onclick=()=>check.close();
  $('desktopCheckRun').onclick=()=>void loadDesktopCheck();
}
export function updateDiagnostics(state,projectId){
  const previous=currentKey;current={state,projectId};currentKey=projectId+':'+(new URL(panelLocation.href).searchParams.get('view')==='control'?'control':'project');$('diagnosticOpen').disabled=!state.service?.diagnosticsSupported||!projectId;
  if(previous!==scope()){version++;report=null;$('diagnosticRows').textContent='';$('diagnosticExport').disabled=true;if($('diagnosticDialog').open)$('diagnosticDialog').close();}
  $('desktopCheckOpen').hidden=!desktopEnabled();
  if(desktopEnabled())updateDesktopPage();
  if(!desktopEnabled()&&$('desktopCheckDialog').open)$('desktopCheckDialog').close();
  renderDesktopCheck();
}
