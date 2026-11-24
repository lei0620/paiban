import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {normalize} from './core.mjs';
import {attachmentFields,attachmentPath,readAttachment} from './attachments.mjs';

const script=fileURLToPath(new URL('./scripts/fill-composer.ps1',import.meta.url));
const reject=message=>{throw Object.assign(Error(message),{notApplied:true});};
export function composerInput(input,state,catalog,root,origin,{verifyFiles=true}={}){
  if(typeof input.requestId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.requestId))reject('缺少有效填入请求标识');
  if(typeof input.description!=='string'||!input.description.trim()||input.description.length>30000)reject('请填写不超过 30,000 字符的任务内容');
  const project=catalog.projects.find(p=>p.projectId===input.projectId),thread=catalog.threads.find(t=>t.id===input.threadId);
  if(!project?.path||!thread||thread.kind!=='codex'||thread.hostId!=='local'||normalize(thread.cwd)!==normalize(project.path))reject('当前窗口对话不属于本机所选项目，请在所属聊天侧栏打开任务编辑器');
  let files;
  try{files=attachmentFields(state,input.projectId,input.attachmentIds);if(verifyFiles)for(const file of files)readAttachment(root,file);}catch(error){reject(error.message);}
  return {origin,projectId:project.projectId,threadId:thread.id,threadTitle:thread.title,description:input.description,
    files:files.map(file=>({id:file.id,name:file.name,path:attachmentPath(root,file),size:file.size,sha256:file.sha256}))};
}

export function runWindowsComposer(input,{probe=false,timeoutMs=45000}={}){
  if(process.platform!=='win32')return Promise.resolve({status:'failed',text:'not-filled',attachmentsAdded:[],retrySafe:true,message:'发送窗口仅支持本机 Windows 桌面'});
  return new Promise(resolve=>{
    const started=performance.now();
    let finished=false,output='',tooLarge=false;
    const child=spawn('pwsh.exe',['-NoProfile','-NonInteractive','-STA','-File',script,...(probe?['-Probe']:[]),...(input.submit===true?['-Submit']:[])],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const finish=result=>{if(finished)return;finished=true;clearTimeout(timer);if(input.timing===true&&result.timing?.version===1)result.timing.roundTripMs=Math.round((performance.now()-started)*1000)/1000;resolve(result);};
    const unknown=()=>({status:'uncertain',text:'uncertain',attachmentsAdded:[],retrySafe:false,message:input.submit===true?'聊天发送结果未确认，请核对原聊天及输入框；不会自动重发':'窗口操作结果未确认，请核对当前输入框；不会自动重复填入'});
    const timer=setTimeout(()=>{child.kill();finish(unknown());},timeoutMs);
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;if(output.length>65536){tooLarge=true;child.kill();}});
    // Diagnostics must never include task text, clipboard contents or attachment paths.
    child.stderr.resume();child.stdin.on('error',()=>{});
    child.on('error',()=>finish({status:'failed',text:'not-filled',attachmentsAdded:[],retrySafe:true,message:'无法启动 Windows 窗口辅助，请检查 PowerShell 7'}));
    child.on('close',()=>{
      try{const result=JSON.parse(output.trim());if(tooLarge||!['filled','partial','failed','uncertain','invoked','ready'].includes(result.status)||!['filled','not-filled','uncertain'].includes(result.text)||!Array.isArray(result.attachmentsAdded))throw Error();finish(result);}catch{finish(unknown());}
    });
    child.stdin.end(JSON.stringify(input));
  });
}

const composerSignature=input=>createHash('sha256').update(JSON.stringify({projectId:input.projectId,threadId:input.threadId,description:input.description,files:input.files.map(({id,name})=>({id,name})),...(input.submit===true?{submit:true}:{})})).digest('hex');
const canonicalSubmitSignature=input=>composerSignature({...input,submit:true,description:String(input.description??'').trim().replaceAll('\r\n','\n')});
// The helper records partial only before it tries the normal Send button.
const definitelyNotSubmitted=result=>(result.status==='partial'&&result.text==='filled')||(result.status==='failed'&&result.retrySafe===true&&result.text==='not-filled'&&result.attachmentsAdded.length===0);
const legacyStopsBeforeSubmit=new Set([
  '当前桌面窗口已变化，已停止填入',
  '无法唯一核对当前聊天与侧栏，请在所属聊天打开侧栏后重试'
]);

function blocksUnrelatedSend(record){
  if(record.canonicalSubmitSignature)return false;
  const {status,text,attachmentsAdded,message}=record.result;
  // These exact legacy messages can only come from the window checks before Send.
  return !(status==='uncertain'&&text==='uncertain'&&attachmentsAdded.length===0&&legacyStopsBeforeSubmit.has(message));
}

// Persist the reservation before touching the desktop. Lost receipts and restarts
// can only replay the result, never invoke the helper a second time.
export class ComposerFiller{
  constructor({root,run=runWindowsComposer}){
    this.file=path.join(root,'data','composer-receipts.jsonl');this.run=run;this.receipts=new Map();this.active=null;this.fault='';
    try{for(const line of fs.readFileSync(this.file,'utf8').split('\n').filter(Boolean)){
      const record=JSON.parse(line);if(typeof record.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(record.id)||!/^[a-f0-9]{64}$/.test(record.signature)||(record.canonicalSubmitSignature!==undefined&&!/^[a-f0-9]{64}$/.test(record.canonicalSubmitSignature))||!['filled','partial','failed','uncertain','invoked'].includes(record.result?.status)||!['filled','not-filled','uncertain'].includes(record.result?.text)||!Array.isArray(record.result?.attachmentsAdded))throw Error();this.receipts.set(record.id,record);
    }}catch(error){if(error.code!=='ENOENT')this.fault='窗口填入回执损坏，请先核对原输入框；已停止填入以免重复';}
  }
  append(record){
    fs.mkdirSync(path.dirname(this.file),{recursive:true});const fd=fs.openSync(this.file,'a');
    try{fs.writeFileSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);}catch(error){this.fault='窗口填入回执写入失败，已停止后续填入';throw error;}finally{fs.closeSync(fd);}
  }
  notSubmitted(id,input){
    if(this.fault||this.active?.id===id||input.submit!==true)return false;
    const signature=composerSignature(input),record=this.receipts.get(id);
    if(!record||record.signature!==signature||!definitelyNotSubmitted(record.result))return false;
    let latest;
    for(const candidate of this.receipts.values())if(candidate.signature===signature)latest=candidate;
    return latest===record;
  }
  hasUnconfirmedSubmit(input,{includeUnscopedLegacy=false}={}){
    if(includeUnscopedLegacy&&this.fault)return true;
    const signature=composerSignature({...input,submit:true}),canonical=canonicalSubmitSignature(input);
    // Keep matching receipts protected. An unscoped legacy receipt also blocks
    // other sends unless its helper result proves it stopped before submission.
    return [...this.receipts.values()].some(record=>{
      if(!['partial','uncertain'].includes(record.result.status)||definitelyNotSubmitted(record.result))return false;
      return record.signature===signature||record.canonicalSubmitSignature===canonical||includeUnscopedLegacy&&blocksUnrelatedSend(record);
    });
  }
  fill(id,input){
    if(this.fault)reject(this.fault);
    const signature=composerSignature(input),old=this.receipts.get(id);
    if(old){if(old.signature!==signature)reject('请求标识已用于其他填入内容');return this.active?.id===id?this.active.promise:Promise.resolve({...old.result,replayed:true});}
    if(input.submit===true&&this.hasUnconfirmedSubmit(input))reject('这条消息的上次窗口操作尚待核对，不会另行发送');
    if(this.active)reject('正在填入窗口，请完成后再操作');
    const record={id,signature,...(input.submit===true?{canonicalSubmitSignature:canonicalSubmitSignature(input)}:{}),result:{status:'uncertain',text:'uncertain',attachmentsAdded:[],retrySafe:false,message:'上次填入回执待核对；不会自动重复填入'}};
    this.receipts.set(id,record);
    try{this.append(record);}catch(error){return Promise.reject(Object.assign(Error('窗口填入回执无法保存，尚未操作桌面'),{notApplied:true}));}
    const promise=Promise.resolve().then(()=>this.run(input)).then(result=>{
      if(!result||!['filled','partial','failed','uncertain','invoked'].includes(result.status)||!['filled','not-filled','uncertain'].includes(result.text)||!Array.isArray(result.attachmentsAdded))throw Error('invalid helper receipt');
      if(result.status==='invoked'&&input.submit!==true)throw Error('unexpected submit receipt');const added=new Set(input.files.map(f=>f.id));if(result.attachmentsAdded.some(id=>!added.has(id)))throw Error('invalid attachment receipt');
      if(['filled','invoked'].includes(result.status)&&(result.text!=='filled'||new Set(result.attachmentsAdded).size!==input.files.length))throw Error('incomplete helper receipt');
      const receipt={status:result.status,text:result.text,attachmentsAdded:[...new Set(result.attachmentsAdded)],message:String(result.message??''),retrySafe:result.status==='failed'&&result.text==='not-filled'&&result.attachmentsAdded.length===0&&result.retrySafe===true};
      record.result=receipt;this.append(record);return input.timing===true&&result.timing?{...receipt,timing:result.timing}:receipt;
    }).catch(()=>{
      // Keep the durable pre-operation uncertain receipt when recording fails.
      record.result={status:'uncertain',text:'uncertain',attachmentsAdded:[],retrySafe:false,message:'填入结果未确认，请核对当前聊天；不会自动重试'};return record.result;
    }).finally(()=>{this.active=null;});
    this.active={id,promise};return promise;
  }
}

// Direct chat messages reserve a local receipt before the desktop RPC. No task
// or execution queue is involved; desktop busy/input handling stays native.
export class DirectThreadSender{
  constructor({root,send}){
    this.file=path.join(root,'data','thread-message-receipts.jsonl');this.send=send;this.records=new Map();this.active=new Map();this.fault='';
    try{for(const line of fs.readFileSync(this.file,'utf8').split('\n').filter(Boolean)){
      const r=JSON.parse(line);
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(r.id)||!/^[a-f0-9]{64}$/.test(r.signature)||typeof r.projectId!=='string'||typeof r.threadId!=='string'||!['sending','submitted','uncertain'].includes(r.status))throw Error('invalid message receipt');
      if(r.status==='sending')r.status='uncertain';this.records.set(r.id,r);
    }}catch(error){if(error.code!=='ENOENT')this.fault='消息回执无法核对，请检查原对话；本次未发送';}
  }
  append(record){
    fs.mkdirSync(path.dirname(this.file),{recursive:true});const fd=fs.openSync(this.file,'a');
    try{fs.writeFileSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);}catch(error){this.fault='消息回执写入失败，请核对原对话';throw error;}finally{fs.closeSync(fd);}
  }
  submit(id,input){
    if(this.fault)reject(this.fault);
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))reject('缺少有效消息请求标识');
    const signature=createHash('sha256').update(JSON.stringify(input)).digest('hex'),old=this.records.get(id);
    if(old){if(old.signature!==signature)reject('请求标识已用于其他消息，请核对原对话');return this.active.get(id)??Promise.resolve({status:old.status==='sending'?'uncertain':old.status,replayed:true});}
    if([...this.records.values()].some(r=>r.threadId===input.threadId&&(r.status==='sending'||r.status==='uncertain'&&r.signature===signature)))reject('原对话有消息回执待核对，请先查看原对话；不会重复发送');
    const record={id,signature,projectId:input.projectId,threadId:input.threadId,status:'sending'};
    try{this.append(record);}catch{reject('消息回执无法保存，本次未发送');}this.records.set(id,record);
    const promise=Promise.resolve().then(()=>this.send(input)).then(result=>{
      if(result?.threadId!==input.threadId)throw Error('unknown message receipt');
      record.status='submitted';this.append(record);return {status:'submitted'};
    }).catch(()=>{
      record.status='uncertain';try{this.append(record);}catch{}return {status:'uncertain'};
    }).finally(()=>this.active.delete(id));
    this.active.set(id,promise);return promise;
  }
}
