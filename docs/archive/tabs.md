# 模块：多标签页（F03）

> 文档状态：活文档（随代码原地更新） ｜ 最后更新：2026-09-14

## 功能
同时打开多个文件，标签切换/关闭/未保存 ● 标记；切换保留各自撤销栈与光标；关闭未保存有确认。

## 实现
- **元数据**（core/session.py，审计 2.2 定案）：`TabState(path/encoding/dirty/cursor)`，**不存文本内容**。
- **文本缓冲**（架构 §5.2）：每个标签一个独立 `ui/editor.Editor`（Tk Text），由 App 的 `_editors: dict[int, Editor]` 持有。切换标签 = 换挂载的 Editor（`current_editor()` 负责懒创建 + pack），**撤销/重做栈天然隔离**（undo=True, maxundo=100）。
- **标签条**（ui/tabs_bar.py）：自绘 Frame+Label（不用 Notebook，便于 design 定制）；活动标签强调色文字 + 底部 2px 色条，非活动淡灰；● 前缀来自 `TabState.title`；✕ / 中键关闭。
- **按需出现**（design §7）：单文件隐藏整条，≥2 文件显示。
- **关闭确认**：`App._confirm_close`（askyesnocancel：保存/不保存/取消）；关闭活动标签后激活相邻标签，全部关闭回欢迎页。

## 已知坑
1. **pack 顺序陷阱**：`pack_forget()` 后重新 `pack(side=TOP)` 会排到 expand 的 main 之后被挤到不可见。**解决**：`tabs_bar.pack(..., before=self.main)` 固定顺序（ui/main_window.py:refresh_tabs 有注释）。
2. 多 Editor 实例切换时，旧 Editor 必须 `pack_forget()`（`current_editor()` 里统一处理）。

## 验收
✅ 冒烟通过（3 标签切换、标签条显示、保存后 clean）；完整五步验收待统一测试。