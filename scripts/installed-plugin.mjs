import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {inspectActiveVersion} from '../release-activation.mjs';
import {installedReleaseConfig} from '../release-config.mjs';
import {safeLocalPath} from '../maintenance-policy.mjs';
import {verifyInstalledProgram} from '../installed-integrity.mjs';
import {configuredBackupRoot} from '../backup-roots.mjs';
import {backupRestartState} from '../restart.mjs';
import {codexCommand} from '../codex-catalog-fallback.mjs';
import {readInstalledDataRoot,saveInstalledDataRoot} from '../installed-paths.mjs';

const script=fileURLToPath(import.meta.url);
const initialProgram=path.dirname(path.dirname(script));
const installRoot=path.dirname(initialProgram);
const launchSettings=path.join(installRoot,'paiban-launch.json');
const marketName='paiban-local',pluginName='paiban-board',pluginId=pluginName+'@'+marketName;
const marketplace=path.join(installRoot,'codex-plugin');
const validPort=value=>Number.isInteger(value)&&value>=1024&&value<=65535;
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});

function readLaunchSettings(){
  if(!fs.existsSync(launchSettings))return null;
  const file=safeLocalPath(launchSettings),stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.size>4096)throw Error('派板启动设置无效');
  const settings=JSON.parse(fs.readFileSync(file,'utf8'));
  if(settings?.version!==1||!validPort(settings.port)||!/^[a-f0-9]{32}$/.test(settings.id??''))throw Error('派板启动设置无效');
  return settings;
}

async function choosePort(){
  async function attempt(port){
    return new Promise((resolve,reject)=>{
      const listener=net.createServer();
      listener.once('error',error=>['EADDRINUSE','EACCES'].includes(error.code)&&port?resolve(null):reject(error));
      listener.listen(port,'127.0.0.1',()=>{const selected=listener.address().port;listener.close(error=>error?reject(error):resolve(selected));});
    });
  }
  for(let port=4319;port<=4335;port++){
    const selected=await attempt(port);
    if(selected)return selected;
  }
  return attempt(0);
}

// Codex caches the packaged executable. It accepts a contained executable
// path and an absolute argument pointing to the stable installed bootstrap.
async function createMarketplace(port,dataRoot){
  verifyInstalledProgram(initialProgram);
  if(dataRoot&&path.relative(path.join(installRoot,'userdata'),dataRoot)){
    saveInstalledDataRoot(installRoot,dataRoot,configuredBackupRoot(dataRoot));
  }
  const settings={version:1,port:port??await choosePort(),id:randomBytes(16).toString('hex')};
  const plugin=path.join(marketplace,'plugins',pluginName);
  const initialManifest=JSON.parse(fs.readFileSync(path.join(initialProgram,'plugins','leix-panel-probe','plugin.json'),'utf8'));
  const node=safeLocalPath(path.join(initialProgram,'plugins','leix-panel-probe','runtime','node.exe'));
  const license=safeLocalPath(path.join(installRoot,'runtime','node','LICENSE'));
  if(!fs.statSync(node).isFile())throw Error('安装运行时不可用');
  fs.mkdirSync(marketplace);
  fs.mkdirSync(path.join(marketplace,'.agents','plugins'),{recursive:true});
  fs.mkdirSync(path.join(plugin,'runtime'),{recursive:true});
  fs.copyFileSync(node,path.join(plugin,'runtime','node.exe'),fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(license,path.join(plugin,'runtime','LICENSE'),fs.constants.COPYFILE_EXCL);
  initialManifest.name=pluginName;
  initialManifest.extensions['com.openai'].interface.displayName='派板 · 本聊天白板';
  write(path.join(plugin,'plugin.json'),initialManifest);
  write(path.join(plugin,'mcp.json'),{
    $schema:'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers:{paiban_panel_thread:{type:'stdio',command:'./runtime/node.exe',args:[script,'serve']}}
  });
  write(path.join(marketplace,'.agents','plugins','marketplace.json'),{
    name:marketName,interface:{displayName:'派板本机插件'},
    plugins:[{name:pluginName,source:{source:'local',path:'./plugins/'+pluginName},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}]
  });
  write(launchSettings,settings);
}

function registerMarketplace(dataRoot){
  verifyInstalledProgram(initialProgram);
  const root=safeLocalPath(dataRoot,{directory:true});
  if(fs.readFileSync(safeLocalPath(path.join(root,'.installed-data-ready')),'utf8')!=='codexkz-installed-data-v1\n')throw Error('派板数据尚未准备好');
  const backupRoot=configuredBackupRoot(root);
  if(!backupRoot)throw Error('请先在派板的首次设置中选择备份目录');
  const localMarket=safeLocalPath(marketplace,{directory:true}),command=codexCommand();
  const call=(...args)=>JSON.parse(execFileSync(command,args,{windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024}));
  let existing;
  try{existing=call('plugin','marketplace','list','--json').marketplaces.find(row=>row.name===marketName);}catch{throw Error('未能读取 Codex 插件配置，请先打开并登录 Codex 桌面应用');}
  if(existing&&(!existing.root||path.resolve(existing.root).toLowerCase()!==localMarket.toLowerCase()))throw Error('Codex 已有来自另一处安装的派板插件，请先核对现有插件');
  const connected=()=>call('plugin','list','--marketplace',marketName,'--json').installed.some(row=>row.pluginId===pluginId&&row.enabled)
    &&call('mcp','list','--json').some(row=>row.name==='paiban_panel_thread'&&row.enabled);
  if(existing){
    try{if(connected())return;}catch{throw Error('无法核对已经登记的派板插件');}
  }
  const configRoot=process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),config=path.join(configRoot,'config.toml');
  if(fs.existsSync(config))backupRestartState(safeLocalPath(config),backupRoot,'接入Codex白板');
  let added=false;
  try{
    if(!existing){call('plugin','marketplace','add',localMarket,'--json');added=true;}
    call('plugin','add',pluginId,'--json');
    if(!connected())throw Error('Codex 未启用白板入口');
  }catch{
    if(added){
      try{
        if(connected())return;
        const match=call('plugin','marketplace','list','--json').marketplaces.find(row=>row.name===marketName);
        if(match?.root&&path.resolve(match.root).toLowerCase()===localMarket.toLowerCase())call('plugin','marketplace','remove',marketName,'--json');
      }catch{throw Error('接入白板未完成。请在 Codex 插件设置中核对派板入口后重试。');}
    }
    throw Error('Codex 未能接入白板。请打开 Codex 桌面应用，确认插件可用后重试。');
  }
}

async function serve(port){
  const settings=readLaunchSettings();
  verifyInstalledProgram(initialProgram);
  const active=inspectActiveVersion(installRoot);
  const trusted=installedReleaseConfig(initialProgram);
  const selected=installedReleaseConfig(active.program);
  if(!selected.publicKey.export({type:'spki',format:'der'}).equals(trusted.publicKey.export({type:'spki',format:'der'})))throw Error('插件版本的发行公钥不匹配');
  const targetPort=port??settings?.port??4319;
  if(!settings){
    const origin='http://127.0.0.1:'+targetPort;
    const response=await fetch(origin+'/api/view/status',{redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!response.ok||(await response.json()).service?.productVersion!==active.version)throw Error('请先启动已确认版本的派板');
  }
  const plugin=path.join(active.program,'plugins','leix-panel-probe');
  const child=spawn(path.join(plugin,'runtime','node.exe'),[path.join(plugin,'server.mjs'),'--mode=thread'],{windowsHide:true,stdio:'inherit',env:{...process.env,PAIBAN_PLUGIN_PORT:String(targetPort),PAIBAN_LAUNCH_ID:settings?.id??''}});
  await new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('exit',code=>code===0?resolve():reject(Error('派板插件已退出')));
  });
}

const [action,argument,...extra]=process.argv.slice(2);
if(extra.length)throw Error('派板插件参数无效');
if(action==='location')console.log(readInstalledDataRoot(installRoot,argument));
else if(action==='register'&&path.isAbsolute(argument??''))registerMarketplace(argument);
else if(action==='create'&&path.isAbsolute(argument??''))await createMarketplace(undefined,argument);
else if(action==='create'||action==='serve'){
  const port=argument===undefined?undefined:Number(argument);
  if(port!==undefined&&(!/^\d{4,5}$/.test(argument)||!validPort(port)))throw Error('派板插件端口无效');
  if(action==='create')await createMarketplace(port);
  else await serve(port);
}else throw Error('派板插件操作无效');
