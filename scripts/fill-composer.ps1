param([switch]$Probe,[switch]$Submit)
$composerTimingClock=$null;$composerTimingStartedAt=$null;$script:composerTiming=$null
try {$composerTimingClock=[Diagnostics.Stopwatch]::StartNew();$composerTimingStartedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}catch{}
function Start-ComposerTiming($enabled,$clock,$startedAt) {
    try {
        $script:composerTiming=$null
        if($enabled -isnot [bool] -or -not $enabled -or $null -eq $clock -or $null -eq $startedAt){return}
        $processStartedAt=([DateTimeOffset][Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()
        $script:composerTiming=@{clock=$clock;scriptStartedAt=$startedAt;processStartedAt=$processStartedAt;marks=[System.Collections.Generic.List[object]]::new()}
        $script:composerTiming.marks.Add(@{phase='script-entered';elapsedMs=0;at=$startedAt})
    }catch{$script:composerTiming=$null}
}
function Add-ComposerTimingMark($phase) {
    try {
        if($null -eq $script:composerTiming -or $phase -notin @('assemblies-ready','native-ready','target-found','composer-checked','clipboard-ready','paste-issued','text-confirmed','submit-checked','submit-invoked','finally-complete')){return}
        $script:composerTiming.marks.Add(@{phase=$phase;elapsedMs=[Math]::Round($script:composerTiming.clock.Elapsed.TotalMilliseconds,3);at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()})
    }catch{}
}
function Export-ComposerTiming($result) {
    try {
        if($null -ne $script:composerTiming){$result.timing=@{version=1;scriptStartedAt=$script:composerTiming.scriptStartedAt;processStartedAt=$script:composerTiming.processStartedAt;marks=@($script:composerTiming.marks.ToArray())}}
    }catch{}
}
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$result = @{status='failed';text='not-filled';attachmentsAdded=@();retrySafe=$true;message=''}
$clipboardChanged=$false; $clipboardSequence=0; $oldClipboard=$null
try {
    $inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
    Start-ComposerTiming $inputData.timing $composerTimingClock $composerTimingStartedAt
    if (-not $inputData.threadTitle -or -not $inputData.description) { throw '窗口上下文缺失，尚未填入' }
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type -AssemblyName System.Windows.Forms
    Add-ComposerTimingMark 'assemblies-ready'
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ComposerNative {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
    [StructLayout(LayoutKind.Sequential)] public struct Keyboard { public ushort key, scan; public uint flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int x,y; public uint data,flags,time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public Mouse mouse; [FieldOffset(0)] public Keyboard keyboard; }
    [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public InputUnion data; }
    [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, Input[] inputs, int size);
    public static void Chord(ushort modifier, ushort key) {
        if (key != 0x23 && key != 0x56) throw new InvalidOperationException("Only End and paste are allowed");
        var inputs=new Input[4]; var keys=new ushort[]{modifier,key,key,modifier};
        for(int i=0;i<4;i++){inputs[i].type=1;inputs[i].data.keyboard.key=keys[i];inputs[i].data.keyboard.flags=(keys[i]==0x23?1u:0u)|(i>=2?2u:0u);}
        if(SendInput(4,inputs,Marshal.SizeOf(typeof(Input)))!=4)throw new InvalidOperationException("Keyboard input was not confirmed");
    }
}
'@
    Add-ComposerTimingMark 'native-ready'
    $walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker
    $rawWalker=[System.Windows.Automation.TreeWalker]::RawViewWalker
    $all=[System.Windows.Automation.Condition]::TrueCondition
    function Value-Of($element) {
        $pattern=$null
        if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)) { return $pattern.Current.Value }
        return $null
    }
    function Elements-Of($element,$condition=$all) { return @($element.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)) }
    function Composer-Text($element) {
        $value=Value-Of $element
        if($null -eq $value) { return $null }
        # Chromium exposes CSS-generated hints (including dynamic suggestions) as
        # the editor value. Verify the empty paragraph's raw pseudo-element and
        # trailing break; matching a label or the placeholder class is not enough.
        $first=$rawWalker.GetFirstChild($element)
        if($first -and $first.Current.ClassName -cmatch '(^| )placeholder( |$)' -and
            -not $rawWalker.GetNextSibling($first)) {
            $pseudo=$rawWalker.GetFirstChild($first)
            # Some empty editors expose only the trailing break as their value.
            if($pseudo -and $pseudo.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and
                $pseudo.Current.ClassName -ceq 'ProseMirror-trailingBreak' -and
                $pseudo.Current.Name -in @("`n","`r`n") -and $value -ceq $pseudo.Current.Name -and
                -not $rawWalker.GetFirstChild($pseudo) -and -not $rawWalker.GetNextSibling($pseudo)) { return '' }
            if($pseudo -and $pseudo.Current.ControlType -eq [System.Windows.Automation.ControlType]::Group -and
                $pseudo.Current.ClassName -ceq '' -and $pseudo.Current.Name -ceq '') {
                $hint=$rawWalker.GetFirstChild($pseudo)
                $break=$rawWalker.GetNextSibling($pseudo)
                if($hint -and $hint.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and
                    $hint.Current.ClassName -ceq '' -and $hint.Current.Name.Length -gt 0 -and
                    -not $rawWalker.GetFirstChild($hint) -and -not $rawWalker.GetNextSibling($hint) -and
                    $break -and $break.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and
                    $break.Current.ClassName -ceq 'ProseMirror-trailingBreak' -and
                    $break.Current.Name -in @("`n","`r`n") -and
                    -not $rawWalker.GetFirstChild($break) -and -not $rawWalker.GetNextSibling($break) -and
                    ($value -ceq $hint.Current.Name -or $value -ceq ($hint.Current.Name+"`n") -or
                     $value -ceq ($hint.Current.Name+"`r`n"))) { return '' }
            }
        }
        return $value
    }
    function Board-Matches($document) {
        try {
            $uri=[Uri](Value-Of $document)
            if ($uri.GetLeftPart([UriPartial]::Authority) -ne $inputData.origin -or $uri.AbsolutePath -ne '/') { return $false }
            $parameters=@{}
            foreach($pair in $uri.Query.TrimStart('?').Split('&')) {
                $pieces=$pair.Split('=',2);if($pieces.Count -eq 2){$parameters[[Uri]::UnescapeDataString($pieces[0])]=[Uri]::UnescapeDataString($pieces[1])}
            }
            return $parameters.projectId -eq $inputData.projectId -and $parameters.threadId -eq $inputData.threadId -and
                (!$inputData.selection -or $parameters.panelSession -ceq $inputData.selection.panelSession)
        } catch { return $false }
    }
    function Test-OriginalSelection($app) {
        if(!$inputData.selection){return $true}
        $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,[string]$inputData.threadTitle)
        $rows=@($app.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition) | Where-Object {
            $classes=$_.Current.ClassName -split '\s+'
            $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
                !$_.Current.IsOffscreen -and ($classes -ccontains 'sidebar-item') -and
                (($classes -ccontains 'bg-primary-ghost-hover') -or
                 (($classes -ccontains 'bg-secondary-ghost-hover') -and
                  ($classes -ccontains 'data-[app-action-sidebar-thread-selected=true]:bg-secondary-ghost-hover')))
        })
        return $rows.Count -eq 1 -and ($rows[0].GetRuntimeId() -join '.') -ceq $inputData.selection.selectedRowId
    }
    function Find-Target {
        $processIds=@(Get-Process -Name ChatGPT,Codex -ErrorAction SilentlyContinue | ForEach-Object {$_.Id})
        $windows=@([System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,$all) | Where-Object {$_.Current.ProcessId -in $processIds -and $_.Current.NativeWindowHandle -ne 0 -and -not $_.Current.IsOffscreen})
        $matches=@(foreach($root in $windows) {
            $documentCondition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Document)
            $documents=@(Elements-Of $root $documentCondition | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document -and -not $_.Current.IsOffscreen})
            $boards=@($documents | Where-Object {Board-Matches $_})
            $apps=@($documents | Where-Object {(Value-Of $_) -like 'app://*' -and $_.Current.Name -eq $inputData.threadTitle})
            if($boards.Count -eq 1 -and $apps.Count -eq 1 -and (Test-OriginalSelection $apps[0])) { @{root=$root;app=$apps[0];window=[IntPtr]$root.Current.NativeWindowHandle;pid=$root.Current.ProcessId} }
        })
        if($matches.Count -ne 1) { throw '无法唯一核对当前聊天与侧栏，请在所属聊天打开侧栏后重试' }
        return $matches[0]
    }
    function Assert-Foreground($target,[switch]$MainWindowOnly) {
        $foreground=[ComposerNative]::GetForegroundWindow()
        if($foreground -ne $target.window -and ($MainWindowOnly -or [ComposerNative]::GetAncestor($foreground,3) -ne $target.window)) { throw '当前桌面窗口已变化，已停止填入' }
    }
    function Find-Composer($target) {
        $editCondition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)
        $editors=@(Elements-Of $target.app $editCondition | Where-Object {
            $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and
            $_.Current.ClassName -match '^ProseMirror( |$)' -and
            $_.Current.Name -in @('与 Codex 协作','和 Codex 一起工作','Collaborate with Codex','Work with Codex') -and
            $_.Current.IsEnabled -and -not $_.Current.IsOffscreen
        })
        # A ProseMirror approval response is deliberately excluded by its label.
        if($editors.Count -ne 1) { throw '未找到唯一主聊天输入框；审批或其他编辑框不会填入' }
        $parent=$editors[0]
        do { $parent=$walker.GetParent($parent) } while($parent -and $parent.Current.ControlType -ne [System.Windows.Automation.ControlType]::Document)
        if(-not $parent -or (Value-Of $parent) -notlike 'app://*') { throw '输入框不属于桌面主聊天' }
        return $editors[0]
    }
    function Assert-Target($target) {
        Assert-Foreground $target
        $fresh=Find-Target
        if($fresh.window -ne $target.window) { throw '聊天窗口已变化，已停止填入' }
        return Find-Composer $fresh
    }
    function Test-ComposerFocus($composer) {
        try {
            $focused=[System.Windows.Automation.AutomationElement]::FocusedElement
            $composerId=$composer.GetRuntimeId() -join ','
            return $null -ne $focused -and $composerId -ne '' -and ($focused.GetRuntimeId() -join ',') -ceq $composerId
        } catch [System.Windows.Automation.ElementNotAvailableException] {
            return $false
        }
    }
    function Focus-Composer($target,[string]$beforeText) {
        # The sidebar and the main editor can be in different Chromium views.
        # SetFocus may return before the desktop reports the editor as focused.
        for($attempt=0;$attempt -lt 2;$attempt++) {
            $composer=Assert-Target $target
            if($beforeText -cne (Composer-Text $composer)) { throw '输入内容已变化，尚未填入' }
            Assert-Foreground $target -MainWindowOnly
            if(-not (Test-ComposerFocus $composer)) {
                try { $composer.SetFocus() }
                catch [System.Windows.Automation.ElementNotAvailableException] { continue }
            }
            for($check=0;$check -le 8;$check++) {
                Assert-Foreground $target -MainWindowOnly
                if(Test-ComposerFocus $composer) {
                    $current=Assert-Target $target
                    if($beforeText -cne (Composer-Text $current)) { throw '输入内容已变化，尚未填入' }
                    Assert-Foreground $target -MainWindowOnly
                    if(Test-ComposerFocus $current) { return $current }
                    break
                }
                if($check -lt 8) { Start-Sleep -Milliseconds 40 }
            }
        }
        throw '未能聚焦原对话的主聊天输入框，尚未填入'
    }
    function Invoke-Control($element) {
        if(-not $element.Current.IsEnabled -or $element.Current.IsOffscreen) { throw '附件操作暂不可用' }
        $pattern=$null
        if(-not $element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) { throw '附件控件不支持安全操作' }
        $pattern.Invoke()
    }
    function Open-AttachmentMenu($element) {
        if(-not $element.Current.IsEnabled -or $element.Current.IsOffscreen) { throw '附件入口暂不可用' }
        $pattern=$null
        if($element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$pattern)) {
            if($pattern.Current.ExpandCollapseState -ne [System.Windows.Automation.ExpandCollapseState]::Collapsed) {
                throw '附件菜单已打开或状态无法核对，请检查当前聊天'
            }
            $pattern.Expand()
            return
        }
        Invoke-Control $element
    }
    function Find-FileDialog($target) {
        $dialogs=@([System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,$all) | Where-Object {
            $_.Current.ClassName -eq '#32770' -and $_.Current.ProcessId -eq $target.pid -and -not $_.Current.IsOffscreen -and
            [ComposerNative]::GetAncestor([IntPtr]$_.Current.NativeWindowHandle,3) -eq $target.window
        })
        if($dialogs.Count -gt 1) { throw '附件选择窗口不唯一，已停止' }
        if($dialogs.Count -eq 1) { return $dialogs[0] }
        return $null
    }
    function Attachment-Count($composer,$file) {
        $parent=$walker.GetParent($composer)
        return @(Elements-Of $parent | Where-Object {$_.Current.Name -eq $file.name -and -not $_.Current.IsOffscreen}).Count
    }
    function Find-AttachmentButton($composer) {
        $parent=$walker.GetParent($composer)
        $buttons=@(Elements-Of $parent | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name -in @('添加文件等内容','添加文件和更多','Add files and more','Add files') -and -not $_.Current.IsOffscreen})
        if($buttons.Count -ne 1) { throw '无法唯一找到主聊天附件入口，已停止添加附件' }
        return $buttons[0]
    }
    function Assert-File($file) {
        if(-not [IO.File]::Exists($file.path) -or (Get-Item -LiteralPath $file.path).Length -ne $file.size -or
            (Get-FileHash -LiteralPath $file.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw '任务附件缺失或校验失败，已停止添加' }
    }
    function Find-ComposerScope($composer) {
        $parent=$walker.GetParent($composer)
        while($parent -and $parent.Current.ControlType -ne [System.Windows.Automation.ControlType]::Document) {
            $elements=Elements-Of $parent
            $editors=@($elements | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $_.Current.ClassName -match '^ProseMirror( |$)'})
            if($editors.Count -ne 1 -or ($editors[0].GetRuntimeId() -join ',') -ne ($composer.GetRuntimeId() -join ',')) { throw '主聊天输入框范围不唯一，尚未操作' }
            $buttons=@($elements | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and -not $_.Current.IsOffscreen})
            $attachments=@($buttons | Where-Object {$_.Current.Name -in @('添加文件等内容','添加文件和更多','Add files and more','Add files')})
            # An idle empty composer can show voice mode instead of Send. The
            # attachment entry and dictation control still bound the same area.
            $actions=@($buttons | Where-Object {$_.Current.Name -in @('Send','Queue','Steer','Stop','Resume','发送','排队','引导','停止','继续','听写','Dictate')})
            if($attachments.Count -eq 1 -and $actions.Count -gt 0) { return $parent }
            $parent=$walker.GetParent($parent)
        }
        throw '无法核对完整聊天输入区，尚未操作'
    }
    function Assert-SubmitAttachments($composer,$expected) {
        $scope=Find-ComposerScope $composer
        if(($scope.GetRuntimeId() -join ',') -ne ($script:submitScope.GetRuntimeId() -join ',')) { throw '聊天输入区域已变化，尚未发送' }
        $elements=Elements-Of $scope
        $remove=@($elements | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name -match '^(Remove|移除|删除)'})
        if($remove.Count -ne @($expected).Count) { throw '聊天输入区附件或上下文已变化，尚未发送；请核对原草稿' }
        foreach($file in @($expected)) {
            Assert-File $file
            if(@($elements | Where-Object {$_.Current.Name -eq $file.name}).Count -lt 1) { throw '本次附件无法完整核对，尚未发送' }
        }
    }
    function Find-SubmitButton($composer) {
        $parent=$walker.GetParent($composer)
        while($parent -and $parent.Current.ControlType -ne [System.Windows.Automation.ControlType]::Document) {
            $elements=Elements-Of $parent
            $editors=@($elements | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $_.Current.ClassName -match '^ProseMirror( |$)'})
            if($editors.Count -ne 1) { throw '无法唯一核对主输入框范围，尚未发送' }
            $buttons=@($elements | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name -in @('Send','Queue','Steer','发送','排队','引导') -and -not $_.Current.IsOffscreen})
            if($buttons.Count -gt 1) { throw '正常发送按钮不唯一，尚未发送' }
            if($buttons.Count -eq 1) {
                if(-not $buttons[0].Current.IsEnabled) { throw '正常发送按钮暂不可用，尚未发送' }
                return $buttons[0]
            }
            $parent=$walker.GetParent($parent)
        }
        throw '未找到唯一正常发送按钮，正文留在输入框中，请核对'
    }
    $target=Find-Target
    Add-ComposerTimingMark 'target-found'
    if([ComposerNative]::GetForegroundWindow() -ne $target.window) { throw '请保持所属聊天桌面窗口在前台，并关闭其他弹窗后重试' }
    Assert-Foreground $target
    $composer=Find-Composer $target
    $beforeText=Composer-Text $composer
    if($null -eq $beforeText) { throw '无法读取输入框现有内容，已停止以免覆盖' }
    if($Submit -and $beforeText.Length -gt 0) { throw '当前聊天输入框已有草稿，请先处理原草稿；本次尚未填入或发送' }
    if($Submit) {
        $script:submitScope=Find-ComposerScope $composer
        Assert-SubmitAttachments -composer $composer -expected @()
    }
    $beforeFiles=@{}
    foreach($file in @($inputData.files)) {
        Assert-File $file
        $beforeFiles[$file.id]=Attachment-Count $composer $file
    }
    if(@($inputData.files).Count -gt 0) { $attachmentButton=Find-AttachmentButton $composer }
    Add-ComposerTimingMark 'composer-checked'
    if($Probe) {
        $result.status='ready';$result.message='已核对当前侧栏、对话标题及主输入框；未操作输入或附件'
    } else {
        $composer=Focus-Composer $target $beforeText
        if($beforeText.Length -gt 0) {
            Assert-Foreground $target -MainWindowOnly
            if(-not (Test-ComposerFocus $composer)) { throw '主聊天输入框已失去焦点，尚未填入' }
            [ComposerNative]::Chord(0x11,0x23)
        }
        $oldClipboard=[System.Windows.Forms.Clipboard]::GetDataObject()
        $suffix=$(if($beforeText.Length -gt 0){"`r`n"}else{''})+$inputData.description
        [System.Windows.Forms.Clipboard]::SetText($suffix)
        $clipboardChanged=$true;$clipboardSequence=[ComposerNative]::GetClipboardSequenceNumber()
        Add-ComposerTimingMark 'clipboard-ready'
        if($beforeText -cne (Composer-Text $composer)) { throw '输入内容已变化，尚未填入' }
        Assert-Foreground $target -MainWindowOnly
        if(-not (Test-ComposerFocus $composer)) { throw '主聊天输入框已失去焦点，尚未填入' }
        if([ComposerNative]::GetClipboardSequenceNumber() -ne $clipboardSequence) { throw '剪贴板内容已变化，尚未填入' }
        # Paste only; Submit uses the normal button later, never a keyboard override.
        $result.retrySafe=$false;$result.text='uncertain';$result.status='uncertain'
        [ComposerNative]::Chord(0x11,0x56)
        Add-ComposerTimingMark 'paste-issued'
        $textConfirmed=$false
        for($attempt=0;$attempt -lt 20;$attempt++) {
            Start-Sleep -Milliseconds 100
            $composer=Assert-Target $target
            $actual=(Composer-Text $composer).Replace("`r`n","`n")
            if($actual -ceq ($beforeText+$suffix).Replace("`r`n","`n")) {$textConfirmed=$true;break}
        }
        if(-not $textConfirmed) { throw '正文填入结果待核对，未继续添加附件' }
        Add-ComposerTimingMark 'text-confirmed'
        $result.text='filled';$result.status='partial'
        foreach($file in @($inputData.files)) {
            Assert-File $file
            $composer=Assert-Target $target
            Open-AttachmentMenu (Find-AttachmentButton $composer)
            $dialog=$null;$menuInvoked=$false
            for($attempt=0;$attempt -lt 25;$attempt++) {
                Start-Sleep -Milliseconds 100;Assert-Foreground $target
                $dialog=Find-FileDialog $target
                if($dialog) { break }
                $menuItems=@(Elements-Of $target.root | Where-Object {$_.Current.ControlType -in @([System.Windows.Automation.ControlType]::MenuItem,[System.Windows.Automation.ControlType]::Button) -and $_.Current.Name -in @('添加照片和文件','添加文件','上传文件','照片和文件','Add photos and files','Upload files','Photos and files') -and -not $_.Current.IsOffscreen})
                if($menuItems.Count -gt 1) { throw '附件菜单不唯一，已停止' }
                if($menuItems.Count -eq 1 -and -not $menuInvoked) { $menuInvoked=$true;Invoke-Control $menuItems[0] }
            }
            if(-not $dialog) { throw '正文已填入，附件文件选择窗口未打开' }
            $elements=Elements-Of $dialog
            $names=@($elements | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and ($_.Current.AutomationId -eq '1148' -or $_.Current.Name -in @('文件名:','文件名(N):','File name:'))})
            $open=@($elements | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.AutomationId -eq '1'})
            if($names.Count -ne 1 -or $open.Count -ne 1) { throw '附件选择控件无法唯一核对，已停止' }
            Assert-Foreground $target
            $names[0].GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($file.path)
            Invoke-Control $open[0]
            $confirmed=$false
            for($attempt=0;$attempt -lt 60;$attempt++) {
                Start-Sleep -Milliseconds 100
                Assert-Foreground $target
                if(Find-FileDialog $target) { continue }
                $composer=Assert-Target $target
                if((Attachment-Count $composer $file) -gt $beforeFiles[$file.id]) { $confirmed=$true;break }
            }
            if(-not $confirmed) { throw '正文已填入，附件添加结果待核对；不会重复添加' }
            $result.attachmentsAdded+=@($file.id)
        }
        $result.status='filled';$result.message='已填入当前聊天，消息尚未发送；编辑草稿继续保留'
        if($Submit) {
            $result.status='partial';$result.message='正文已填入但尚未发送，请核对当前聊天；不会自动重试'
            $composer=Assert-Target $target
            if((Composer-Text $composer).Replace("`r`n","`n") -cne $inputData.description.Replace("`r`n","`n")) { throw '主输入内容已变化，尚未发送；请核对当前草稿' }
            foreach($file in @($inputData.files)) { Assert-File $file;if((Attachment-Count $composer $file) -le $beforeFiles[$file.id]) { throw '附件尚未完整确认，尚未发送' } }
            $button=Find-SubmitButton $composer
            $pattern=$null
            if(-not $button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) { throw '正常发送按钮不支持安全提交，正文仍在输入框中' }
            $composer=Assert-Target $target
            if((Composer-Text $composer).Replace("`r`n","`n") -cne $inputData.description.Replace("`r`n","`n")) { throw '提交前主输入内容已变化，尚未发送' }
            $freshButton=Find-SubmitButton $composer
            if(($freshButton.GetRuntimeId() -join ',') -ne ($button.GetRuntimeId() -join ',')) { throw '提交按钮已变化，尚未发送' }
            Assert-SubmitAttachments -composer $composer -expected @($inputData.files)
            Add-ComposerTimingMark 'submit-checked'
            $result.status='uncertain';$result.message='提交结果待核对，不会自动重发'
            $pattern.Invoke()
            Add-ComposerTimingMark 'submit-invoked'
            $result.status='invoked';$result.message='已点击聊天正常发送按钮；排队、引导及提交结果由原聊天处理'
        }
    }
} catch {
    $result.message=$_.Exception.Message
} finally {
    if($clipboardChanged -and [ComposerNative]::GetClipboardSequenceNumber() -eq $clipboardSequence) {
        try { if($oldClipboard){[System.Windows.Forms.Clipboard]::SetDataObject($oldClipboard,$true)}else{[System.Windows.Forms.Clipboard]::Clear()} } catch { }
    }
    Add-ComposerTimingMark 'finally-complete'
    Export-ComposerTiming $result
}
$result | ConvertTo-Json -Depth 4 -Compress
