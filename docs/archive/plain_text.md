# 纯文本服务 (services/plain_text.py)

> 文档状态：活文档（随代码原地更新） ｜ 最后更新：2026-09-14

Markdown → 纯文本转换，复制时去掉标记符号。

## 转换规则

- 标题 `#` 去掉，保留文字
- 粗体 `**bold**` → `bold`
- 斜体 `*italic*` → `italic`
- 行内代码 `` `code` `` → `code`
- 链接 `[text](url)` → `text`
- 图片 `![alt](url)` → `alt`
- 代码块去掉围栏标记
- 引用 `>` 前缀去掉
- 分隔线去掉
- HTML 标签去掉

## 用法

```python
from services.plain_text import to_plain_text
plain = to_plain_text("# Hello **world**")
# 结果: "Hello world"
```