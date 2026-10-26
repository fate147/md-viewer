---
name: Bug 报告
about: 报告一个可复现的问题（必须附 md-viewer-error.log）
title: '[Bug] '
labels: bug
assignees: ''
---

## ⚠️ 提交前必读

**请把 `md-viewer-error.log` 的内容粘贴到下面的「诊断日志」区块，或直接把文件拖进来。
没有日志的 issue 会被直接关闭。**

日志位置：

| 你的运行方式 | 日志路径 |
|---|---|
| 安装版 | `%LOCALAPPDATA%\Programs\MDViewer\md-viewer-error.log` |
| 便携版 | 与 `md-viewer.exe` 同级目录 |
| 源码运行 | 与 `src\main.pyw` 同级（即仓库根） |

文件不存在 = 程序没走到报错路径。请按下面的「复现步骤」再触发一次，然后回来贴。

## 环境

- MD Viewer 版本：
- Windows 版本（`winver`）：
- 运行方式：安装版 / 便携版 / `python src/main.pyw`
- 安装路径：
- 是否位于 Documents、OneDrive 等同步目录：**是 / 否**
  （是的话请先看 README「已知限制」，这本身就是已知失败场景）

## 复现步骤

1.
2.
3.

## 期望行为

## 实际行为

## 诊断日志

```text
（粘贴 md-viewer-error.log 的全部内容）
```

## 补充

截图 / 录屏 / 相关文件（可选）
