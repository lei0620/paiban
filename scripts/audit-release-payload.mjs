import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runtimeSources} from './runtime-sources.mjs';

const textTypes=new Set(['.mjs','.js','.json','.html','.css','.ps1','.md']);
const forbidden=[['本机绝对路径',/(?:[cde]):(?:\\{1,2}|\/)(?:users|lei|aixm)(?:\\{1,2}|\/)/i],['私钥',/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],['访问令牌',/(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_]{20,}/]];

export function auditReleaseFiles(root,files){
  const issues=[];root=fs.realpathSync.native(root);
  for(const relative of [...new Set(files)].sort()){
    const full=path.resolve(root,relative),rel=path.relative(root,full);
    if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel)){issues.push({file:relative,reason:'路径越界'});continue;}
    try{
      const stat=fs.lstatSync(full);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync.native(full)!==full){issues.push({file:relative,reason:'路径被重定向或不是文件'});continue;}
      if(textTypes.has(path.extname(full).toLowerCase())){
        if(stat.size>4*1024*1024){issues.push({file:relative,reason:'文本超出审计上限'});continue;}
        const source=fs.readFileSync(full,'utf8');
        for(const [reason,pattern] of forbidden)if(pattern.test(source))issues.push({file:relative,reason});
      }
    }catch{issues.push({file:relative,reason:'无法读取'});}
  }
  return issues;
}

export function releaseCandidateFiles(root){
  const plugin=['plugin.json','mcp.json','server.mjs','adapter.mjs','entry-tickets.mjs','installed-start.mjs','native-policy.mjs','ui/thread.html'].map(name=>path.join('plugins','leix-panel-probe',name));
  const publicFiles=fs.readdirSync(path.join(root,'public'),{withFileTypes:true}).map(entry=>{
    if(!entry.isFile()||entry.isSymbolicLink())throw Error('页面目录包含非常规文件，不能自动审计');
    return path.join('public',entry.name);
  });
  const runtime=runtimeSources(root,{entries:['server.mjs','panel-runner.mjs','installed-migration.mjs','scripts/migrate-installed-data.mjs','scripts/initialize-installed-data.mjs','scripts/configure-installed-backup.mjs','scripts/backup-installed-data.mjs','release-prepare.mjs','release-journal.mjs','release-slot.mjs','release-activation.mjs','update-startup.mjs','update-coordinator.mjs','scripts/resolve-installed-version.mjs','scripts/recover-installed-update.mjs','scripts/check-installed.mjs','scripts/installed-plugin.mjs']}).files;
  const installerFiles=['assets/paiban.ico','scripts/expand-release.ps1','scripts/installed-launch.ps1','scripts/installed-recover.ps1','scripts/check-codex-desktop.ps1'];
  return [...new Set([...runtime,...publicFiles,...plugin,...installerFiles,'LICENSE.md',path.join('.agents','plugins','marketplace.json')].map(file=>path.normalize(file)))].sort();
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=path.resolve(process.argv[2]??process.cwd()),files=releaseCandidateFiles(root),issues=auditReleaseFiles(root,files);
  console.log(JSON.stringify({files:files.length,issues},null,2));
  if(issues.length)process.exitCode=1;
}
