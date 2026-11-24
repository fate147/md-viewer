# 打包与发布操作手册（MD Viewer）

> 2026-11-24 从 `AGENTS.md`「常用命令」拆出的操作细节。**规则**仍在 `AGENTS.md`：
> 铁律三要求执行类命令（回归脚本、出包）必须先得到用户「测一下 / 出包」的授权。
> 所有生成物固定在项目内 `dist-app/`，禁止复制到项目外、Documents、OneDrive 或桌面。

## 一、开发运行

```bash
pip install -r requirements.txt
pip install "clr-loader==0.2.6" --no-deps   # 第二步不可省：漏了会装 0.3.x，启动报「运行时装配失败」
python src/main.pyw                          # 双击 run.bat 亦可，它会自检 Python 版本与依赖
```

## 二、回归脚本（未经授权不得运行）

```bash
python test_bridge_integration.py   # 桥链路：装载/编辑/保存/多标签隔离 → INTEGRATION_PASS
python smoke_app.py                 # 冒烟：启动→页面就绪→开始页（零文档） → SMOKE_PASS
python perf_baseline.py             # 2.3MB 性能基线（在项目内 tmp/ 副本上测，不碰原文件）
```

## 三、前端 bundle 重建

```bash
cd tools/cm6 && npm install && npm run build     # 改 tools/cm6/entry.js 之后
```

## 四、出包流程（按顺序，任一闸失败即中止）

```bash
# ① 编译两个 C# exe（必须在 installer/ 下用相对路径跑；绝对路径会被 csc 吞成文件名）
CSC=C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe
cd installer
$CSC -nologo -target:winexe -win32icon:assets/mdviewer.ico -out:../dist-app/MDViewer/md-viewer.exe md-launcher.cs
$CSC -nologo -target:winexe -win32icon:assets/mdviewer.ico -out:mdviewer-assoc.exe mdviewer-assoc.cs
cp mdviewer-assoc.exe ../dist-app/MDViewer/
#   一键版：双击 tools/pack/build_exe.bat（纯 ASCII，相对路径已内置）

# ② 同步源码到负载（D-03：必须 diff 校验）
cp -r src/. dist-app/MDViewer/app/
cp installer/assets/mdviewer.ico dist-app/MDViewer/app/assets/
diff -rq src dist-app/MDViewer/app          # 必须无输出（唯一允许 mdviewer.ico）

# ③ 三个闸（缺一即中止，见 specs/01 R-01-05；项目在 C:\Projects 非同步树，原地验证）
cd dist-app/MDViewer
runtime/python.exe -B -c "import clr; print('CLR_OK')"                                            # CLR_OK
runtime/python.exe -B -c "from tkwebview2.tkwebview2 import have_runtime; print(have_runtime())"  # True
runtime/pythonw.exe app/main.pyw                                                                  # 窗口出现

# ④ WebView2 离线运行时（不入库，只在缺时下载）
curl -L -o installer/WebView2RuntimeX64.exe https://go.microsoft.com/fwlink/?linkid=2099617

# ⑤ 出安装包（产物固定落 dist-app/）
"$LOCALAPPDATA/Programs/Inno Setup 6/ISCC.exe" installer/mdviewer.iss
#    → dist-app/MDViewerSetup-<版本>.exe

# ⑥ 安装验证直接从项目内跑，禁止复制到项目外
dist-app/MDViewerSetup-<版本>.exe
dist-app/MDViewerSetup-<版本>.exe /VERYSILENT /NORESTART    # 静默装
```

## 五、图标改版

```bash
bash tools/icon/render_svg.sh tmp/icon        # Edge headless 渲 7 档尺寸到 tmp/icon
                                              #   N<=48 用 small 版、64 起用主版（见脚本头注释）
python tools/icon/build_ico.py tmp/icon installer/assets/mdviewer.ico
# 然后：重编两个 exe + 拷 ico 进 dist-app/MDViewer/app/assets/ + 重跑 ISCC
# 桌面图标有缓存：taskkill /f /im explorer.exe & explorer.exe 或 ie4uinit -show
```

## 六、发版时同步的三处

| 改什么 | 在哪改 |
|---|---|
| 安装包版本号 | `installer/mdviewer.iss` `#define MyAppVersion` |
| 进度台账版本行 | `TODO.md`「当前版本：vX.Y.Z」（闸门 C2 会校验两处一致） |
| 对外版本记录 | `CHANGELOG.md` |

> 规格变更另记 `specs/spec-changelog.md`（对内流水账，与对外的 `CHANGELOG.md` 不同）。
> 历史安装包只保留最新一个，旧的直接删。
