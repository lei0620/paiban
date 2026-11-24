import net from 'node:net';
import fs from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const exec = promisify(execFile);
export function connectionThreadId(value){
  const input=typeof value==='string'?value.trim():'';
  if(/^[a-zA-Z0-9-]{10,80}$/.test(input))return input;
  return /^codex:\/\/threads\/([a-zA-Z0-9-]{10,80})\/?$/.exec(input)?.[1]??'';
}
export async function discoverInstances(options={}) {
  let rows=options.legacy;
  if(rows===undefined){
    // Keep legacy process IDs usable, but don't depend on an executable name:
    // newer desktop versions host tools without exposing the pipe in argv.
    try{const {stdout}=await exec('pwsh.exe',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'codex.exe' -and $_.CommandLine -match 'CODEX_APP_TOOLS_PIPE_PATH' } | Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress"],{windowsHide:true,maxBuffer:1024*1024,timeout:5000});const parsed=stdout.trim()?JSON.parse(stdout):[];rows=Array.isArray(parsed)?parsed:[parsed];}catch{rows=[];}
  }
  const prefix='\\\\.\\pipe\\',candidates=new Map();
  const add=(name,id)=>{const match=name.match(/^codex-(app-tools|browser-use)-([a-f0-9-]+)$/i);if(!match)return;const key=name.toLowerCase();if(!candidates.has(key))candidates.set(key,{id:id??'pipe-'+(match[1].toLowerCase()==='app-tools'?'app-tools-':'')+match[2],pipe:prefix+name});};
  for(const row of rows){const match=row.CommandLine?.match(/codex-(?:app-tools|browser-use)-[a-f0-9-]+/i);if(match)add(match[0],String(row.ProcessId));}
  const inherited=options.envPipe??process.env.CODEX_APP_TOOLS_PIPE_PATH;
  if(inherited?.startsWith(prefix))add(inherited.slice(prefix.length));
  try{for(const name of options.names??fs.readdirSync(prefix))add(name);}catch{}
  if(candidates.size>128)throw Error('发现过多桌面管道，请先关闭多余实例后重新连接');
  const probe=options.probe??(pipe=>rpc(pipe,'tools/list',{threadStartKind:'all'},2000)),found=[];
  const pending=[...candidates.values()];
  for(let i=0;i<pending.length;i+=8){
    const batch=await Promise.all(pending.slice(i,i+8).map(async candidate=>{
      try{const result=await probe(candidate.pipe);if(['list_projects','list_threads','read_thread'].every(name=>result.tools?.some(t=>t.name===name||t.name.endsWith('__'+name))))return candidate;}catch{}
      return null;
    }));found.push(...batch.filter(Boolean));
  }
  return found.map(candidate=>({...candidate,label:candidate.id.startsWith('pipe-')?'桌面连接 '+candidate.id.replace(/^pipe-(?:app-tools-)?/,'').slice(0,8):'Codex 实例 '+candidate.id}));
}
export function selectInstance(instances,id=''){
  if(id){const selected=instances.find(i=>i.id===id);if(!selected)throw new Error('已选择的 Codex 实例不可用，请重新选择');return selected;}
  if(!instances.length)throw new Error('未发现运行中的 Codex 桌面连接。请先打开 Codex。');
  if(instances.length!==1)throw new Error('发现多个 Codex 实例，请在连接设置中选择');
  return instances[0];
}
export async function discover(instanceId='') {
  return selectInstance(await discoverInstances(),instanceId).pipe;
}
const readTools=new Set(['list_projects','list_threads','read_thread','list_archived_threads']);
function operationOf(method,params){return method==='tools/call'?String(params.tool??'unknown').split('__').at(-1):method;}
function timeoutError(operation,elapsedMs,timeoutMs){
  const detail=`（${operation}，等待 ${Math.round(elapsedMs/1000)} 秒）`;
  const message=operation==='send_message_to_thread'?'发送回执超时'+detail+'；发送状态未确认，请先检查原对话，勿重复发送。':operation==='create_thread'?'创建对话回执超时'+detail+'；请先核对已有对话，勿重复创建。':readTools.has(operation)||operation==='tools/list'?'桌面读取超时'+detail+'；暂未取得最新状态，面板会自动重试，也可稍后手动刷新。':'桌面操作回执超时'+detail+'；请先核对操作结果，勿重复操作。';
  return Object.assign(new Error(message),{code:'DESKTOP_TIMEOUT',operation,elapsedMs,timeoutMs});
}
export function rpc(pipe,method,params,timeout=30000) {
  return new Promise((resolve,reject)=>{
    const started=performance.now(),operation=operationOf(method,params);
    const socket=net.createConnection(pipe),id=randomUUID(); let pending=Buffer.alloc(0),done=false,sent=false;
    const write=message=>{const body=Buffer.from(JSON.stringify(message));const size=Buffer.alloc(4);size.writeUInt32LE(body.length);socket.write(Buffer.concat([size,body]));};
    const end=(error,value,cancel=false)=>{
      if(done)return;done=true;clearTimeout(timer);
      if(cancel&&sent&&method==='tools/call'&&readTools.has(operation)&&!socket.destroyed){
        // Closing the pipe alone leaves the desktop read running. Cancel it
        // before closing so a stalled catalog read cannot pile up with retries.
        try{write({jsonrpc:'2.0',id,method:'tools/cancel'});socket.end();setTimeout(()=>socket.destroy(),500).unref();}
        catch{socket.destroy();}
      }else socket.destroy();
      error?reject(error):resolve(value);
    };
    const timer=setTimeout(()=>end(timeoutError(operation,Math.round(performance.now()-started),timeout),undefined,true),timeout);
    socket.on('error',e=>end(e)); socket.on('close',()=>end(new Error('桌面连接已关闭')));
    socket.on('connect',()=>{write({jsonrpc:'2.0',id,method,params});sent=true;});
    socket.on('data',chunk=>{pending=Buffer.concat([pending,chunk]);if(pending.length<4)return;const size=pending.readUInt32LE(0);if(size>8*1024*1024)return end(new Error('响应超过大小限制'));if(pending.length<size+4)return;try{const r=JSON.parse(pending.subarray(4,size+4));if(r.error)end(new Error(r.error.message));else end(null,r.result);}catch(e){end(e);}});
  });
}
export function decode(result){
  const items=result.contentItems??result.content??[];
  const texts=items.filter(x=>x.text).map(x=>x.text);
  if(result.success===false||result.isError)throw new Error(texts.join('\n')||'Codex 拒绝了请求');
  if(texts.length===1){try{return JSON.parse(texts[0]);}catch{}}
  return texts.length?{text:texts.join('\n')}:result;
}
export class Bridge {
  constructor(caller,instanceId='',options={}){this.caller=caller;this.instanceId=instanceId;this.callTimeoutMs=options.callTimeoutMs??70000;this.listThreadsTimeoutMs=options.listThreadsTimeoutMs??10000;this.retryTimeoutMs=options.retryTimeoutMs??5000;this.listThreadsAttempts=options.listThreadsAttempts??2;this.active=new Set();this.recent=[];this.failures=[];}
  async observe(operation,action){
    const entry={operation,startedAt:new Date().toISOString()},started=performance.now();this.active.add(entry);
    try{const value=await action();entry.outcome='ok';return value;}
    catch(error){entry.outcome=error.code==='DESKTOP_TIMEOUT'?'timeout':'error';throw error;}
    finally{
      this.active.delete(entry);const record={...entry,elapsedMs:Math.round(performance.now()-started)};
      this.recent.push(record);if(this.recent.length>40)this.recent.shift();
      if(record.outcome!=='ok'){
        this.failures.push(record);if(this.failures.length>20)this.failures.shift();
        // No arguments, response text, caller, thread IDs or pipe paths in diagnostics.
        console.warn('[desktop-request] '+JSON.stringify(record));
      }
    }
  }
  diagnostics(){return structuredClone({active:[...this.active],recent:this.recent,failures:this.failures});}
  async connect(){
    const pipe=await this.observe('discover',()=>discover(this.instanceId));
    const result=await this.observe('tools/list',()=>rpc(pipe,'tools/list',{threadStartKind:'all'}));
    this.pipe=pipe;this.tools=result.tools;return this.tools;
  }
  call(name,args={},options={}){
    if(name!=='list_threads')return this.invokeTool(name,args,options);
    // Queue checks, manual refresh and catalog reads share an identical read.
    // A timeout/retry sequence must finish before another identical one starts.
    this.catalogReads??=new Map();
    const key=JSON.stringify([this.caller,this.instanceId,this.pipe,args,options]);
    if(this.catalogReads.has(key))return this.catalogReads.get(key);
    const request=this.invokeTool(name,args,options).finally(()=>{
      if(this.catalogReads.get(key)===request)this.catalogReads.delete(key);
    });
    this.catalogReads.set(key,request);
    return request;
  }
  async invokeTool(name,args={},options={}){
    if(!this.pipe)await this.connect();
    const tool=this.tools.find(t=>t.name===name||t.name.endsWith('__'+name));
    if(!tool)throw new Error('当前桌面版本未提供工具：'+name);
    if(!this.caller)throw new Error('缺少调度任务 ID。请从 Codex 启动面板，或设置 CODEX_THREAD_ID。');
    const invoke=timeout=>this.observe(name,async()=>decode(await rpc(this.pipe,'tools/call',{arguments:args,callerSource:'codex',callId:randomUUID(),turnId:'mcp-turn-'+randomUUID(),namespace:tool.namespace,threadId:this.caller,tool:tool.name},timeout)));
    if(name!=='list_threads')return invoke(options.timeoutMs??this.callTimeoutMs);
    let lastError;
    const attempts=options.attempts??this.listThreadsAttempts;
    for(let attempt=0;attempt<attempts;attempt++){
      if(attempt)await new Promise(resolve=>setTimeout(resolve,100));
      try{return await invoke(attempt?this.retryTimeoutMs:(options.timeoutMs??this.listThreadsTimeoutMs));}catch(error){
        if(error.code!=='DESKTOP_TIMEOUT')throw error;
        lastError=error;
      }
    }
    lastError.message=`桌面读取超时（list_threads，已取消并复查 ${attempts} 次，共等待 ${Math.round(((options.timeoutMs??this.listThreadsTimeoutMs)+(attempts-1)*this.retryTimeoutMs)/1000)} 秒）；暂未取得最新状态，面板会自动重试，也可稍后手动刷新。`;
    throw lastError;
  }
}
