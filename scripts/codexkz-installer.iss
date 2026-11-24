#ifndef PayloadDir
  #error PayloadDir is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif
#ifndef ProductVersion
  #error ProductVersion is required
#endif

[Setup]
#ifdef IsolatedTest
AppId={{6F26C4FC-1847-44E2-B8F1-E49B19D9D40B}
Uninstallable=no
#else
AppId={{37C3F9AB-6301-4C31-83EA-28E530D93995}
Uninstallable=yes
#endif
AppName=派板 (Paiban)
AppVersion={#ProductVersion}
DefaultDirName={localappdata}\Paiban
UsePreviousAppDir=no
DefaultGroupName=派板
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=no
RestartApplications=no
OutputDir={#OutputDir}
#ifdef IsolatedTest
OutputBaseFilename=CodexKZ-{#ProductVersion}-test-only
Compression=zip
SolidCompression=no
#else
OutputBaseFilename=Paiban-Setup-v{#ProductVersion}-win-x64
Compression=lzma2
SolidCompression=yes
#endif
WizardStyle=modern
SetupIconFile={#PayloadDir}\program\assets\paiban.ico
UninstallDisplayIcon={app}\program\assets\paiban.ico

[Files]
Source: "{#PayloadDir}\program\*"; DestDir: "{app}\program"; Flags: ignoreversion onlyifdoesntexist recursesubdirs createallsubdirs
Source: "{#PayloadDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion onlyifdoesntexist recursesubdirs createallsubdirs

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Icons]
Name: "{app}\启动本机面板"; Filename: "{app}\runtime\powershell\pwsh.exe"; Parameters: "{code:LauncherArguments}"; WorkingDir: "{app}\program"; IconFilename: "{app}\program\assets\paiban.ico"
Name: "{app}\恢复未完成升级"; Filename: "{app}\runtime\powershell\pwsh.exe"; Parameters: "{code:RecoveryArguments}"; WorkingDir: "{app}\program"
#ifndef IsolatedTest
Name: "{group}\派板"; Filename: "{app}\runtime\powershell\pwsh.exe"; Parameters: "{code:LauncherArguments}"; WorkingDir: "{app}\program"; IconFilename: "{app}\program\assets\paiban.ico"
Name: "{group}\接入 Codex 白板"; Filename: "{app}\runtime\powershell\pwsh.exe"; Parameters: "{code:ConnectArguments}"; WorkingDir: "{app}\program"

[Run]
Filename: "{app}\runtime\powershell\pwsh.exe"; Parameters: "{code:LauncherArguments}"; WorkingDir: "{app}\program"; Description: "打开派板"; Flags: postinstall skipifsilent nowait runhidden
#endif

[Messages]
WelcomeLabel2=派板需要已安装并运行的 Codex 桌面应用。%n%n请先关闭其他安装程序。现有运行任务不会被强制结束。

[Code]
var
  SourcePage: TInputDirWizardPage;
  ModePage: TInputOptionWizardPage;
  ConnectPage: TOutputMsgMemoWizardPage;
  DataOverride, BackupOverride: String;

function CreateDirectoryExclusive(Path: String; SecurityAttributes: LongWord): Boolean;
  external 'CreateDirectoryW@kernel32.dll stdcall';

function DataDirectory: String;
begin
  if DataOverride <> '' then Result := DataOverride
  else Result := ExpandConstant('{app}\userdata');
end;

function BackupDirectory: String;
begin
  if BackupOverride <> '' then Result := BackupOverride
  else Result := ExpandConstant('{app}\backups');
end;

function LauncherArguments(Param: String): String;
begin
  Result := '-NoProfile -WindowStyle Hidden -File ' + AddQuotes(ExpandConstant('{app}\program\scripts\installed-launch.ps1')) + ' -DataRoot ' + AddQuotes(DataDirectory) + ' -OpenBrowser';
end;

function ConnectArguments(Param: String): String;
begin
  Result := '-NoProfile -WindowStyle Hidden -File ' + AddQuotes(ExpandConstant('{app}\program\scripts\installed-launch.ps1')) + ' -DataRoot ' + AddQuotes(DataDirectory) + ' -ConnectCodex';
end;

function RecoveryArguments(Param: String): String;
begin
  Result := '-NoProfile -NoExit -File ' + AddQuotes(ExpandConstant('{app}\program\scripts\installed-recover.ps1')) + ' -DataRoot ' + AddQuotes(DataDirectory);
end;

function SafeAbsoluteDirectory(Value: String): Boolean;
begin
  Result := False;
  if Length(Value) < 4 then exit;
  Result := (Value[2] = ':') and
    ((Value[3] = '\') or (Value[3] = '/')) and
    (Uppercase(Copy(Value, 1, 2)) <> 'E:') and
    (Pos('"', Value) = 0);
end;

function NoRedirectedPath(Value: String): Boolean;
var Current, Parent: String; Item: TFindRec;
begin
  Result := False;
  Current := ExpandFileName(Value);
  while Length(Current) > 3 do begin
    if FindFirst(Current, Item) then begin
      try
        if (Item.Attributes and FILE_ATTRIBUTE_REPARSE_POINT) <> 0 then exit;
      finally
        FindClose(Item);
      end;
    end;
    Parent := ExtractFileDir(Current);
    if (Parent = '') or (Parent = Current) then exit;
    Current := Parent;
  end;
  Result := True;
end;

function PathsOverlap(Left, Right: String): Boolean;
var L, R: String;
begin
  L := Uppercase(AddBackslash(ExpandFileName(Left)));
  R := Uppercase(AddBackslash(ExpandFileName(Right)));
  Result := (Copy(L, 1, Length(R)) = R) or (Copy(R, 1, Length(L)) = L);
end;

procedure InitializeWizard;
var SourceArg: String;
begin
  SourceArg := ExpandConstant('{param:SourceRoot|}');
  ModePage := CreateInputOptionPage(wpSelectDir, '选择安装方式',
    '请选择全新安装或迁移旧数据', '迁移前请正常停止旧面板；原源码与数据不会覆盖。', True, False);
  ModePage.Add('全新安装');
  ModePage.Add('迁移旧源码项目数据');
  ModePage.Values[0] := SourceArg = '';
  ModePage.Values[1] := SourceArg <> '';
  SourcePage := CreateInputDirPage(ModePage.ID, '旧源码项目目录',
    '请选择原项目目录', '仅在旧面板停止并且没有未决操作时迁移。', False, '');
  SourcePage.Add('旧源码项目目录：');
  ConnectPage := CreateOutputMsgMemoPage(SourcePage.ID, '打开派板',
    '安装后可以从开始菜单打开派板', '首次打开时，在网页中按步骤连接 Codex。', '');
  DataOverride := ExpandConstant('{param:DataRoot|}');
  BackupOverride := ExpandConstant('{param:BackupRoot|}');
  SourcePage.Values[0] := SourceArg;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = ConnectPage.ID then
    ConnectPage.RichEditViewer.Lines.Text :=
      '点击安装完成页的“打开派板”，面板会在浏览器中打开。以后可以从开始菜单再次打开。' + #13#10 + #13#10 +
      '第一次使用时，打开 Codex 桌面中的一个聊天，在派板网页点击“开始设置”。使用聊天链接或 ID 完成连接。' + #13#10 + #13#10 +
      '如果想在 Codex 聊天里打开白板，从开始菜单选择“接入 Codex 白板”。接入提示出现后，完成手头的工作并重新打开 Codex。';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = SourcePage.ID) and ModePage.Values[0];
end;

function PathProblem(CheckSource: Boolean): String;
var AppPath, DataPath, BackupPath, SourcePath: String;
  DefaultData, DefaultBackup: Boolean;
begin
  Result := '';
  AppPath := ExpandConstant('{app}');
  DataPath := DataDirectory;
  BackupPath := BackupDirectory;
  DefaultData := CompareText(ExpandFileName(DataPath), ExpandConstant('{app}\userdata')) = 0;
  DefaultBackup := CompareText(ExpandFileName(BackupPath), ExpandConstant('{app}\backups')) = 0;
  SourcePath := SourcePage.Values[0];
  if not SafeAbsoluteDirectory(AppPath) or not SafeAbsoluteDirectory(DataPath) or not SafeAbsoluteDirectory(BackupPath) then
    Result := '请填写获准的本机绝对路径；不使用网络路径或 E 盘。'
  else if not NoRedirectedPath(AppPath) or not NoRedirectedPath(DataPath) or not NoRedirectedPath(BackupPath) then
    Result := '目录包含重定向，未安装。'
  else if (not DefaultData and PathsOverlap(AppPath, DataPath)) or PathsOverlap(DataPath, BackupPath) or (not DefaultBackup and PathsOverlap(AppPath, BackupPath)) then
    Result := '数据和备份目录不能覆盖程序或互相包含。'
  else if CheckSource and ModePage.Values[1] and not SafeAbsoluteDirectory(SourcePath) then
    Result := '旧源码目录必须是获准的本机绝对路径。'
  else if CheckSource and ModePage.Values[1] and not NoRedirectedPath(SourcePath) then
    Result := '旧源码目录包含重定向，未迁移。'
  else if CheckSource and ModePage.Values[1] and (not DirExists(SourcePath) or not DirExists(AddBackslash(SourcePath) + 'data')) then
    Result := '旧源码目录或其 data 目录不存在。'
  else if CheckSource and ModePage.Values[1] and (PathsOverlap(SourcePath, AppPath) or PathsOverlap(SourcePath, DataPath) or PathsOverlap(SourcePath, BackupPath)) then
    Result := '旧源码、程序、数据和备份目录必须彼此独立。'
  else if DirExists(AppPath) or FileExists(AppPath) then
    Result := '程序目录已存在，为保护已有文件，本安装器不会覆盖。'
  else if DirExists(DataPath) or FileExists(DataPath) then
    Result := '数据目录已存在，为保护已有数据，本安装器不会覆盖。'
  else if FileExists(BackupPath) then
    Result := '备份目录不能是文件。'
  else if not DirExists(ExtractFileDir(AppPath)) then
    Result := '程序目录的父目录不存在，请选择已有父目录下的新目录。'
  else if not DefaultData and not DirExists(ExtractFileDir(DataPath)) then
    Result := '数据目录的父目录不存在，请选择已有父目录下的新目录。';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var Problem: String;
begin
  Result := True;
  if (CurPageID = ModePage.ID) or (CurPageID = SourcePage.ID) then begin
    Problem := PathProblem(CurPageID = SourcePage.ID);
    if Problem <> '' then begin MsgBox(Problem, mbError, MB_OK); Result := False; end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := PathProblem(True);
  if (Result = '') and not CreateDirectoryExclusive(ExpandConstant('{app}'), 0) then
    Result := '程序目录无法独占创建或已被占用，未覆盖任何文件。';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var ExitCode: Integer; Arguments, BackupTarget: String; Detected: Boolean;
begin
  if CurStep = ssPostInstall then begin
    Arguments := AddQuotes(ExpandConstant('{app}\program\scripts\check-installed.mjs')) + ' ' + AddQuotes(ExpandConstant('{app}\program'));
    if not Exec(ExpandConstant('{app}\runtime\node\node.exe'), Arguments, ExpandConstant('{app}\program'), SW_HIDE, ewWaitUntilTerminated, ExitCode) or (ExitCode <> 0) then
      RaiseException('安装文件检查失败，未初始化或覆盖数据。');
    if ModePage.Values[0] then begin
      Arguments := AddQuotes(ExpandConstant('{app}\program\scripts\initialize-installed-data.mjs')) + ' ' +
        AddQuotes(ExpandConstant('{app}\program')) + ' ' + AddQuotes(DataDirectory) + ' ' + AddQuotes(BackupDirectory);
      if not Exec(ExpandConstant('{app}\runtime\node\node.exe'), Arguments, ExpandConstant('{app}\program'), SW_HIDE, ewWaitUntilTerminated, ExitCode) or (ExitCode <> 0) then
        RaiseException('数据初始化失败；已有数据未覆盖。请保留未完成目录并检查备份位置。');
    end else begin
      if not ForceDirectories(BackupDirectory) or not NoRedirectedPath(BackupDirectory) then
        RaiseException('备份目录不可用或被重定向，未迁移原数据。');
      BackupTarget := AddBackslash(BackupDirectory) + GetDateTimeString('yyyy-mm-dd_hhnn', '-', '-') + '_数据迁移_' + GetDateTimeString('sszzz', '-', '-');
      Arguments := AddQuotes(ExpandConstant('{app}\program\scripts\migrate-installed-data.mjs')) + ' ' +
        AddQuotes(SourcePage.Values[0]) + ' ' + AddQuotes(DataDirectory) + ' ' + AddQuotes(BackupTarget) + ' ' + AddQuotes(BackupDirectory);
      if not Exec(ExpandConstant('{app}\runtime\node\node.exe'), Arguments, ExpandConstant('{app}\program'), SW_HIDE, ewWaitUntilTerminated, ExitCode) or (ExitCode <> 0) then
        RaiseException('迁移未完成；请检查旧面板是否已正常停止并核对备份。原目录未覆盖。');
    end;
    Arguments := AddQuotes(ExpandConstant('{app}\program\scripts\installed-plugin.mjs')) + ' create';
    if not Exec(ExpandConstant('{app}\runtime\node\node.exe'), Arguments, ExpandConstant('{app}\program'), SW_HIDE, ewWaitUntilTerminated, ExitCode) or (ExitCode <> 0) then
      RaiseException('创建 Codex 插件接入文件失败。请保留已初始化的数据目录。');
    Arguments := '-NoProfile -NonInteractive -File ' + AddQuotes(ExpandConstant('{app}\program\scripts\check-codex-desktop.ps1'));
    Detected := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Arguments, '', SW_HIDE, ewWaitUntilTerminated, ExitCode);
    if not Detected or (ExitCode <> 0) then
      MsgBox('未能确认已安装 Codex 桌面应用。请自行安装并运行 Codex 后，再接入本聊天白板。', mbInformation, MB_OK);
  end;
end;
