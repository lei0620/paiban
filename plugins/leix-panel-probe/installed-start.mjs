import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {readInstalledDataRoot} from '../../installed-paths.mjs';
import {safeLocalPath} from '../../maintenance-policy.mjs';

export async function startInstalledPanel(port, launchId) {
  if (!/^\d{4,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535 ||
      !/^[a-f0-9]{32}$/.test(launchId)) throw Error('派板启动标识无效');

  const program = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const parent = path.dirname(program);
  const versioned = /^v\d+\.\d+\.\d+$/.test(path.basename(parent)) &&
    path.basename(path.dirname(parent)) === 'versions';
  const root = safeLocalPath(versioned ? path.resolve(parent, '../..') : parent, {directory:true});
  const settingsFile = safeLocalPath(path.join(root, 'paiban-launch.json'));
  const settingsStat = fs.lstatSync(settingsFile);
  if (!settingsStat.isFile() || settingsStat.size > 4096) throw Error('派板启动设置无效');
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  if (settings.version !== 1 || settings.port !== Number(port) || settings.id !== launchId) {
    throw Error('派板安装标识与当前插件不一致');
  }

  async function running() {
    let response;
    try {
      response = await fetch('http://127.0.0.1:' + port + '/api/service/health', {
        redirect:'error', signal:AbortSignal.timeout(1500)
      });
    } catch (error) {
      if (error.cause?.code === 'ECONNREFUSED') return false;
      throw error;
    }
    if (!response.ok || (await response.json()).launchId !== launchId) {
      throw Error('派板安装端口被其他服务占用');
    }
    return true;
  }

  if (await running()) return;
  const shell = safeLocalPath(path.join(root, 'runtime/powershell/pwsh.exe'));
  const launcher = safeLocalPath(path.join(root, 'program/scripts/installed-launch.ps1'));
  const dataRoot = readInstalledDataRoot(root);
  const env = {...process.env};
  delete env.CODEX_THREAD_ID;
  const child = spawn(shell, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
    '-File', launcher, '-DataRoot', dataRoot], {
    cwd:root, env, windowsHide:true, stdio:'ignore'
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();

  // The same installed launcher arbitrates concurrent starts with its mutex.
  const deadline = Date.now() + 18000;
  do {
    await delay(350);
    if (await running()) return;
  } while (Date.now() < deadline);
  throw Error('派板服务未能在启动时限内响应');
}
