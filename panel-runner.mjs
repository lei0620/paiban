import {fork} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {applyOfflineUpdate,recoverFailedUpdate} from './update-coordinator.mjs';
import {migrateInstalledData} from './installed-migration.mjs';
import {configuredBackupRoot,localBackupStamp} from './backup-roots.mjs';
import {installedBackupRoot,installedDataRoot,saveInstalledDataRoot} from './installed-paths.mjs';
import {resolveInstalledVersion} from './installed-version.mjs';

// Restart only after the current child explicitly requests it and exits cleanly.
// A crash or failed startup is reported to the operator, never retried automatically.
const root=path.dirname(fileURLToPath(import.meta.url)),installRoot=process.env.CODEXKZ_INSTALL_ROOT;
let child,stopping=false,currentProgram=root,currentNode=process.execPath,dataRoot=process.env.CODEXKZ_INSTALLED_DATA_ROOT,relocationError='';
function launch(upgradeId=null){
  let requested=false,updateId=null,destination=null,confirmed=false,ended=false;
  const env={...process.env,PANEL_KEEP_CALLER:'1',PAIBAN_RELOCATION_ERROR:relocationError};delete env.CODEXKZ_PENDING_UPDATE;
  if(upgradeId)env.CODEXKZ_PENDING_UPDATE=upgradeId;
  if(installRoot)env.CODEXKZ_INSTALL_ROOT=installRoot;
  if(dataRoot)env.CODEXKZ_INSTALLED_DATA_ROOT=dataRoot;
  if(installRoot){
    const runtime=path.dirname(currentProgram);
    const pathKey=process.platform==='win32'?(Object.keys(env).find(key=>key.toLowerCase()==='path')??'Path'):'PATH';
    env[pathKey]=[path.join(runtime,'runtime','powershell'),env[pathKey]].filter(Boolean).join(path.delimiter);
  }
  child=fork(path.join(currentProgram,'server.mjs'),[],{cwd:currentProgram,execPath:currentNode,env,windowsHide:true,stdio:['ignore','inherit','inherit','ipc']});
  child.on('message',message=>{
    if(message?.type==='panel-restart-ready')requested=true;
    if(message?.type==='panel-update-ready'&&typeof message.id==='string')updateId=message.id;
    if(message?.type==='panel-relocation-ready'&&typeof message.destination==='string')destination=message.destination;
    if(message?.type==='panel-update-confirmed'&&upgradeId)confirmed=true;
  });
  child.on('error',error=>{
    console.error('面板启动失败：'+error.message);
    if(upgradeId&&!confirmed&&!child.pid&&!ended&&!stopping){ended=true;void recover(upgradeId,'新版本进程未能启动');}
    else process.exitCode=1;
  });
  child.on('exit',(code,signal)=>{
    if(ended)return;ended=true;
    if(stopping){if(process.connected)process.disconnect();process.exitCode=code??(signal?1:0);return;}
    if(updateId&&code===0&&installRoot&&dataRoot){void update(updateId);return;}
    if(destination&&code===0&&installRoot&&dataRoot){void relocate(destination);return;}
    if(requested&&code===0){launch();return;}
    if(upgradeId&&!confirmed&&installRoot&&dataRoot){void recover(upgradeId,'新版本启动失败');return;}
    if(code||signal)console.error('面板已停止，请核对后手动启动。');process.exitCode=code??(signal?1:0);
  });
}
async function relocate(destination){
  try{
    destination=installedDataRoot(installRoot,destination,{missing:true});
    const backupRoot=installedBackupRoot(installRoot,destination,configuredBackupRoot(dataRoot));
    fs.mkdirSync(backupRoot,{recursive:true});
    const backup=path.join(backupRoot,localBackupStamp()+'_数据迁移_'+randomUUID().slice(0,8));
    await migrateInstalledData({source:dataRoot,destination,backup});
    await resolveInstalledVersion({installRoot,dataRoot:destination});
    if(stopping)return;
    saveInstalledDataRoot(installRoot,destination,backupRoot);
    dataRoot=destination;relocationError='';
  }catch(error){
    console.error('更改数据位置失败：'+error.message);
    relocationError='更改数据位置失败，正在使用原数据。'+error.message;
  }finally{
    if(!stopping)launch();
    else if(process.connected)process.disconnect();
  }
}
async function update(id){
  try{
    if(stopping){await recover(id,'使用者停止升级');return;}
    const runtime=path.dirname(currentProgram),next=await applyOfflineUpdate({installRoot,dataRoot,id,powershellPath:path.join(runtime,'runtime','powershell','pwsh.exe')});
    if(stopping){await recover(id,'使用者停止升级');return;}
    currentProgram=next.program;currentNode=next.node;launch(id);
  }catch(error){console.error('升级准备失败：'+error.message);await recover(id,'升级准备失败');}
}
async function recover(id,reason){
  try{const old=await recoverFailedUpdate({installRoot,dataRoot,id,reason});currentProgram=old.program;currentNode=old.node;console.error('已恢复旧程序；数据未自动恢复。');if(!stopping)launch();}
  catch(error){console.error('升级结果需要人工核对，未强制停止或恢复数据：'+error.message);process.exitCode=1;}
  finally{if(stopping&&process.connected)process.disconnect();}
}
function stop(){
  stopping=true;
  // Windows kill(SIGTERM) is forceful. Ask this child to drain its writers and
  // release the data lock; a disconnected child also shuts down on its own.
  if(child?.connected)child.send({type:'panel-stop'},error=>{if(error)console.error('面板关闭请求失败：'+error.message);});
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
process.on('message',message=>{if(message?.type==='panel-stop')stop();});
launch();
