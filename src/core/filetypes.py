# -*- coding: utf-8 -*-
"""文件类型判定（core）：决定一个文件用哪种方式打开（specs/10）。

四类（v1）：
- markdown：`.md/.markdown/.mdown` —— 沿用原渲染管线；
- text：能按 utf-8/utf-8-sig/gbk 解码的其它文件（txt/log/源码/配置/csv…）—— 纯文本；
- image：png/jpg/gif/webp/bmp/svg/ico —— 只读图片视图；
- pdf：`.pdf` —— 页面内 iframe + WebView2 内置查看器（只读）；
- ebook：`.epub/.mobi/.azw3/.azw/.rtf/.odt/.fb2` —— 抽取为 Markdown（章节标题 + 正文）后阅读（只读）；
- html：`.html/.htm/.xhtml` —— 页面内 iframe 渲染（只读）；
- binary：其余（可执行文件、压缩包等）—— 不渲染，只给信息卡 + 系统打开。

判定顺序：扩展名优先（图片/图片型 svg）；其余先嗅探内容（前 8KB 含 NUL 即二进制），
再尝试解码；解码失败按 binary 处理。**不在此模块读全文**，正文读取仍归 `core/fileio`。
"""

from __future__ import annotations

from pathlib import Path

MARKDOWN_EXTS = {".md", ".markdown", ".mdown"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"}
PDF_EXTS = {".pdf"}
EBOOK_EXTS = {".epub", ".mobi", ".azw3", ".azw", ".rtf", ".odt", ".fb2"}
HTML_EXTS = {".html", ".htm", ".xhtml"}
# 这些扩展名即使能解码也按纯文本处理（源码/配置/日志/数据）
TEXT_EXTS = {
    ".txt", ".log", ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
    ".csv", ".tsv", ".xml", ".html", ".htm", ".css", ".js", ".ts", ".jsx", ".tsx",
    ".py", ".pyw", ".ps1", ".bat", ".cmd", ".sh", ".c", ".h", ".cpp", ".hpp",
    ".cs", ".java", ".go", ".rs", ".rb", ".php", ".sql", ".lua", ".vue", ".svelte",
    ".tex", ".rst", ".org", ".diff", ".patch", ".gitignore", ".env",
}

_TEXT_SNIFF_BYTES = 8192


def _looks_binary(head: bytes) -> bool:
    """前 8KB 出现 NUL 或控制字符占比过高 → 二进制。"""
    if not head:
        return False
    if b"\x00" in head:
        return True
    ctrl = sum(1 for b in head if b < 0x09 or (0x0E <= b < 0x20))
    return ctrl > len(head) * 0.10


def detect(path: str | Path) -> str:
    """返回 kind ∈ {markdown, text, image, pdf, ebook, html, binary}。只读少量文件头。"""
    p = Path(path)
    ext = p.suffix.lower()
    if ext in IMAGE_EXTS:
        return "image"
    if ext in PDF_EXTS:
        return "pdf"          # WebView2 内置查看器（specs/10 R-10-07）
    if ext in EBOOK_EXTS:
        return "ebook"        # epub/mobi/azw3/rtf/odt/fb2，抽取为 Markdown 后阅读（R-10-08）
    if ext in HTML_EXTS:
        return "html"         # 页面内 iframe 直接渲染（R-10-07 同族）
    if ext in MARKDOWN_EXTS:
        return "markdown"
    try:
        with open(p, "rb") as f:
            head = f.read(_TEXT_SNIFF_BYTES)
    except OSError:
        return "binary"
    if _looks_binary(head):
        return "binary"
    # 头部可能在多字节字符中间被截断：先去掉尾巴几个字节再严格解码
    probe = head[:-4] if len(head) > 8 else head
    for enc in ("utf-8-sig", "utf-8", "gbk"):
        try:
            probe.decode(enc)
            return "text"
        except UnicodeDecodeError:
            continue
    # 仍然失败：允许极小比例的坏字节（截断/混排），坏字符占比 ≤5% 仍按文本
    for enc in ("utf-8", "gbk"):
        txt = head.decode(enc, "replace")
        if txt and txt.count("\ufffd") <= max(1, len(txt) * 0.05):
            return "text"
    return "binary"


def is_text_like(kind: str) -> bool:
    """可编辑、可保存、可朗读的类型。"""
    return kind in ("markdown", "text")
