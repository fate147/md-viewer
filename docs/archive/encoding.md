# 模块：编码检测（F08）

> 文档状态：活文档（随代码原地更新） ｜ 最后更新：2026-09-14

## 功能
UTF-8 / GBK / BOM 自动识别；中文 GBK 文件打开不乱码；**保存保持原编码**（F08 验收要点，v2.0 目标，v1.0 只写 UTF-8）。

## 实现
- **核心**（core/fileio.py）：
  - `read(path) -> (text, encoding)`：先读前 3 字节判 BOM（`utf-8-sig`），否则按 `utf-8 → gbk` 尝试（utf-8 优先，GBK 宽泛易误判）。
  - `write(path, text, encoding)`：**原子写**（同目录临时文件 + `os.replace`），`newline=""` 保持 LF 不产生 CRLF；`utf-8-sig` 写入自动带 BOM（Python 语义）。
- **往返**：`TabState.encoding` 记录打开时的编码，保存/自动保存沿用（App._write_file）。

## 已知坑
1. **BOM 检测顺序**：先 `utf-8-sig` 解码会"成功"吸收无 BOM 文件（返回错误编码）。必须显式读头 3 字节判 `\xef\xbb\xbf`。
2. GBK 是宽泛编码：纯 ASCII 文件会被判为 utf-8（读取结果一致，无影响，与 v1.0 行为相同）。
3. 换行归一：CRLF 文件首次保存变 LF（读取走 universal newline），md 场景可接受。

## 验收
✅ 单测通过（UTF-8 / GBK / BOM 三态往返 + 原子写）；完整五步验收待统一测试。