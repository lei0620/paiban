import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {normalize,sourcePathOf} from './core.mjs';

const exec=promisify(execFile),cache=new Map();
export function githubRepository(remote){
  if(typeof remote!=='string'||remote.length>2048)return null;
  const value=remote.trim();let host,pathname;
  const scp=/^git@([^:]+):(.+)$/.exec(value);
  if(scp){host=scp[1];pathname=scp[2];}
  else{try{const url=new URL(value);if(!['https:','ssh:','git:'].includes(url.protocol)||url.search||url.hash||url.port)return null;host=url.hostname;pathname=url.pathname;}catch{return null;}}
  if(host.toLowerCase()!=='github.com')return null;
  const match=/^\/?([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(pathname);
  return match&&match[2]!=='.'&&match[2]!=='..'?`${match[1]}/${match[2]}`.toLowerCase():null;
}
export const repositoryLogicalId=repository=>'git-'+createHash('sha256').update(repository).digest('hex').slice(0,32);
export async function assertSourceGitDirectory(directory){
  const metadata=path.join(directory,'.git');let info;
  try{info=await fs.lstat(metadata);}catch(error){if(error.code==='ENOENT')throw Error('所选源码目录不是含.git的仓库根目录');throw error;}
  if(!info.isDirectory()||info.isSymbolicLink()||normalize(await fs.realpath(metadata))!==normalize(metadata))throw Error('源码.git必须是本目录内的普通Git目录，暂不支持链接或外部gitdir');
  try{await fs.lstat(path.join(metadata,'commondir'));throw Error('源码Git元数据指向外部公共目录，请使用独立仓库根');}catch(error){if(error.code!=='ENOENT')throw error;}
}
export async function inspectRepository(project,{fresh=false}={}){
  const directory=sourcePathOf(project);
  if(project.hostId!=='local'||!directory||!path.isAbsolute(directory)||/^(?:[e-z]:|\\\\)/i.test(directory))return {repository:null,repositoryStatus:'unavailable',repositoryReason:'此目录尚不能自动识别源码仓库'};
  const key=normalize(project.path)+'\0'+normalize(directory),previous=cache.get(key);
  if(!fresh&&previous&&Date.now()-previous.at<60000)return previous.value;
  const git=async args=>(await exec('git',['--no-optional-locks','-c','core.fsmonitor=false',...args],{cwd:directory,windowsHide:true,timeout:5000,maxBuffer:32768,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'}})).stdout.trim();
  let value;
  try{
    const real=await fs.realpath(directory);if(normalize(real)!==normalize(directory)||normalize(await fs.realpath(project.path))!==normalize(project.path))throw Error('linked directory');
    if(project.sourcePath)await assertSourceGitDirectory(directory);
    const root=await git(['rev-parse','--show-toplevel']);
    if(normalize(root)!==normalize(directory))value={repository:null,repositoryReason:'源码目录不是仓库根目录，请手动确认逻辑项目'};
    else{const remotes=await git(['remote']);if(!remotes.trim())value={repository:null,repositoryStatus:'local',gitAvailable:true,repositoryReason:''};else{const repository=githubRepository(await git(['config','--get','remote.origin.url']));value={repository,repositoryStatus:repository?'github':'external',gitAvailable:true,repositoryReason:repository?'':'已有非 GitHub 远程仓库，请核对，不能直接覆盖'};}}
  }catch(error){
    if(error.code===128&&/not a git repository/i.test(error.stderr??''))value={repository:null,repositoryStatus:'local',gitAvailable:false,repositoryReason:''};
    else if(error.code==='ENOENT')value={repository:null,repositoryStatus:'unavailable',gitAvailable:false,repositoryReason:'暂未找到 Git 或项目目录，请核对后刷新项目'};
    else value={repository:null,repositoryStatus:'unavailable',repositoryReason:'源码仓库暂不可读取，请核对本机目录与远程配置'};
  }
  cache.set(key,{at:Date.now(),value});return value;
}
export function validateProjectIdentities(values=[]){
  if(!Array.isArray(values)||values.length>1000)throw Error('仓库身份列表无效');
  const repositories=new Set(),logicalIds=new Set();
  return values.map(v=>{
    if(!v||Object.keys(v).some(k=>!['repository','logicalId','projectName'].includes(k))||githubRepository('https://github.com/'+v.repository)!==v.repository||typeof v.logicalId!=='string'||!v.logicalId.trim()||v.logicalId.length>200||/[\\/\x00-\x1f]/.test(v.logicalId)||['__proto__','constructor','prototype'].includes(v.logicalId)||typeof v.projectName!=='string'||!v.projectName.trim()||v.projectName.length>200||repositories.has(v.repository)||logicalIds.has(v.logicalId))throw Error('仓库身份存在重复、冲突或无效字段');
    if(/[a-zA-Z]:[\\/]|\b(?:ghp_|sk-)[a-zA-Z0-9]{20,}|[\x00-\x1f]/.test(v.logicalId+v.projectName))throw Error('仓库身份不能包含本机路径、凭据或控制字符');
    repositories.add(v.repository);logicalIds.add(v.logicalId);return {repository:v.repository,logicalId:v.logicalId,projectName:v.projectName};
  }).sort((a,b)=>a.repository.localeCompare(b.repository));
}
export async function identifyProjects(projects,inspect=inspectRepository,mappings={}){
  const result=[];
  for(let i=0;i<projects.length;i+=4)result.push(...await Promise.all(projects.slice(i,i+4).map(async p=>{const sourcePath=mappings[p.projectId]?.sourcePath;const candidate={...p};delete candidate.sourcePath;if(sourcePath)candidate.sourcePath=sourcePath;return {...candidate,...await inspect(candidate)};})));
  const counts=new Map();for(const p of result)if(p.repository)counts.set(p.repository,(counts.get(p.repository)??0)+1);
  for(const p of result)if(p.repository&&counts.get(p.repository)>1)p.repositoryReason='本机有多个同仓库项目，请手动选择使用的副本';
  return result;
}
export function reconcileRepositories(state,projects,remoteIdentities=[],remoteRecords=null){
  const remote=validateProjectIdentities(remoteIdentities),known=validateProjectIdentities(state.sync?.projectIdentities??[]);
  const identities=new Map(known.map(v=>[v.repository,v]));
  const unusedPlaceholder=identity=>remoteRecords!==null&&identity.logicalId===repositoryLogicalId(identity.repository)&&![...(state.sync?.base??[]),...remoteRecords].some(r=>r.logicalId===identity.logicalId)&&!Object.entries(state.workspace.mappings).some(([id,m])=>m.logicalId===identity.logicalId&&(!m.automatic||state.tasks.some(t=>t.projectId===id&&t.syncId)));
  for(const v of remote){const old=identities.get(v.repository);if(old&&old.logicalId!==v.logicalId&&!unusedPlaceholder(old))throw Error('源码仓库的远端逻辑身份发生冲突，请核对原电脑');identities.set(v.repository,v);}
  const mappings=state.workspace.mappings;
  for(const p of projects){
    // Explicit source aliases retain their original shared task identity.
    if(mappings[p.projectId]?.sourcePath)continue;
    if(p.repositoryStatus==='local'&&p.hostId==='local'&&p.path&&!p.repository&&!p.repositoryReason){
      if(!mappings[p.projectId]&&!Object.values(mappings).some(m=>normalize(m.path)===normalize(p.path)))mappings[p.projectId]={logicalId:'local-'+createHash('sha256').update((state.workspace.deviceId??'')+'\0'+normalize(p.path)).digest('hex').slice(0,24),logicalName:(p.label||'本地项目').slice(0,80),path:p.path,tags:[],automatic:true,localOnly:true};
      continue;
    }
    if(!p.repository)continue;
    let m=mappings[p.projectId];
    if(m&&(normalize(m.path)!==normalize(p.path)||(m.repository&&m.repository!==p.repository)))continue;
    if(p.repositoryReason&&(!m||m.automatic))continue;
    let shared=identities.get(p.repository);
    if(m&&shared&&m.logicalId!==shared.logicalId){
      const used=state.sync?.base?.some(r=>r.logicalId===m.logicalId)||state.tasks.some(t=>t.projectId===p.projectId&&t.syncId);
      // A new computer may have published only an empty generated identity.
      // The verified original mapping can replace that placeholder, never data.
      if(!m.automatic&&unusedPlaceholder(shared)){shared={repository:p.repository,logicalId:m.logicalId,projectName:m.logicalName};}
      else{if(!m.automatic||used)throw Error('源码仓库与已有手动/已同步身份不一致，请核对原绑定');m={...m,logicalId:shared.logicalId,logicalName:shared.projectName};}
    }
    const logicalId=m?.logicalId??shared?.logicalId??repositoryLogicalId(p.repository);
    if(Object.entries(mappings).some(([id,other])=>id!==p.projectId&&(other.logicalId===logicalId||other.repository===p.repository)))continue;
    m??={logicalId,logicalName:(shared?.projectName??p.label??p.repository.split('/')[1]).slice(0,80),path:p.path,tags:[],automatic:true};
    mappings[p.projectId]={...m,repository:p.repository};delete mappings[p.projectId].localOnly;
    identities.set(p.repository,shared??{repository:p.repository,logicalId:m.logicalId,projectName:m.logicalName});
  }
  return validateProjectIdentities([...identities.values()]);
}
