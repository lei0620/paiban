import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

test('Pending Windows editor focus is awaited without accepting a different editor or draft', {skip:process.platform!=='win32'},()=>{
  const testScript=fileURLToPath(new URL('./test-support/composer-focus-regression.ps1',import.meta.url));
  const output=execFileSync('pwsh.exe',['-NoProfile','-NonInteractive','-File',testScript],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.match(output,/composer-focus cases=8 passed/);
});

test('Desktop composer verifies focus before navigation, clipboard changes and paste',async()=>{
  const script=await readFile(new URL('./scripts/fill-composer.ps1',import.meta.url),'utf8');
  const flow=script.slice(script.indexOf('$composer=Focus-Composer $target $beforeText'));
  assert.match(flow,/\$beforeText\.Length -gt 0[\s\S]*?Test-ComposerFocus \$composer[\s\S]*?Chord\(0x11,0x23\)[\s\S]*?Clipboard\]::SetText/);
  assert.match(flow,/Test-ComposerFocus \$composer[^\r\n]*\r?\n\s*if\(\[ComposerNative\]::GetClipboardSequenceNumber\(\) -ne \$clipboardSequence\)[^\r\n]*\r?\n\s*# Paste only[^\r\n]*\r?\n[^\r\n]*\$result\.retrySafe=\$false[^\r\n]*\r?\n\s*\[ComposerNative\]::Chord\(0x11,0x56\)/);
});
