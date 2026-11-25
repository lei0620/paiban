$ErrorActionPreference='Stop'

$tokens=$null
$errors=$null
$scriptPath=Join-Path $PSScriptRoot '../scripts/fill-composer.ps1'
$ast=[System.Management.Automation.Language.Parser]::ParseFile($scriptPath,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors -join [Environment]::NewLine)}
foreach($name in @('Test-ComposerFocus','Focus-Composer')){
    $function=$ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
    },$true)
    if(-not $function){throw "Missing composer function: $name"}
    $simulation=$function.Extent.Text.Replace('System.Windows.Automation.','ComposerFocusFixture.')
    . ([scriptblock]::Create($simulation))
}

# Provide simulated UI Automation elements without querying the desktop.
Add-Type @'
using System;
namespace ComposerFocusFixture {
    public class ElementNotAvailableException : Exception {}
    public class AutomationElement {
        public static Func<AutomationElement> ReadFocus;
        public static AutomationElement FocusedElement => ReadFocus();
        public int Id, FocusRequests;
        public bool Unavailable;
        public string Text = "";
        public int[] GetRuntimeId() {
            if (Unavailable) throw new ElementNotAvailableException();
            return new int[] { 0, Id };
        }
        public void SetFocus() { FocusRequests++; }
    }
}
'@
function Assert-Target($target){
    $script:targetChecks++
    if($script:targetChanged -and $script:waits){throw 'changed chat'}
    return $script:editor
}
function Assert-Foreground($target,[switch]$MainWindowOnly){
    if(-not $MainWindowOnly){throw 'expected main-window check'}
    if($script:windowChanged -and $script:waits){throw 'changed window'}
}
function Composer-Text($composer){return $composer.Text}
function Start-Sleep([int]$Milliseconds){
    if($Milliseconds -ne 40){throw 'unexpected wait interval'}
    $script:waits++
    if($script:draftChanged){$script:editor.Text='a new local draft'}
}
function Setup {
    $script:editor=[ComposerFocusFixture.AutomationElement]::new()
    $script:editor.Id=1
    $script:sidebar=[ComposerFocusFixture.AutomationElement]::new()
    $script:sidebar.Id=2
    $script:waits=0
    $script:targetChecks=0
    $script:windowChanged=$false
    $script:targetChanged=$false
    $script:draftChanged=$false
}
function Expect-Failure([string]$message){
    try { $null=Focus-Composer @{} '' } catch {
        if($_.Exception.Message -notlike "*$message*"){throw}
        return
    }
    throw "Expected rejection: $message"
}

Setup
[ComposerFocusFixture.AutomationElement]::ReadFocus={ $script:editor }
if((Focus-Composer @{} '') -ne $editor -or $editor.FocusRequests -ne 0 -or $waits -ne 0){throw 'Already focused should complete without delay'}

Setup
[ComposerFocusFixture.AutomationElement]::ReadFocus={
    if($script:editor.FocusRequests -eq 1 -and $script:waits -ge 3){return $script:editor}
    return $script:sidebar
}
if((Focus-Composer @{} '') -ne $editor -or $editor.FocusRequests -ne 1 -or $waits -ne 3 -or $targetChecks -ne 2){throw 'Delayed UI Automation focus should be awaited and revalidated'}

Setup
[ComposerFocusFixture.AutomationElement]::ReadFocus={
    if($script:editor.FocusRequests -ge 2){return $script:editor}
    return $script:sidebar
}
if((Focus-Composer @{} '') -ne $editor -or $editor.FocusRequests -ne 2 -or $waits -ne 8){throw 'Refocus should be bounded and succeed before typing'}

Setup
[ComposerFocusFixture.AutomationElement]::ReadFocus={ $script:sidebar }
Expect-Failure '未能聚焦'
if($editor.FocusRequests -ne 2 -or $waits -ne 16){throw 'A different focused control must never be accepted'}

Setup
$sidebar.Unavailable=$true
[ComposerFocusFixture.AutomationElement]::ReadFocus={
    if($script:waits -gt 0){return $script:editor}
    return $script:sidebar
}
if((Focus-Composer @{} '') -ne $editor){throw 'A stale focus observation should not prevent a valid focus'}

Setup
$windowChanged=$true
[ComposerFocusFixture.AutomationElement]::ReadFocus={ $script:sidebar }
Expect-Failure 'changed window'
if($editor.FocusRequests -ne 1){throw 'A different window must cancel focus attempts'}

Setup
$targetChanged=$true
[ComposerFocusFixture.AutomationElement]::ReadFocus={
    if($script:waits -gt 0){return $script:editor}
    return $script:sidebar
}
Expect-Failure 'changed chat'

Setup
$draftChanged=$true
[ComposerFocusFixture.AutomationElement]::ReadFocus={
    if($script:waits -gt 0){return $script:editor}
    return $script:sidebar
}
Expect-Failure '输入内容已变化'
Write-Output 'composer-focus cases=8 passed'
