import {readFileSync} from 'node:fs';
import {LocalPanelAdapter} from './adapter.mjs';
import {EntryTickets} from './entry-tickets.mjs';

const installedPort=process.env.PAIBAN_PLUGIN_PORT,launchId=process.env.PAIBAN_LAUNCH_ID;
const adapter=new LocalPanelAdapter(installedPort?{origin:'http://127.0.0.1:'+installedPort,expectedLaunchId:launchId}:undefined),tickets=new EntryTickets(),mimeType='text/html;profile=mcp-app',version='0.5.1';
let startup;
function startPanel(){
  if(installedPort&&launchId)startup??=import('./installed-start.mjs')
    .then(({startInstalledPanel})=>startInstalledPanel(installedPort,launchId))
    .catch(error=>console.error('派板随 Codex 启动失败：'+error.message));
  return startup;
}
const resourceCache=new Map();
const configuredMode=process.argv.find(arg=>arg.startsWith('--mode='))?.slice(7);
if(!['global','thread'].includes(configuredMode))throw Error('A fixed local entry mode is required');
const modes=[configuredMode],uri=mode=>`ui://leix-panel/${version}/${mode}.html`;
const entries=modes.map(mode=>({name:`leix_panel_${mode}`,title:mode==='global'?'LEIX 项目入口':'本聊天白板',description:'打开当前聊天所属项目的本机白板；聊天由宿主准确识别，打开不会发送任务或创建执行对话。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},_meta:{ui:{resourceUri:uri(mode),visibility:['model']},'openai/ui':{entrypoints:[{type:mode}]}}}));
const privateTool=(name,properties,required,readOnlyHint)=>({name,title:name,description:'仅供本机 LEIX 界面调用，沿用业务审批和事务。',inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint,destructiveHint:!readOnlyHint,idempotentHint:false,openWorldHint:false},_meta:{ui:{visibility:['app']}}});
entries.push(privateTool('leix_panel_refresh_entry',{},[],true));
entries.push(privateTool('leix_panel_open',{ticket:{type:'string'},viewId:{type:'string'}},['ticket','viewId'],true));
entries.push(privateTool('leix_panel_reopen',{sessionId:{type:'string'},viewId:{type:'string'}},['sessionId','viewId'],true));
entries.push(privateTool('leix_panel_command',{sessionId:{type:'string'},path:{type:'string'},body:{type:'object'},requestId:{type:'string'},etag:{type:'string'}},['sessionId','path'],false));
entries.push(privateTool('leix_panel_read',{sessionId:{type:'string'},path:{type:'string'},etag:{type:'string'}},['sessionId','path'],true));
const invalid=()=>{throw Object.assign(Error('Unsupported input'),{code:-32602});};
export async function respond(request){
  if(!request||Array.isArray(request)||request.jsonrpc!=='2.0'||typeof request.method!=='string')return {jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid Request'}};
  if(!Object.hasOwn(request,'id'))return null;
  const {id,method,params={}}=request;if(!['string','number'].includes(typeof id)&&id!==null)return {jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid Request'}};
  try{
    let result;
    if(method==='initialize'){
      void startPanel();
      result={protocolVersion:['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(params?.protocolVersion)?params.protocolVersion:'2025-06-18',capabilities:{tools:{},resources:{}},serverInfo:{name:'leix-panel-'+configuredMode,version},instructions:'LEIX 本机调度台。业务操作仅供原生界面使用。'};
    }
    else if(method==='ping')result={};
    else if(method==='tools/list')result={tools:structuredClone(entries)};
    else if(method==='resources/list')result={resources:modes.map(mode=>({uri:uri(mode),name:`LEIX ${mode}`,mimeType}))};
    else if(method==='resources/templates/list')result={resourceTemplates:[]};
    else if(method==='resources/read'){
      const mode=modes.find(mode=>uri(mode)===params?.uri);if(!mode)invalid();
      if(!resourceCache.has(mode))resourceCache.set(mode,readFileSync(new URL(`./ui/${mode}.html`,import.meta.url),'utf8'));
      result={contents:[{uri:uri(mode),mimeType,text:resourceCache.get(mode),_meta:{ui:{csp:{connectDomains:[],resourceDomains:['data:','blob:']}}}}]};
    }else if(method==='tools/call'){
      const tool=entries.find(tool=>tool.name===params?.name),args=params?.arguments??{};if(!tool||!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>!Object.hasOwn(tool.inputSchema.properties,key))||(tool.inputSchema.required??[]).some(key=>!Object.hasOwn(args,key)))invalid();
      if(modes.some(mode=>tool.name===`leix_panel_${mode}`))result={content:[{type:'text',text:'已打开 LEIX 本机调度台；业务尚未自动执行。'}],structuredContent:tickets.issue(tool.name.slice('leix_panel_'.length),params._meta)};
      else if(tool.name==='leix_panel_refresh_entry')result={content:[],structuredContent:tickets.issue(configuredMode,params._meta)};
      else{
        let value;
        try {
          if(tool.name==='leix_panel_open'){
            const mode=tickets.take(args.ticket,args.viewId,params._meta);
            await startPanel();
            value=await adapter.open({mode,viewId:args.viewId},params._meta);
          }else if(tool.name==='leix_panel_reopen'){
            value=await adapter.reopen(args,params._meta);
          }else{
            value=await adapter.request({...args,method:tool.name==='leix_panel_read'?'GET':'POST'},params._meta);
          }
        }catch(error){value={status:error.status??503,body:{error:error.notApplied?error.message:'本机面板未运行，请按现有入口启动后重试',notApplied:true,...(error.entryRejected?{entryRejected:true}:{}),...(!error.notApplied?{serviceUnavailable:true}:{})}};}
        result={content:[],structuredContent:value};
      }
    }else throw Object.assign(Error('Method not found'),{code:-32601});
    return {jsonrpc:'2.0',id,result};
  }catch(error){return {jsonrpc:'2.0',id,error:{code:error.code??-32603,message:error.code?error.message:'Local panel request failed'}};}
}
let buffer='';process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{
  buffer+=chunk;let index;
  while((index=buffer.indexOf('\n'))!==-1){
    const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(Buffer.byteLength(line)>16*1024*1024){process.exitCode=1;process.stdin.destroy();return;}if(!line.trim())continue;
    let request;try{request=JSON.parse(line);}catch{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}})+'\n');continue;}
    void respond(request).then(response=>{if(response)process.stdout.write(JSON.stringify(response)+'\n');});
  }
  if(Buffer.byteLength(buffer)>16*1024*1024){process.exitCode=1;process.stdin.destroy();}
});
