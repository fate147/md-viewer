# -*- coding: utf-8 -*-
"""文件读写模块（core）：编码检测读写 + 原子写（F08）。

- 读取：utf-8-sig → utf-8 → gbk 依次尝试（延续 v1.0 read_file_safe），返回实际编码。
- 写入：原子写（同目录临时文件 + os.replace），并保持原编码往返（F08 验收要点）。
- 换行：读取走 universal newline（\\r\\n → \\n），写入 newline="" 保持 LF，不额外产生 CRLF。
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

ENCODINGS = ("utf-8-sig", "utf-8", "gbk")


def read(path: str | Path) -> tuple[str, str]:
    """读取文本文件，返回 (text, encoding)。编码均失败时抛 ValueError。"""
    path = Path(path)
    with open(path, "rb") as f:
        head = f.read(3)
    if head == b"\xef\xbb\xbf":
        with open(path, "r", encoding="utf-8-sig") as f:
            return f.read(), "utf-8-sig"
    for enc in ("utf-8", "gbk"):
        try:
            with open(path, "r", encoding=enc) as f:
                return f.read(), enc
        except (UnicodeDecodeError, UnicodeError):
            continue
        except Exception as e:  # 文件不存在 / 权限等真实错误，直接上抛
            raise e
    raise ValueError(f"无法以已知编码读取文件: {path}")


def write(path: str | Path, text: str, encoding: str = "utf-8") -> None:
    """原子写入文本文件。encoding 传 utf-8-sig 时自动带 BOM（Python 语义）。"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".mdv-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding=encoding, newline="") as f:
            f.write(text)
        os.replace(tmp, str(path))
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
