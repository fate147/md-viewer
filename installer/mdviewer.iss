; MD Viewer 安装器脚本（Inno Setup 6.7）
; 用户级安装（免管理员）：默认装到 %LocalAppData%\Programs\MDViewer。
; ⚠️ 不能装到 OneDrive 重定向的 Documents 下——.NET 加载那里的程序集会
;    失败（pythonnet netfx 解析 Python.Runtime.dll 报 Loader.Initialize，
;    2026-10-11 实测）。默认目录在 AppData\Local，天然规避。
; 安装动作：文件 → WebView2 运行时缺失时静默补装（离线包内嵌）→
;           mdviewer-assoc --install 接管 .md 关联 + 登录守护。
; 卸载动作：mdviewer-assoc --uninstall 撤销关联与守护。

#define MyAppName "MD Viewer"
#define MyAppVersion "1.0.0"

[Setup]
AppId={{F3B7A2C1-5D84-4E6A-9B0F-1C2D3E4F5A6B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=MD Viewer
DefaultDirName={localappdata}\Programs\MDViewer
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir=..\dist-app
OutputBaseFilename=MDViewerSetup-{#MyAppVersion}
Compression=lzma2/max
SolidCompression=no
WizardStyle=modern
SetupIconFile=assets\mdviewer.ico
UninstallDisplayIcon={app}\md-viewer.exe
ArchitecturesInstallIn64BitMode=x64compatible

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："; Flags: checkedonce

[Files]
Source: "..\dist-app\MDViewer\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion createallsubdirs
Source: "WebView2RuntimeX64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Icons]
Name: "{autoprograms}\MD Viewer\MD Viewer"; Filename: "{app}\md-viewer.exe"
Name: "{autodesktop}\MD Viewer"; Filename: "{app}\md-viewer.exe"; Tasks: desktopicon

[Run]
Filename: "{tmp}\WebView2RuntimeX64.exe"; Parameters: "/silent /install"; \
  Flags: runhidden waituntilterminated; Check: not WebView2Installed; \
  StatusMsg: "正在安装 WebView2 运行时（一次性，约 1 分钟）…"
Filename: "{app}\mdviewer-assoc.exe"; Parameters: "--install ""{app}"""; \
  Flags: runhidden waituntilterminated; StatusMsg: "正在接管 .md 文件关联…"
Filename: "{app}\md-viewer.exe"; Description: "立即启动 MD Viewer"; \
  Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\mdviewer-assoc.exe"; Parameters: "--uninstall"; Flags: runhidden; RunOnceId: "AssocUninstall"

[Code]
const
  WebView2Key = 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2KeyCU = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function WebView2Installed: Boolean;
begin
  Result := RegKeyExists(HKLM, WebView2Key) or RegKeyExists(HKCU, WebView2KeyCU);
end;
