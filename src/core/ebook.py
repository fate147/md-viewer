# -*- coding: utf-8 -*-
"""电子书抽取（core）：epub / mobi / azw3 → 带章节标题的 Markdown 文本（specs/10 R-10-08）。

只依赖标准库，不引入第三方包：
- **epub**：`zipfile` 读 `META-INF/container.xml` → OPF → spine 顺序 → 各 XHTML 转文本；
- **mobi / azw3**：PalmDB 容器 + PalmDOC 头。compression=1（原始）/2（LZ77）抽取文本记录；
  compression=17480（HUFF/CDIC）与 DRM（encryption≠0）**明确报错**，不猜不硬解；
- 抽取结果统一成 Markdown（`# 书名` + `## 章节`），交给阅读层，目录/分块/分段全部复用。

v1 边界（写进规格，不假装支持）：
- 不提取内嵌图片、不还原原书 CSS 排版（只保证文字顺序与章节结构）；
- azw3 若只有 KF8 正文（无 MOBI6 兼容段）可能抽不出正文 → 报错让用户转 epub；
- 加密书（Kindle DRM / Adobe DRM）一律报错。
"""

from __future__ import annotations

import posixpath
import re
import zipfile
from html.parser import HTMLParser
from pathlib import Path

EBOOK_EXTS = {".epub", ".mobi", ".azw3", ".azw"}


class EbookError(Exception):
    """可预期的电子书解析失败（文案直接展示给用户）。"""


# ---------------------------------------------------------------- HTML → 文本

class _HTMLText(HTMLParser):
    """把 XHTML 转成纯文本：块级元素断行，h1–h4 记成章节标题。"""

    _BLOCK = {"p", "div", "br", "li", "tr", "section", "article", "blockquote",
              "h1", "h2", "h3", "h4", "h5", "h6", "table", "pre"}
    _SKIP = {"script", "style", "head"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.title: str | None = None
        self._skip = 0
        self._heading = 0
        self._buf: list[str] = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in self._SKIP:
            self._skip += 1
            return
        if tag in ("h1", "h2", "h3"):
            self._heading = int(tag[1])
            self._buf = []
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in self._SKIP:
            self._skip = max(0, self._skip - 1)
            return
        if tag in ("h1", "h2", "h3"):
            text = "".join(self._buf).strip()
            if text:
                if self.title is None:
                    self.title = text
                # 章节标题先放占位符，最后统一换成 Markdown ##（避免被正文 # 转义规则误伤）
                self.parts.append("\n\n\ue000" + re.sub(r"\s+", " ", text) + "\ue001\n\n")
            self._heading = 0
            self._buf = []
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if self._skip:
            return
        if self._heading:
            self._buf.append(data)
        else:
            self.parts.append(data)

    def text(self) -> str:
        raw = "".join(self.parts).replace("\r", "")
        lines = []
        for ln in raw.split("\n"):
            ln = re.sub(r"[ \t\u00a0]+", " ", ln).strip()
            # 正文里以 # 开头的行要转义，避免被当成标题
            if ln.startswith("#"):
                ln = "\\" + ln
            lines.append(ln)
        joined = "\n".join(lines)
        joined = joined.replace("\ue000", "\n\n## ").replace("\ue001", "\n")
        lines = joined.split("\n")
        out, blank = [], 0
        for ln in lines:
            if ln:
                blank = 0
                out.append(ln)
            elif blank == 0:
                out.append("")
                blank = 1
        return "\n".join(out).strip()


def _html_to_text(html: str) -> tuple[str, str | None]:
    p = _HTMLText()
    try:
        p.feed(html)
    except Exception:
        pass
    return p.text(), p.title


# ---------------------------------------------------------------- epub

def _opf_items(opf: str) -> tuple[dict, list[str], str]:
    """解析 OPF：返回 (id → href, spine 的 idref 顺序, 书名)。"""
    man: dict[str, str] = {}
    for tag in re.findall(r"<item\b[^>]*>", opf, re.I):
        i = re.search(r'\bid\s*=\s*"([^"]+)"', tag)
        h = re.search(r'\bhref\s*=\s*"([^"]+)"', tag)
        if i and h:
            man[i.group(1)] = h.group(1)
    spine = [m.group(1) for m in re.finditer(r'<itemref\b[^>]*\bidref\s*=\s*"([^"]+)"', opf, re.I)]
    mt = re.search(r"<dc:title[^>]*>(.*?)</dc:title>", opf, re.S | re.I)
    title = re.sub(r"<[^>]+>", "", mt.group(1)).strip() if mt else ""
    return man, spine, title


def extract_epub(path: str | Path) -> str:
    try:
        z = zipfile.ZipFile(path)
    except zipfile.BadZipFile as e:
        raise EbookError(f"不是有效的 EPUB（zip 打不开）：{e}") from e
    with z:
        try:
            container = z.read("META-INF/container.xml").decode("utf-8", "ignore")
        except KeyError as e:
            raise EbookError("EPUB 缺少 META-INF/container.xml") from e
        m = re.search(r'full-path\s*=\s*"([^"]+)"', container)
        if not m:
            raise EbookError("EPUB 的 container.xml 里没有 rootfile")
        opf_path = m.group(1)
        opf = z.read(opf_path).decode("utf-8", "ignore")
        man, spine, title = _opf_items(opf)
        base = posixpath.dirname(opf_path)
        if not spine:
            raise EbookError("EPUB 的 spine 为空，无法确定章节顺序")

        body: list[str] = []
        for idref in spine:
            href = man.get(idref)
            if not href:
                continue
            name = posixpath.normpath(posixpath.join(base, href.split("#")[0]))
            try:
                html = z.read(name).decode("utf-8", "ignore")
            except KeyError:
                continue
            text, heading = _html_to_text(html)
            if not text and not heading:
                continue
            body.append(text)
        if not body:
            raise EbookError("EPUB 里没有可读的正文（可能全是图片页）")
    head = "# " + (title or Path(path).stem) + "\n\n"
    return head + "\n\n".join(body)


# ---------------------------------------------------------------- mobi / azw3

def _palmdoc_decompress(data: bytes) -> bytes:
    out = bytearray()
    i, n = 0, len(data)
    while i < n:
        c = data[i]
        i += 1
        if c == 0 or 0x09 <= c <= 0x7F:
            out.append(c)
        elif 1 <= c <= 8:
            out.extend(data[i:i + c])
            i += c
        elif 0x80 <= c <= 0xBF:
            if i >= n:
                break
            c = (c << 8) | data[i]
            i += 1
            dist = (c >> 3) & 0x7FF
            length = (c & 0x07) + 3
            if 0 < dist <= len(out):
                for _ in range(length):
                    out.append(out[-dist])
        else:  # 0xC0..0xFF
            out.append(0x20)
            out.append(c ^ 0x80)
    return bytes(out)


def _looks_like_garbage(text: str) -> bool:
    if len(text) < 10:
        return True
    bad = sum(1 for ch in text[:4000] if ch == "\ufffd" or (ord(ch) < 32 and ch not in "\n\t"))
    return bad > len(text[:4000]) * 0.10


def extract_mobi(path: str | Path) -> str:
    data = Path(path).read_bytes()
    if len(data) < 100:
        raise EbookError("文件太小，不是有效的 MOBI")
    try:
        num_records = int.from_bytes(data[76:78], "big")
        if not 1 <= num_records <= 0xFFFF:
            raise ValueError
        offs = [int.from_bytes(data[78 + i * 8:82 + i * 8], "big") for i in range(num_records)]
    except Exception as e:
        raise EbookError("MOBI 头部解析失败（PalmDB 记录表异常）") from e
    if len(offs) < 2 or offs[0] < 0 or offs[-1] > len(data):
        raise EbookError("MOBI 记录偏移越界")
    offs.append(len(data))
    r0 = data[offs[0]:offs[1]]
    if len(r0) < 16:
        raise EbookError("MOBI 的 PalmDOC 头缺失")

    compression = int.from_bytes(r0[0:2], "big")
    text_len = int.from_bytes(r0[4:8], "big")
    text_recs = int.from_bytes(r0[8:10], "big")
    encryption = int.from_bytes(r0[12:14], "big")

    if encryption:
        raise EbookError("这本书有 DRM 加密，无法解析（请先用官方工具去 DRM）")
    if compression == 17480:
        raise EbookError("这本书用的是 HUFF/CDIC 压缩，暂不支持（请转换为 EPUB）")
    if compression not in (1, 2):
        raise EbookError(f"未知的 MOBI 压缩方式（{compression}），暂不支持")

    codec = "cp1252"
    if r0[16:20] == b"MOBI" and len(r0) >= 32:
        enc_code = int.from_bytes(r0[28:32], "big")
        codec = "utf-8" if enc_code == 65001 else "cp1252"

    chunks: list[bytes] = []
    for i in range(1, min(num_records, 1 + text_recs)):
        rec = data[offs[i]:offs[i + 1]]
        chunks.append(_palmdoc_decompress(rec) if compression == 2 else rec)
    raw = b"".join(chunks)
    if text_len and text_len <= len(raw):
        raw = raw[:text_len]
    html = raw.decode(codec, "ignore")

    text, heading = _html_to_text(html)
    if _looks_like_garbage(text):
        raise EbookError("AZW3/KF8 正文结构与 MOBI 不同，这本抽不出正文——请转换为 EPUB 后再打开")
    name = data[0:32].split(b"\x00")[0].decode("latin-1", "ignore").strip() or Path(path).stem
    return "# " + name + "\n\n" + text


# ---------------------------------------------------------------- 入口

# ---------------------------------------------------------------- rtf / odt / fb2

def _drop_rtf_group(s: str, name: str) -> str:
    """删掉「花括号 + 反斜杠 + name」开头的整组（含嵌套），用于字体表/颜色表等非正文。"""
    tag = "{" + chr(92) + name
    i = s.find(tag)
    while i != -1:
        depth, j = 0, i
        while j < len(s):
            c = s[j]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        s = s[:i] + " " + s[j + 1:]
        i = s.find(tag)
    return s


def extract_rtf(path: str | Path) -> str:
    """RTF → 文本（best effort）：处理 Unicode 转义、十六进制字节、段落与制表符。

    不还原格式（粗体/表格/样式），也不提图；目标是把文字按原顺序读出来。
    """
    raw = Path(path).read_bytes().decode("latin-1", "ignore")
    cp = "cp1252"
    m = re.search(r"\\ansicpg(\d+)", raw)
    if m:
        mapping = {"936": "gbk", "950": "big5", "65001": "utf-8",
                   "1252": "cp1252", "1251": "cp1251", "932": "cp932"}
        cp = mapping.get(m.group(1), "cp1252")
    # 丢掉字体表/颜色表/样式表（花括号配对，能吃嵌套）
    for name in ("fonttbl", "colortbl", "stylesheet", "info"):
        raw = _drop_rtf_group(raw, name)
    # 丢掉图片/对象组
    raw = re.sub(r"\{\\\*?\\(?:pict|object|shppict|nonshppict)\b.*?\}", " ", raw, flags=re.S)
    out = []
    i, n = 0, len(raw)
    while i < n:
        ch = raw[i]
        if ch == "\\":
            if i + 1 >= n:
                break
            nxt = raw[i + 1]
            if nxt in "\\{}":
                out.append(nxt)
                i += 2
                continue
            if nxt == "'":                      # 十六进制单字节，按代码页解
                hh = raw[i + 2:i + 4]
                try:
                    out.append(bytes([int(hh, 16)]).decode(cp, "ignore"))
                except ValueError:
                    pass
                i += 4
                continue
            if nxt == "u":                      # Unicode 码点转义
                m2 = re.match(r"\\u(-?\d+)", raw[i:])
                if m2:
                    code_pt = int(m2.group(1))
                    if code_pt < 0:
                        code_pt += 65536
                    out.append(chr(code_pt))
                    i += len(m2.group(0))
                    if i < n and raw[i] == "?":
                        i += 1
                    continue
            m3 = re.match(r"\\([a-zA-Z]+)(-?\d+)? ?", raw[i:])
            if m3:
                word = m3.group(1).lower()
                if word == "par":
                    out.append("\n\n")
                elif word == "line":
                    out.append("\n")
                elif word == "tab":
                    out.append("\t")
                i += len(m3.group(0))
                continue
            i += 2
        elif ch in "{}":
            i += 1
        else:
            out.append(ch)
            i += 1
    text = "".join(out).replace("\r", "")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return "# " + Path(path).stem + "\n\n" + text.strip()


def extract_odt(path: str | Path) -> str:
    """ODT（LibreOffice 文档）→ 文本：读 zip 里的 content.xml。"""
    try:
        z = zipfile.ZipFile(path)
    except zipfile.BadZipFile as e:
        raise EbookError(f"不是有效的 ODT：{e}") from e
    with z:
        try:
            xml = z.read("content.xml").decode("utf-8", "ignore")
        except KeyError as e:
            raise EbookError("ODT 缺少 content.xml") from e
    title_m = re.search(r"<dc:title>(.*?)</dc:title>", xml, re.S)
    title = re.sub(r"<[^>]+>", "", title_m.group(1)).strip() if title_m else ""
    # 标题当章节（交给阅读层建目录），段落断行
    xml = re.sub(r"<text:h\b[^>]*>(.*?)</text:h>",
                 lambda mm: "\n\n\ue000" + re.sub(r"<[^>]+>", "", mm.group(1)).strip() + "\ue001\n\n",
                 xml, flags=re.S)
    xml = re.sub(r"</text:p>", "\n\n", xml)
    xml = re.sub(r"<text:line-break/>|<text:tab/>", " ", xml)
    text, _ = _html_to_text(xml)
    if not text:
        raise EbookError("ODT 里没有可读正文")
    return "# " + (title or Path(path).stem) + "\n\n" + text


def extract_fb2(path: str | Path) -> str:
    """FB2（FictionBook）→ 文本：XML，章节是 <section><title>。"""
    raw = Path(path).read_bytes()
    xml = None
    for enc in ("utf-8", "cp1251", "gbk"):
        try:
            xml = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if xml is None:
        raise EbookError("FB2 编码无法识别")
    title_m = re.search(r"<book-title>(.*?)</book-title>", xml, re.S)
    title = re.sub(r"<[^>]+>", "", title_m.group(1)).strip() if title_m else ""
    mb = re.search(r"<body\b.*?</body>", xml, re.S)
    body = mb.group(0) if mb else xml          # 只转正文，避免书名/元数据重复
    body = re.sub(r"<section>\s*<title>\s*<p>(.*?)</p>\s*</title>",
                  lambda mm: "\n\n\ue000" + re.sub(r"<[^>]+>", "", mm.group(1)).strip() + "\ue001\n\n",
                  body, flags=re.S)
    body = re.sub(r"</p>", "\n\n", body)
    text, _ = _html_to_text(body)
    if not text:
        raise EbookError("FB2 里没有可读正文")
    return "# " + (title or Path(path).stem) + "\n\n" + text


def extract(path: str | Path) -> str:
    """按扩展名抽成 Markdown；失败抛 EbookError（文案可直接展示）。"""
    ext = Path(path).suffix.lower()
    if ext == ".epub":
        return extract_epub(path)
    if ext in (".mobi", ".azw3", ".azw"):
        return extract_mobi(path)
    if ext == ".rtf":
        return extract_rtf(path)
    if ext == ".odt":
        return extract_odt(path)
    if ext == ".fb2":
        return extract_fb2(path)
    raise EbookError(f"不支持的电子书格式：{ext}")
