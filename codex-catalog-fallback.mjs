import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {normalize} from './core.mjs';

const threadId=/^[a-zA-Z0-9-]{10,80}$/;
export function codexCommand(){
  const root=process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'OpenAI','Codex','bin');
  try{
    const files=fs.readdirSync(root,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>path.join(root,entry.name,'codex.exe')).filter(file=>fs.lstatSync(file,{throwIfNoEntry:false})?.isFile());
    files.sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
    if(files.length)return files[0];
  }catch{}
  return 'codex.exe';
}

// The local app-server reads its state DB without repairing rollouts. This is
// only used when the desktop sidebar listing itself times out.
export function listLocalIndexThreads(paths,{command=codexCommand(),args=['app-server','--stdio'],timeoutMs=20000,allowMultiple=false}={}){
  const discovering=paths===null;
  const allowed=discovering?null:new Set(paths.map(normalize));
  if(allowed?.size===0)return Promise.resolve([]);
  return new Promise((resolve,reject)=>{
    let child,done=false,buffer='',pages=0;const rows=new Map(),cursors=new Set();
    const finish=(error,value)=>{
      if(done)return;done=true;clearTimeout(timer);
      try{child?.stdin.end();}catch{}
      const stop=setTimeout(()=>{if(child?.exitCode===null&&child.signalCode===null)child.kill();},1000);stop.unref();
      error?reject(error):resolve(value);
    };
    const timer=setTimeout(()=>finish(Error('本机对话索引读取超时')),timeoutMs);
    const send=(id,method,params)=>child.stdin.write(JSON.stringify({id,method,params})+'\n');
    const page=cursor=>send(2,'thread/list',{archived:false,...(discovering?{limit:allowMultiple?20:2}:{cwd:paths,limit:100}),cursor,sortKey:'recency_at',sortDirection:'desc',useStateDbOnly:true});
    try{child=spawn(command,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});}
    catch(error){finish(error);return;}
    child.stdin.on('error',()=>{});
    child.on('error',error=>finish(Error('本机 Codex 目录工具不可用：'+error.message)));
    child.on('close',()=>{if(!done)finish(Error('本机 Codex 目录工具提前退出'));});
    child.stdout.on('data',chunk=>{
      if(done)return;buffer+=chunk.toString();
      if(buffer.length>8*1024*1024){finish(Error('本机对话目录响应过大'));return;}
      let end;while(!done&&(end=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let response;
        try{response=JSON.parse(line);}catch{finish(Error('本机对话目录响应无效'));return;}
        if(response.id===1){
          if(response.error){finish(Error('本机 Codex 目录初始化失败'));return;}
          child.stdin.write(JSON.stringify({method:'initialized'})+'\n');page(null);
        }else if(response.id===2){
          if(response.error||!Array.isArray(response.result?.data)){finish(Error('本机对话目录读取失败'));return;}
          for(const row of response.result.data){
            if(!threadId.test(row.id??'')||typeof row.cwd!=='string'||!(discovering?path.isAbsolute(row.cwd):allowed.has(normalize(row.cwd)))){finish(Error('本机对话目录归属无效'));return;}
            if(rows.has(row.id)&&normalize(rows.get(row.id).cwd)!==normalize(row.cwd)){finish(Error('本机对话目录归属冲突'));return;}
            rows.set(row.id,{id:row.id,cwd:row.cwd,title:row.name?.trim()||row.id});
          }
          if(rows.size>1000||++pages>20){finish(Error('本机对话目录超过安全上限'));return;}
          const cursor=response.result.nextCursor;
          if(discovering){
            // A partial list cannot prove that a candidate is unique.
            finish(null,allowMultiple?[...rows.values()].slice(0,20):cursor==null&&rows.size===1?[...rows.values()]:[]);return;
          }
          if(cursor==null){finish(null,[...rows.values()]);return;}
          if(typeof cursor!=='string'||cursors.has(cursor)){finish(Error('本机对话目录游标无效'));return;}
          cursors.add(cursor);page(cursor);
        }
      }
    });
    send(1,'initialize',{clientInfo:{name:'codexkz-read-catalog',version:'1'},capabilities:null});
  });
}

export async function localCatalogFallback({projects,state,previousThreads=[]},options={}){
  const paths=[...new Set(projects.filter(p=>p.hostId==='local'&&p.path).map(p=>p.path))];
  const rows=await (options.listIndexThreads??listLocalIndexThreads)(paths,options.index);
  // Catalog recovery must not load every full transcript into the desktop.
  // Large image chats can exhaust the renderer during a bulk read. An indexed
  // thread has unknown live status, so keep dispatch blocked until recovery.
  const threads=rows.map(row=>({...row,kind:'codex',hostId:'local',status:'active',activityUnknown:true}));
  const threadErrors=Object.fromEntries(rows.map(row=>[row.id,'本机对话状态未确认，所属项目暂停派发']));
  const visible=new Set(rows.slice(0,50).map(row=>row.id));
  for(const id of [state.caller,...(state.imported??[]),...Object.values(state.bindings??{}),...previousThreads.map(row=>row.id)])visible.add(id);
  return {threads:threads.filter(row=>visible.has(row.id)),activityThreads:threads,threadErrors};
}
