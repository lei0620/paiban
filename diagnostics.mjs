import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {nativeReads,nativeWrites} from './plugins/leix-panel-probe/native-policy.mjs';
import {handoffPending} from './handoff-state.mjs';

const routes=new Set(['/api/state','/api/native/session',...[...nativeReads].map(name=>'/api/view/'+name),...[...nativeWrites].map(name=>'/api/'+name)]);
const sourcePrefix=pathToFileURL(path.dirname(fileURLToPath(import.meta.url))+path.sep).href;
let sourceNames=new Set(['server.mjs','diagnostics.mjs']);try{sourceNames=new Set(fs.readdirSync(path.dirname(fileURLToPath(import.meta.url))).filter(name=>/^[\w.-]+\.mjs$/.test(name)));}catch{}

const id=value=>typeof value==='string'&&/^[\p{L}\p{N}_.:-]{1,110}$/u.test(value)&&!/[a-f0-9]{48}/i.test(value)?value:undefined;
// Never serialize request bodies, headers, desktop responses or Error objects.
export function diagnosticText(value){return String(value??'').slice(0,8000)
  .replace(/(["']?(?:token|authorization|password|secret|api[_-]?key|prompt|description|content)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi,'$1[已隐去]')
  .replace(/Bearer\s+[^\s,;]+/gi,'Bearer [已隐去]')
  .replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi,'[地址已隐去]')
  .replace(/[A-Za-z]:[\\/][^\s"'<>，；]+/g,'[路径已隐去]')
  .replace(/(?:\/[^\s/"'<>]+){2,}/g,'[路径已隐去]')
  .replace(/\b(?:sk-[A-Za-z0-9_-]+|[A-Za-z0-9_=-]{48,})\b/g,'[已隐去]')
  .replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,600);}

const reasons={THREAD_READ_TOO_LARGE:'对话日志超过64 MiB，自动读取已停止。',THREAD_READ_UNVERIFIED:'无法安全核对对话日志大小或索引。',THREAD_LOG_MISSING:'目标对话的本机日志缺失。',RECEIPT_UNCONFIRMED:'原发送或创建回执未确认，保留占用。',PLAN_PAUSED:'安排已暂停，需核对节点或原执行。',DEPENDENCY_WAIT:'前置任务尚未满足本轮结束或审阅条件。',CONTEXT_UNVERIFIED:'项目、目录或对话归属尚未可靠确认。',EXECUTION_WAIT:'执行或安排仍保留占用，等待安全放行。',MODEL_WAIT:'目标模型待核对或重新分配。',MODEL_REALLOCATION:'当前默认模型变化，需重新分配。',CATALOG_UNVERIFIED:'桌面活动状态未完成可靠核验。',SCOPE_UNKNOWN:'并行修改范围未知，保留等待。',SCOPE_OVERLAP:'模块、对话或修改范围存在冲突。',MAINTENANCE_WAIT:'安全更新或服务维护门禁尚未解除。',SYNC_WAIT:'同步仍在运行或保留未决回执。',STORAGE_FAULT:'存储异常，业务写入已受保护。',TASK_CHANGED:'任务内容或状态已变化，原安排需核对。',BLOCK_CHANGED:'此条等待或异常状态已变化；不代表任务已验收。',OPERATION_FAILED:'操作失败；请结合错误指纹、阶段和源码定位排查。',ENOENT:'所需本机文件不存在。',EACCES:'本机文件访问被拒绝。',EPERM:'本机文件操作权限不足。',ENOSPC:'本机存储空间不足。',COMMIT_UNKNOWN:'业务提交结果未知，不能自动重试。'};
export function diagnosticCode(error){
  if(Object.hasOwn(reasons,error?.code??''))return error.code;
  const text=String(error?.message??error??'');
  if(/64\s*MiB/.test(text))return 'THREAD_READ_TOO_LARGE';
  if(/未决|未确认|回执待核对/.test(text))return 'RECEIPT_UNCONFIRMED';
  if(/暂停/.test(text))return 'PLAN_PAUSED';
  if(/前置|依赖/.test(text))return 'DEPENDENCY_WAIT';
  if(/维护|安全更新|重启/.test(text))return 'MAINTENANCE_WAIT';
  if(/范围.*未知|修改范围.*明确/.test(text))return 'SCOPE_UNKNOWN';
  if(/重叠|同模块|同版块|同一对话/.test(text))return 'SCOPE_OVERLAP';
  if(/同步/.test(text))return 'SYNC_WAIT';
  if(/存储|写入失败/.test(text))return 'STORAGE_FAULT';
  if(/任务.*变化|内容.*修改/.test(text))return 'TASK_CHANGED';
  if(/目录|归属|当前.*项目.*变化/.test(text))return 'CONTEXT_UNVERIFIED';
  if(/空闲|占用|同项目|同模块|等待.*结束/.test(text))return 'EXECUTION_WAIT';
  if(/模型/.test(text))return 'MODEL_WAIT';
  return 'OPERATION_FAILED';
}
const hints={THREAD_READ_TOO_LARGE:'对话日志超过读取上限；退回再执行不会缩小日志。请到原对话核对；未决仅在确认空闲后按原流程处理。',RECEIPT_UNCONFIRMED:'核对关联的原对话与回执；未决不代表仍在运行，也不能据此自动重发。',PLAN_PAUSED:'查看关联计划及节点原因，处理原因后继续原安排；重新建卡不会清除旧安排。',DEPENDENCY_WAIT:'检查前置任务本轮结束或审阅条件。',CONTEXT_UNVERIFIED:'核对本机项目、对话及目录归属。',EXECUTION_WAIT:'检查关联执行、暂停计划、同步或接续占用；仅看进行中列表不足以排除这些记录。',MODEL_WAIT:'核对当前默认模型及目标对话的实际模型。'};
const frames=error=>{
  if(!(error instanceof Error)||typeof error.message!=='string'||error.message.length>8000||typeof error.stack!=='string'||!/^[A-Za-z]{1,32}$/.test(error.name))return [];
  const header=error.name+': '+error.message;if(!error.stack.startsWith(header))return [];
  return error.stack.slice(header.length,header.length+4096).split('\n').slice(0,12).filter(line=>/^\s+at\s/.test(line)).flatMap(line=>{const start=line.indexOf(sourcePrefix);if(start<0)return [];const match=line.slice(start+sourcePrefix.length).match(/^([\w.-]{1,70}\.mjs):(\d{1,7}):(\d{1,7})(?:\)|$)/);return match&&sourceNames.has(match[1])?[`${match[1]}:${match[2]}:${match[3]}`]:[];}).slice(0,5);
};
const refs=['projectId','taskId','jobId','planId','threadId','requestId'];

export class DiagnosticLog{
  constructor({root,io=fs,now=Date.now,maxBytes=2*1024*1024,maxEntries=600}={}){
    Object.assign(this,{io,now,maxBytes,maxEntries});this.directory=path.join(root,'data');this.file=path.join(this.directory,'diagnostics.jsonl');this.rows=new Map();this.repeats=new Map();this.observed=new Map();this.gates=new Map();this.storageError='';
    for(const file of [this.file+'.2',this.file+'.1',this.file])try{
      const stat=io.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes)throw Error('unsafe diagnostic file');
      for(const line of io.readFileSync(file,'utf8').split('\n'))if(line&&Buffer.byteLength(line)<=4096)try{const row=JSON.parse(line);if(typeof row.id==='string'&&row.id.startsWith('diag-')&&typeof row.at==='string')this.keep(this.clean(row));}catch{}
    }catch(error){if(error.code!=='ENOENT')this.storageError='部分故障日志无法读取；当前记录仍保留在内存。';}
  }
  clean(input){
    const code=diagnosticCode({code:input.code}),row={id:id(input.id)??'diag-'+randomUUID(),at:input.at,lastAt:input.lastAt??input.at,level:['info','warn','error'].includes(input.level)?input.level:'error',phase:id(input.phase)??'operation',code,message:reasons[code],count:Number.isSafeInteger(input.count)&&input.count>0?Math.min(input.count,1000000):1};
    if(typeof input.errorSignature==='string'&&/^[a-f0-9]{16}$/.test(input.errorSignature))row.errorSignature=input.errorSignature;
    if(typeof input.hostVersion==='string'&&/^\d{1,6}(?:\.\d{1,6}){1,3}$/.test(input.hostVersion))row.hostVersion=input.hostVersion;
    for(const key of refs)if(id(input[key]))row[key]=id(input[key]);
    if(typeof input.route==='string')row.route=routes.has(input.route)?input.route:'/api/unknown';
    if(['GET','POST'].includes(input.method))row.method=input.method;
    if(Number.isInteger(input.status)&&input.status>=100&&input.status<=599)row.status=input.status;
    if(typeof input.notApplied==='boolean')row.notApplied=input.notApplied;
    for(const key of ['bytes','limitBytes'])if(Number.isSafeInteger(input[key])&&input[key]>=0)row[key]=input[key];
    if(Array.isArray(input.frames))row.frames=input.frames.filter(v=>typeof v==='string'&&v.length<=100&&/^[\w.-]+\.mjs:\d{1,7}:\d{1,7}$/.test(v)&&sourceNames.has(v.split(':')[0])).slice(0,5);
    return row;
  }
  keep(row){this.rows.delete(row.id);this.rows.set(row.id,row);while(this.rows.size>this.maxEntries)this.rows.delete(this.rows.keys().next().value);}
  append(row){
    try{
      this.io.mkdirSync(this.directory,{recursive:true});
      const safe=file=>{try{const stat=this.io.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('unsafe diagnostic file');return stat.size;}catch(e){if(e.code==='ENOENT')return 0;throw e;}};
      const text=JSON.stringify(row)+'\n';if(Buffer.byteLength(text)>this.maxBytes)return;
      if(safe(this.file)+Buffer.byteLength(text)>this.maxBytes){safe(this.file+'.1');safe(this.file+'.2');try{this.io.unlinkSync(this.file+'.2');}catch(e){if(e.code!=='ENOENT')throw e;}try{this.io.renameSync(this.file+'.1',this.file+'.2');}catch(e){if(e.code!=='ENOENT')throw e;}this.io.renameSync(this.file,this.file+'.1');}
      this.io.appendFileSync(this.file,text,{encoding:'utf8',mode:0o600});this.storageError='';
    }catch{this.storageError='故障日志无法写入；当前仅保留内存记录，请导出后排查磁盘。';}
  }
  record(input){
    // Diagnostic failures must never affect dispatch or its transaction outcome.
    try{
      const error=input.error,at=new Date(this.now()).toISOString();
      const row=this.clean({...input,id:'diag-'+randomUUID(),at,code:input.code??diagnosticCode(error??input.message),errorSignature:input.errorSignature??createHash('sha256').update(String(input.message??error?.message??'').slice(0,8000)).digest('hex').slice(0,16),frames:frames(error),bytes:error?.bytes??input.bytes,limitBytes:error?.limitBytes??input.limitBytes});
      const signature=createHash('sha256').update(JSON.stringify({...row,id:undefined,at:undefined,lastAt:undefined,count:undefined})).digest('hex'),previous=this.repeats.get(signature);
      if(previous&&this.now()-Date.parse(previous.lastAt)<60000&&this.rows.has(previous.id)){
        previous.count=Math.min(previous.count+1,1000000);previous.lastAt=at;this.keep(previous);if((previous.count&(previous.count-1))===0)this.append(previous);return previous.id;
      }
      this.keep(row);this.repeats.set(signature,row);while(this.repeats.size>this.maxEntries)this.repeats.delete(this.repeats.keys().next().value);this.append(row);return row.id;
    }catch{return undefined;}
  }
  observe(state){
    try{
      const current=new Map();let overflow=false;
      const observe=(key,input)=>{const signature=createHash('sha256').update(JSON.stringify(input)).digest('hex');current.set(key,{signature,input:{...Object.fromEntries(refs.filter(name=>id(input[name])).map(name=>[name,id(input[name])])),phase:input.phase,level:input.level,code:input.code??diagnosticCode(input.message),errorSignature:createHash('sha256').update(input.message??'').digest('hex').slice(0,16)}});if(current.size>this.maxEntries){overflow=true;current.delete(current.keys().next().value);}};
      for(const job of state.jobs??[])if(['queued','failed','interrupted','uncertain'].includes(job.status)&&(job.message||job.error))observe('job:'+job.id,{phase:'execution',level:job.status==='queued'?'warn':'error',projectId:job.projectId,taskId:job.taskId,jobId:job.id,threadId:job.threadId,message:job.error||job.message});
      for(const plan of state.automation?.plans??[]){
        if(plan.status==='paused')observe('plan:'+plan.id,{phase:'plan',level:'warn',code:'PLAN_PAUSED',projectId:plan.projectId,planId:plan.id,message:plan.reason||'计划已暂停'});
        if(!['active','paused'].includes(plan.status))continue;
        for(const node of plan.nodes??[])if(!node.skipped&&['pending','blocked','recovering','uncertain'].includes(node.status)&&node.message&&node.message!=='等待调度')observe('node:'+plan.id+':'+node.taskId,{phase:'allocation',level:node.status==='blocked'?'error':'warn',projectId:plan.projectId,planId:plan.id,taskId:node.taskId,jobId:node.jobId,threadId:node.threadId,message:node.message});
      }
      for(const [key,value] of current)if(this.observed.get(key)?.signature!==value.signature)this.record(value.input);
      if(!overflow)for(const [key,old] of this.observed)if(!current.has(key))this.record({...old.input,level:'info',code:'BLOCK_CHANGED'});
      this.observed=current;
    }catch{}
  }
  gate(code,projectIds){
    const active=new Set(code?projectIds.slice(-this.maxEntries):[]);
    for(const projectId of active)if(this.gates.get(projectId)!==code){this.record({phase:'allocation-gate',level:'warn',projectId,code});this.gates.set(projectId,code);}
    for(const projectId of this.gates.keys())if(!active.has(projectId)){this.record({phase:'allocation-gate',level:'info',projectId,code:'BLOCK_CHANGED'});this.gates.delete(projectId);}
  }
  view(projectId,{limit=100,blockers=[]}={}){
    const rows=[...this.rows.values()].filter(r=>!r.phase.startsWith('desktop-check-')&&(!projectId||r.projectId===projectId)).reverse().slice(0,limit).map(row=>({...row,hint:hints[row.code]??'结合诊断编号、关联记录和阶段定位；不要据此自动重试未知发送。'}));
    return {version:1,items:rows,blockers:blockers.slice(0,100),blockersTruncated:!!blockers.truncated||blockers.length>100,storageError:this.storageError,retention:{files:3,maxBytesPerFile:this.maxBytes},note:'仅含本机错误与状态摘要；不含任务正文、凭据或对话内容，不参与同步。当前记录不替代发送前的实时核验。'};
  }
}

export function diagnosticBlockers(state,directJobs=[],projectId){
  const own=row=>!projectId||row.projectId===projectId,rows=[];
  const push=input=>{const message=input.message,code=diagnosticCode(message);rows.push({...Object.fromEntries(Object.entries(input).filter(([key])=>!refs.includes(key))),...Object.fromEntries(refs.filter(key=>id(input[key])).map(key=>[key,id(input[key])])),code,message:reasons[code]});};
  for(const job of [...(state.jobs??[]),...directJobs])if(own(job)&&['queued','sending','submitted','running','uncertain'].includes(job.status))push({kind:'job',projectId:job.projectId,jobId:job.id,taskId:job.taskId,threadId:job.threadId,status:job.status,message:job.status==='uncertain'?'原发送回执未确认':job.error||job.message||'等待原执行结束'});
  for(const plan of state.automation?.plans??[])if(own(plan)&&['active','paused'].includes(plan.status)){
    if(plan.status==='paused')push({kind:'plan',projectId:plan.projectId,planId:plan.id,status:plan.status,message:'安排已暂停'});
    for(const node of plan.nodes??[])if(!node.skipped&&!node.jobId)push({kind:'node',projectId:plan.projectId,planId:plan.id,taskId:node.taskId,threadId:node.threadId,status:plan.status,message:node.message||plan.reason||'安排仍保留占用'});
  }
  for(const task of state.tasks??[])if(own(task)&&handoffPending(task))push({kind:'handoff',projectId:task.projectId,taskId:task.id,jobId:task.handoff.sourceJobId,threadId:task.handoff.sourceThreadId,status:task.handoff.phase,message:'同项目交接仍保留占用，等待原接续核对'});
  for(const route of Object.values(state.automation?.routes??{}))if(own(route)&&['creating','uncertain','model-mismatch'].includes(route.status))push({kind:'route',projectId:route.projectId,threadId:route.threadId,status:route.status,message:route.status==='model-mismatch'?'模型待核对':'原创建回执未确认'});
  return Object.assign(rows.slice(0,100),{truncated:rows.length>100});
}
