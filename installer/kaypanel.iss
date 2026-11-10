#define MyAppName "KayPanel"
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#ifndef MyAppVerName
  #define MyAppVerName "v0.0.0-dev"
#endif

[Setup]
AppId={{8C1B7F0E-6C4A-4C55-9E6A-3B1D5B7A9F21}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVerName}
AppPublisher=KayPanel
AppPublisherURL=https://github.com/kaynai1/kaypanel
AppSupportURL=https://github.com/kaynai1/kaypanel
AppUpdatesURL=https://github.com/kaynai1/kaypanel/releases
DefaultDirName={localappdata}\Programs\KayPanel
DefaultGroupName=KayPanel
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=Output
OutputBaseFilename=KayPanel-Setup-{#MyAppVerName}
SetupIconFile=app.ico
UninstallDisplayIcon={app}\KayPanel.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
MinVersion=10.0.17763
CloseApplications=yes
RestartApplications=no
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany=KayPanel
VersionInfoProductName={#MyAppName}
VersionInfoDescription=KayPanel 服务器管理面板

[Languages]
Name: "chinesesimp"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："

[Files]
Source: "..\build\KayPanel.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\KayPanel"; Filename: "{app}\KayPanel.exe"
Name: "{autodesktop}\KayPanel"; Filename: "{app}\KayPanel.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\KayPanel.exe"; Description: "启动 KayPanel"; Flags: nowait postinstall skipifsilent
Filename: "{app}\KayPanel.exe"; Flags: nowait; Check: WizardSilent
