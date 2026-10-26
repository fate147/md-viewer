# -*- coding: utf-8 -*-
"""开发日志写入：一条命令把本次任务记入当月日志 docs/log/YYYY-MM.md。

用法：
    python docs/append_log.py "一句话标题" --bg "背景/根因" --do "处理/结论" --ref "指针"

行为：
    - 自动定位当月文件，不存在则按内置模板创建
    - 条目插到标题区之下（最新在上），日期自动补
    - 同日同标题幂等：已存在则跳过
    - 日志只追加：本工具永不修改/删除既有条目
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import date
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parent / "log"

TEMPLATE = """# 📜 开发日志 {ym}

> 条目格式 `## YYYY-MM-DD · 标题`，最新在上；固定字段：背景 → 处理 → 验证 → 指针。
> 日志只追加不回改，写错追加勘误。

---

"""


def _out(text: str) -> None:
    try:
        print(text)
    except UnicodeEncodeError:
        sys.stdout.buffer.write((text + "\n").encode("utf-8", "replace"))


def _insert_entry(entry: str, body: str) -> str:
    """把条目插到首个 `---` 分隔线之后、既有条目之前。"""
    entry = entry.rstrip("\n")
    sep = re.search(r"^---\s*$", body, flags=re.M)
    if not sep:
        return body.rstrip("\n") + "\n\n" + entry + "\n"
    top, rest = body[: sep.end()].rstrip("\n"), body[sep.end() :].strip("\n")
    parts = [top, entry] + ([rest] if rest else [])
    return "\n\n".join(parts) + "\n"


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    parser = argparse.ArgumentParser(description="开发日志写入（当月文件，幂等）")
    parser.add_argument("title", help="一句话标题（同日同标题不重复写）")
    parser.add_argument("--bg", default="", help="背景/根因")
    parser.add_argument("--do", default="", help="处理/结论")
    parser.add_argument("--verify", default="", help="验证结果（可选）")
    parser.add_argument("--ref", default="", help="指针：相关文档/bug/commit")
    parser.add_argument("--date", default="", help="补录日期 YYYY-MM-DD（默认今天）")
    args = parser.parse_args()

    day = args.date or date.today().isoformat()
    ym = day[:7]
    heading = f"## {day} · {args.title.strip()}"

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    month_file = LOG_DIR / f"{ym}.md"
    if not month_file.exists():
        month_file.write_text(TEMPLATE.format(ym=ym), encoding="utf-8")
        _out(f"已创建 {month_file.name}")

    body = month_file.read_text(encoding="utf-8")
    if heading in body:
        _out(f"跳过：已有条目「{heading}」（幂等不重复写）")
        return 0

    fields = [
        f"- **{label}**：{value}"
        for label, value in (("背景", args.bg), ("处理", args.do), ("验证", args.verify), ("指针", args.ref))
        if value
    ]
    entry = "\n".join([heading, ""] + fields).rstrip() + "\n\n---"

    month_file.write_text(_insert_entry(entry, body), encoding="utf-8")
    _out(f"已写入 log/{ym}.md：{heading}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
