import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {discoverInstances} from './bridge.mjs';
import {createPanel} from './server.mjs';
import {reconcileRepositories,repositoryLogicalId} from './repository-identity.mjs';
import {localBoardId,syncWorkspaceReason,workspaceReason} from './workspace.mjs';

async function fixture(t,overrides={}){
  const root=await fs.mkdtemp(path.join(process.cwd(),'.paiban-first-use-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const open=async options=>createPanel({
    root,port:0,autostart:false,activityScope:'panel',caller:'',
    discoverInstances:async()=>[],
    sessionReader:{rolloutSize:()=>32},
    getDefaultModel:()=>null,
    ...overrides,...options
  });
  return {root,open};
}

async function status(app){
  const response=await fetch(app.origin+'/api/state');
  assert.equal(response.status,200);
  return response.json();
}

async function post(app,token,route,body){
  const response=await fetch(app.origin+'/api/'+route,{method:'POST',
    headers:{'Content-Type':'application/json','X-Panel-Token':token},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
}

test('a fresh panel saves cards without Git, Codex, or sync setup and restores them',async t=>{
  const {open}=await fixture(t);
  let app=await open();
  try{
    assert.equal(await app.refreshMetadata(),false);
    const before=await status(app);
    assert.equal(before.workspace.defaultProjectId,localBoardId);
    assert.equal(before.projects[0].offlineOnly,true);
    assert.ok(before.workspace.deviceLabel);
    assert.equal(Boolean(before.sync.config),false);
    assert.equal(before.sync.automatic.enabled,false);
    const saved=await post(app,before.token,'tasks/create',{projectId:localBoardId,autoTitle:true,description:'记一张卡',requestId:'first-use-save'});
    assert.equal(saved.status,200,JSON.stringify(saved.body));
    assert.equal(saved.body.task.status,'todo');
    const execute=await post(app,before.token,'tasks/execute',{projectId:localBoardId,id:saved.body.task.id,requestId:'first-use-send'});
    assert.equal(execute.status,400);
    const accept=await post(app,before.token,'tasks/execute',{projectId:localBoardId,id:saved.body.task.id,requestId:'first-use-accept',accept:true});
    assert.equal(accept.status,400);
    assert.equal((await status(app)).jobs.length,0);
  }finally{await app.close();}
  app=await open();
  try{
    const persisted=await status(app);
    assert.equal(persisted.tasks.length,1);
    assert.equal(persisted.tasks[0].projectId,localBoardId);
  }finally{await app.close();}
});

test('a unique desktop conversation and project get connected, with temporary Git failure recoverable',async t=>{
  const project={projectId:'test-project',path:path.resolve('fixture-project'),label:'项目',hostId:'local'};
  const thread={id:'codex-thread-one',kind:'codex',hostId:'local',cwd:project.path,title:'已核验对话'};
  let repository=null;
  let offline=false;
  const calls=[];
  const {open}=await fixture(t,{
    discoverInstances:async()=>[{id:'instance'}],
    discoverInitialThreads:async()=>[{id:thread.id,cwd:project.path}],
    makeBridge:(caller,instanceId)=>({caller,instanceId,async connect(){if(offline)throw Error('offline');},
      async call(name){calls.push(name);if(name==='read_thread')return {thread};if(name==='list_projects')return {projects:[project]};throw Error(name);}
    }),
    localCatalogFallback:async()=>({threads:[thread],activityThreads:[thread],threadErrors:{}}),
    inspectRepository:async()=>repository?{repository,repositoryStatus:'github',repositoryReason:''}:{repository:null,repositoryStatus:'unavailable',repositoryReason:'Git unavailable'}
  });
  let app=await open();
  try{
    assert.equal(await app.refreshMetadata(),true);
    let state=await status(app);
    assert.equal(state.caller,thread.id);
    assert.equal(state.workspace.defaultProjectId,project.projectId);
    assert.equal(state.workspace.mappings[project.projectId].localOnly,true);
    const saved=await post(app,state.token,'tasks/create',{projectId:project.projectId,autoTitle:true,description:'本地任务',requestId:'pending-git'});
    assert.equal(saved.status,200);
    repository='owner/repo';
    assert.equal(await app.refreshMetadata(),true);
    state=await status(app);
    assert.equal(state.workspace.mappings[project.projectId].logicalId,repositoryLogicalId(repository));
    assert.equal(state.tasks[0].id,saved.body.task.id);
    assert.deepEqual(calls,['read_thread','list_projects','list_projects']);
  }finally{await app.close();}
  offline=true;
  app=await open({caller:undefined});
  try{
    const state=await status(app);
    assert.equal(state.projects.find(row=>row.projectId===project.projectId)?.offlineOnly,true);
    assert.equal(state.tasks[0].projectId,project.projectId);
  }finally{await app.close();}
});

test('multiple conversation candidates never choose a caller or send a message',async t=>{
  const {open}=await fixture(t,{
    discoverInstances:async()=>[{id:'instance'}],
    discoverInitialThreads:async()=>[{id:'codex-thread-one'},{id:'codex-thread-two'}],
    makeBridge:caller=>({async connect(){assert.fail('must not probe an ambiguous caller '+caller);}})
  });
  const app=await open();
  try{
    assert.equal(await app.refreshMetadata(),false);
    const state=await status(app);
    assert.equal(state.caller,'');
    assert.equal(state.workspace.defaultProjectId,localBoardId);
    assert.equal(state.jobs.length,0);
    const choices=await post(app,state.token,'connection/instances',{});
    assert.equal(choices.status,200);
    assert.equal(choices.body.candidates.length,2);
  }finally{await app.close();}
});

test('sidebar tool availability is independent of the desktop connection',async()=>{
  const instances=await discoverInstances({legacy:[],envPipe:'',names:['codex-app-tools-abc123'],
    probe:async()=>({tools:['list_projects','list_threads','read_thread'].map(name=>({name}))})});
  assert.equal(instances.length,1);
});

test('duplicate repositories stay local until one copy is selected',()=>{
  const repo='owner/repo';
  const state={workspace:{deviceId:'local',mappings:{}},tasks:[]};
  const projects=['one','two'].map(projectId=>({projectId,label:projectId,path:path.resolve(projectId),hostId:'local',
    repository:repo,repositoryStatus:'github',repositoryReason:'多个副本'}));
  reconcileRepositories(state,projects);
  assert.ok(Object.values(state.workspace.mappings).every(mapping=>mapping.localOnly));
  assert.equal(workspaceReason(state,projects[0]),'');
  assert.equal(syncWorkspaceReason(state,projects[0]),'多个副本');
  reconcileRepositories(state,[{...projects[0],repositoryReason:''}]);
  assert.equal(state.workspace.mappings.one.repository,repo);
  assert.equal(state.workspace.mappings.two.localOnly,true);
});

test('choosing one GitHub copy uses its verified repository identity without taking over another copy',async t=>{
  const projects=['one','two'].map(projectId=>({projectId,label:projectId,path:path.resolve(projectId),hostId:'local'}));
  const repo='owner/repo';
  const {open}=await fixture(t,{
    makeBridge:()=>({async connect(){},async call(method){assert.equal(method,'list_projects');return {projects};}}),
    localCatalogFallback:async()=>({threads:[],activityThreads:[],threadErrors:{}}),
    inspectRepository:async()=>({repository:repo,repositoryStatus:'github',repositoryReason:''})
  });
  const app=await open({caller:'existing-codex-caller'});
  try{
    assert.equal(await app.refreshMetadata(),true);
    const before=await status(app);
    assert.equal(before.workspace.mappings.one.localOnly,true);
    assert.equal(before.workspace.mappings.two.localOnly,true);
    assert.equal((await post(app,before.token,'workspace/select-repository',{projectId:'one',repository:'another/repo'})).status,400);
    assert.equal((await post(app,before.token,'workspace/select-repository',{projectId:'one',repository:repo})).status,200);
    assert.equal((await post(app,before.token,'workspace/select-repository',{projectId:'two',repository:repo})).status,400);
    const after=await status(app);
    assert.equal(after.workspace.mappings.one.logicalId,repositoryLogicalId(repo));
    assert.equal(after.workspace.mappings.two.localOnly,true);
    assert.equal(Boolean(after.sync.config),false);
  }finally{await app.close();}
});
