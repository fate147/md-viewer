# 模块：打包交付（installer/ + dist-app/）

> 文档状态：活文档（随代码原地更新） ｜ 最后更新：2026-10-12

## 交付形态

`MDViewerSetup-1.0.0.exe`（Inno Setup，~230MB，内嵌 WebView2 离线运行时 190MB）。
用户级安装（免管理员）到 `%LocalAppData%\Programs\MDViewer`：

```
MDViewer\
  md-viewer.exe        ← C# 启动器（md-launcher.cs，csc -target:winexe）
  mdviewer-assoc.exe   ← .md 关联守护（--install/--uninstall/--assert）
  runtime\             ← 便携 Python 3.12（本机安装拷贝剪枝，~155MB）
  app\                 ← src 全量（main.pyw / ui / core / services / assets）
```

安装动作：文件落盘 → 检测 WebView2 运行时（注册表 EdgeUpdate Clients），
缺失则静默跑内嵌离线包 → `mdviewer-assoc --install <dir>` 接管 .md 关联 +
写登录守护 → 桌面/开始菜单快捷方式。卸载：`--uninstall` 撤销关联与守护。

## 为什么不是 PyInstaller

pythonnet 的 netfx 加载器在**任何冻结构建**里都解析不到
`Python.Runtime.Loader.Initialize`（PE 导出表为空，入口经 CLR 解析；
冻结进程内 Assembly.LoadFrom 静默失败）。实测矩阵：PyInstaller
5.13.2/6.0.0/6.22.3 × pythonnet 3.0.3~3.2.1 × clr_loader 0.2.6/0.3.1
全部失败，同一套 DLL 源码模式正常。旧 onedir 包"能跑"是 tkinterweb
静默回退救的——WebView2 从未在冻结环境工作过。便携运行时方案 = 直接
分发源码模式的完整环境，零冻结层，全部已验证行为原样保留。

## 关键坑（详见 AGENTS.md 铁律）

- **Documents（OneDrive 已知文件夹）毒性**：.NET 加载该树下程序集失败；
  Inno 安装器从 Documents 路径启动会秒退（exit 1 无日志），或在复制/关联
  接管阶段报 `Error 5 拒绝访问`（2026-10-12 复现，同一坑两种表现）。
  仓库就在 Documents 下，所以 `dist-app\` 出的包**必须拷到
  `%USERPROFILE%\Build\md-viewer\` 再双击**；就地运行必翻车。
- 双击 .md 启动时 CWD = 文件所在目录：启动器在 C# 侧固定
  WorkingDirectory=安装根；源码冻结模式在 main.pyw 做 chdir（frozen-only）。
- 验证打包结果必须数 `msedgewebview2` 子进程（CIM 按 ParentProcessId），
  只看标题/进程存活会被静默回退骗过。

## 图标

唯一源 = `installer/assets/mdviewer-icon.svg`（自绘：纸白页 + 蓝色 `Md` 字样，
蓝取 pure 主题强调色 `#0366d6`）。`.md` 文件图标由 `mdviewer-assoc` 写
`DefaultIcon = md-viewer.exe,0`，所以**改图标只需重编 `md-viewer.exe`**，
不必单独出文件图标。

生成链（无 Pillow / Inkscape 依赖，纯标准库 + 本机 Edge）：

1. `bash tools/icon/render_svg.sh` —— Edge headless 把 SVG 精确渲染成
   16/24/32/48/64/128/256 七档透明 PNG 到 `%LOCALAPPDATA%\mdv-icon`。
2. `python tools/icon/build_ico.py %LOCALAPPDATA%\mdv-icon installer/assets/mdviewer.ico`
   —— ≤128 写经典 32bpp BMP-DIB 条目，256 内嵌 PNG。
3. 两个 exe 都要 `-win32icon`（见 AGENTS.md 打包命令），`mdviewer.iss` 另有
   `SetupIconFile`；运行时标题栏/任务栏图标由 `main.pyw::_set_window_icon`
   走 `assets/mdviewer.ico`。

坑：① `csc` 传绝对路径的 `.cs` 会被吞成文件名，必须在 `installer\` 下用相对路径；
② Windows 图标缓存很顽固：`.md` 文件图标走 `mdfile\DefaultIcon =
md-viewer.exe,0`，原地换 exe 后 shell 不重读，用 `SHChangeNotify(SHCNE_ASSOCCHANGED,
SHCNF_FLUSH)` 通知，仍不刷就清图标缓存 + 重启 explorer；③ 图标改动后
`dist-app\MDViewer\` 里的
两个 exe 极易漏同步（2026-10-12 就漏了 `mdviewer-assoc.exe`，装出来一个有一个没有），
出包前 `cmp` 一遍源与负载。

## 重建步骤

1. 组装负载：拷本机 Python312 → `dist-app\MDViewer\runtime`（删 numpy/
   PIL/PyInstaller 等无关包至 ~155MB）；`src` → `app`（含 `assets\mdviewer.ico`）；
   csc 带 `-win32icon` 编译 `md-viewer.exe` **和** `mdviewer-assoc.exe`，两个都拷进负载。
2. WebView2 离线包：`curl -L -o installer/WebView2RuntimeX64.exe
   https://go.microsoft.com/fwlink/?linkid=2099617`（190MB）。
3. `ISCC installer\mdviewer.iss` → `dist-app\MDViewerSetup-<ver>.exe`。
   （ISCC 相对路径基于 iss 所在目录；Inno Setup 6.7+ 可 winget 安装。）
4. 🔥 **换出 Documents 再装**：`cp dist-app\MDViewerSetup-<ver>.exe
   %USERPROFILE%\Build\md-viewer\`，从那里双击（就地跑会秒退或 Error 5）。
5. 静默装实测：`Setup.exe /VERYSILENT /NORESTART /LOG=<路径>`，然后
   查 MainWindowTitle + msedgewebview2 子进程 + 双击 .md 仿真。

dist-app/ 与 WebView2RuntimeX64.exe 不入库（.gitignore）。
