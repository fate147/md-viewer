# -*- coding: utf-8 -*-
"""纯文本服务（services）：Markdown → 纯文本转换（复制时去掉标记符号）。

转换规则：
- 标题标记 # 去掉，保留标题文字
- 粗体 **bold** → bold，斜体 *italic* → italic
- 行内代码 `code` → code
- 链接 [text](url) → text
- 图片 ![alt](url) → alt
- 代码块去掉围栏标记，保留代码内容
- 引用 > 去掉前缀
- 分隔线 --- *** 去掉
- 表格分隔行 |---| 去掉
"""

from __future__ import annotations

import re

# 正则：匹配各类 Markdown 标记
_HEADING = re.compile(r"^#{1,6}\s+", re.MULTILINE)
_BOLD = re.compile(r"\*\*(.+?)\*\*")
_ITALIC = re.compile(r"(?<!\*)\*([^*\n]+?)\*(?!\*)")
_INLINE_CODE = re.compile(r"`(.+?)`")
_LINK = re.compile(r"\[(.+?)\]\((.+?)\)")
_IMAGE = re.compile(r"!\[(.*?)\]\((.+?)\)")
_BLOCKQUOTE = re.compile(r"^>\s?", re.MULTILINE)
_FENCED_CODE = re.compile(r"^```[^\n]*\n(.*?)^```", re.MULTILINE | re.DOTALL)
_HR = re.compile(r"^\s*(---+|\*\*\*+|___+)\s*$", re.MULTILINE)
_TABLE_SEP = re.compile(r"^\|?[\s\-:|]+\|?\s*$", re.MULTILINE)
_HTML_TAG = re.compile(r"<[^>]+>")


def to_plain_text(md_text: str) -> str:
    """将 Markdown 文本转换为纯文本（去掉所有标记符号）。"""
    if not md_text:
        return ""

    text = md_text

    # 代码块：去掉围栏标记，保留内容
    text = _FENCED_CODE.sub(lambda m: m.group(1).strip(), text)

    # 标题标记
    text = _HEADING.sub("", text)

    # 粗体/斜体
    text = _BOLD.sub(r"\1", text)
    text = _ITALIC.sub(r"\1", text)

    # 行内代码
    text = _INLINE_CODE.sub(r"\1", text)

    # 图片 → alt 文字
    text = _IMAGE.sub(r"\1", text)

    # 链接 → 文字
    text = _LINK.sub(r"\1", text)

    # 引用前缀
    text = _BLOCKQUOTE.sub("", text)

    # 分隔线
    text = _HR.sub("", text)

    # 表格分隔行
    text = _TABLE_SEP.sub("", text)

    # HTML 标签
    text = _HTML_TAG.sub("", text)

    # 清理多余空行（连续 3+ 空行 → 2 空行）
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()
