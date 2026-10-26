# MD Viewer

> 无干扰的 Windows 桌面 Markdown 阅读与写作工具。界面的存在是为了被遗忘。

打开即读，F2 即写，装完接管 `.md` 关联。无账号、无网络、无遥测。

## 特性

- **纸间微光排版**：衬线窄栏、两端对齐、段首缩进；四套主题（paper / midnight / forest / purple）
- **双排版模式**：自动识别「书卷」（小说/长文，卷章分层）与「文档」（笔记/技术文档），也可手动切换
- **大文件流畅**：2.3MB 纯文本实测 —— 打开 1.23s / F2 带重渲 65ms / 切回 12ms
- **编辑即写作**：CodeMirror 6 源码编辑，与阅读层同页 F2 秒切，光标锚点自动对齐
- **多标签**：上限 8 个，会话恢复 + 最近文件
- **本地优先**：配置只存在本地 JSON

## 架构

WebView2 **单页双态**：编辑层（CodeMirror 6）与阅读层（marked + highlight.js）常驻同一个
Chromium 页面，靠 `hidden` 属性切换；Tk 只做窗口壳。文本缓冲权威在页面 `state.docs`，
Python 只存元数据，落盘经桥异步拉全文（分块 100K，轮询 120ms）。

```
Tk 窗口壳 ────── WebView2 (Chromium)
  菜单 / 状态栏     ├─ 编辑层 CodeMirror 6
  文件对话框        ├─ 阅读层 marked + hljs
                    ├─ 标签条
                    └─ 桥（分块 / 轮询）
```

## 快速开始

源码运行（需要 Python 3.12 与 WebView2 Runtime）：

```bash
pip install tkwebview2==3.5.0 pywebview==4.4.1 pythonnet==3.2.0
python src/main.pyw
```

安装版：`MDViewerSetup-x.y.z.exe`，用户级安装（免管理员权限），内嵌 WebView2 离线运行时。

## 已知限制

- 仅 Windows（依赖 WebView2 + .NET Framework 4.6.2+）
- **不要把程序放在 Documents / OneDrive 等同步目录下运行** —— .NET 的
  `Assembly.LoadFrom` 在这些目录会失败（详见 `specs/01` R-01-05）
- 标签上限 8 个；不做插件、不做云同步

## 工程方法：规格驱动开发（SDD）

本项目刻意采用 SDD：`specs/` 是代码必须满足的**契约**，`docs/` 仅为历史参考。

三条铁律：

1. **先查后改** —— 任何改动先出只读排查报告（带 `文件:行号`），拍板后才动代码
2. **先改规格再改代码** —— 行为变更先改 `specs/01~07` 对应规则条目
3. **不跑未经授权的测试**

```
specs/       规格宪法（01 启动 / 02 标签 / 03 双态 / 04 主题 / 05 桥 / 06 配置 / 07 导出）
src/         应用源码
installer/   C# 启动器 + Inno Setup 脚本
tools/       CodeMirror bundle 与图标生成链
docs/        历史文档（架构、决策、日志、归档）
```

## 技术栈

Python 3.12 · pywebview + tkwebview2（pythonnet / WebView2）· Tk（窗口壳）·
CodeMirror 6 · marked · highlight.js · Inno Setup 6

## License

[MIT](LICENSE)
