import {panelLocation} from './read-client.js';

const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let api,current,report,busy=false,version=0,currentKey='';
const reference=row=>[['任务',row.taskId],['执行',row.jobId],['安排',row.planId],['对话',row.threadId]].filter(([,value])=>value).map(([label,value])=>`${label} ${value}`).join(' · ');
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
  try{
    const value=await api.reader.get('diagnostics',{projectId:current.projectId,...(captured.endsWith(':control')?{scope:'control'}:{})});
    if(generation!==version||captured!==scope())return;
    report=value;
    $('diagnosticStatus').textContent='';render();
  }
  catch(error){if(generation===version)$('diagnosticStatus').textContent=error.message;}
  finally{busy=false;$('diagnosticRefresh').disabled=false;if(generation===version)render();}
}
export function initDiagnostics(context){
  api=context;
  const section=document.createElement('details');section.className='workspace-option';section.innerHTML='<summary>故障日志</summary><button id="diagnosticOpen" type="button">查看故障日志</button>';$('serviceForm').after(section);
  const dialog=document.createElement('dialog');dialog.id='diagnosticDialog';dialog.setAttribute('aria-labelledby','diagnosticTitle');dialog.innerHTML='<div class="dialog-heading"><h2 id="diagnosticTitle">故障日志</h2><button id="diagnosticClose" type="button" aria-label="关闭故障日志">×</button></div><p id="diagnosticStatus" class="hint" role="status"></p><div class="dialog-actions"><button id="diagnosticRefresh" type="button">刷新记录</button><button id="diagnosticExport" type="button" disabled>导出诊断 JSON</button></div><div id="diagnosticRows" class="diagnostic-rows" tabindex="0" role="region" aria-label="故障与阻塞记录"></div>';document.body.append(dialog);
  $('diagnosticOpen').onclick=()=>{dialog.showModal();void load();};$('diagnosticClose').onclick=()=>dialog.close();$('diagnosticRefresh').onclick=()=>void load();
  $('diagnosticExport').onclick=()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='leix-diagnostics-'+new Date().toISOString().replaceAll(':','-')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
}
export function updateDiagnostics(state,projectId){
  const previous=currentKey;current={state,projectId};currentKey=projectId+':'+(new URL(panelLocation.href).searchParams.get('view')==='control'?'control':'project');$('diagnosticOpen').disabled=!state.service?.diagnosticsSupported||!projectId;
  if(previous!==scope()){version++;report=null;$('diagnosticRows').textContent='';$('diagnosticExport').disabled=true;if($('diagnosticDialog').open)$('diagnosticDialog').close();}
}
