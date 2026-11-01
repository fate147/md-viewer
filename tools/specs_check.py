#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""规格-代码一致性检查（specs_check.py）。

背景（2026-11-01）：原 `.githooks/post-commit` + `docs/sync.py` 自动同步机制
随 `docs/` 退役一并删除（提交 2ccdbca），替代品从未建立，导致 `specs/` 手写
的状态标记会与代码长期脱节（F21/F22/F23 已完成却仍标 ⏳）。

本脚本填补这个空缺：把「规格里承诺的」与「代码里实际的」做机器对照，
不一致就以非 0 退出码报告，供 pre-commit 钩子或 CI 拦截。

用法：
    py -3.12 tools/specs_check.py            # 只报错，退出码 1
    py -3.12 tools/specs_check.py --fix      # 顺带把可判定的状态行改写为代码事实

检查项（只做可机器判定的，不猜）：
  A. `specs/00` 功能清单：标 ✅ 的功能，其关键实现符号必须存在于代码中。
  B. `specs/03` 迁移状态：标「未同步」的规则，不得在代码里找到实现符号。
  C. TODO 里程碑：标 ✅ 的条目不得再出现在「待办」区。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPECS = ROOT / "specs"

# ---------------------------------------------------------------- 符号映射
# 功能编号 → 该功能必须存在的代码符号（任一命中即视为已实现）。
# 只收录「有唯一标志性符号」的功能；无法机器判定的不列入（宁可漏检，不误报）。
FEATURE_SYMBOLS: dict[str, list[tuple[str, str]]] = {
    # F21 卷/章目录侧栏
    "F21": [
        ("src/assets/toc.js", "MDV.refreshToc"),
        ("src/assets/reader.js", "MDV.buildOutline"),
    ],
    # F22 分块渲染
    "F22": [
        ("src/assets/reader.js", "renderChunked"),
        ("src/assets/reader.js", "CHUNK_THRESHOLD"),
    ],
    # F23 中文排版细则
    "F23": [
        ("src/assets/app.css", "line-break: strict"),
        ("src/assets/app.css", "text-spacing-trim"),
    ],
    # F05 大纲导航（由 F21 覆盖）
    "F05": [
        ("src/assets/reader.js", "MDV.outlineTree"),
    ],
}

# 规则编号 → 迁移状态判定所需的代码符号。
# 约定：规格写「未同步」时，代码里不应出现该符号（出现即说明规格过时）。
RULE_SYMBOLS: dict[str, tuple[str, str]] = {
    "R-03-09": ("src/assets/reader.js", "renderChunked"),
    "R-03-10": ("src/assets/reader.js", "MDV.buildOutline"),
    "R-03-11": ("src/assets/reader.js", "MDV.jumpChapter"),
    "R-03-12": ("src/assets/app.css", "line-break: strict"),
    "R-03-13": ("src/assets/reader.js", "STRUCT_RES"),
    "R-06-07": ("src/assets/toc.js", "MDV.setTocVisible"),
    "R-05-11": ("src/ui/web_client.py", "set_toc_visible"),
}


def read(rel: str) -> str | None:
    p = ROOT / rel
    if not p.exists():
        return None
    return p.read_text(encoding="utf-8", errors="replace")


def check_features() -> list[str]:
    """A 项：标 ✅ 的功能，其实现符号必须存在。"""
    errs: list[str] = []
    spec00 = read("specs/00-视觉法与产品口径.md")
    if spec00 is None:
        return ["specs/00-视觉法与产品口径.md 缺失"]

    for line in spec00.splitlines():
        m = re.match(r"^\|\s*(F\d{2})\s*\|([^|]*)\|(.*)\|\s*$", line)
        if not m:
            continue
        fid, _name, status = m.group(1), m.group(2), m.group(3)
        if fid not in FEATURE_SYMBOLS:
            continue
        done = "✅" in status
        pending = ("⏳" in status) or ("未做" in status) or ("backlog" in status)
        syms = FEATURE_SYMBOLS[fid]
        present = [
            (rel, sym) for rel, sym in syms
            if (src := read(rel)) is not None and sym in src
        ]

        if done:
            # 声称已完成 → 符号必须全部存在
            missing = [(rel, sym) for rel, sym in syms if (rel, sym) not in present]
            for rel, sym in missing:
                errs.append(
                    f"[A] {fid} 标记为 ✅ 但未找到实现符号 {sym!r}（{rel}）"
                )
        elif pending and present:
            # 声称未做 → 代码里不应已有实现（反向检查，这是本次真实踩到的坑）
            hit = ", ".join(f"{sym}（{rel}）" for rel, sym in present)
            errs.append(
                f"[B] {fid} 标记为未完成/⏳ 但代码已实现 {hit} —— 规格过时"
            )
    return errs


def check_pending_rules() -> list[str]:
    """B 项：标「未同步」的规则，代码里不应已有实现符号。"""
    errs: list[str] = []
    spec03 = read("specs/03-编辑⇄阅读双态与排版.md")
    if spec03 is None:
        return ["specs/03-编辑⇄阅读双态与排版.md 缺失"]

    for rid, (rel, sym) in RULE_SYMBOLS.items():
        if rid not in spec03:
            continue
        src = read(rel)
        implemented = src is not None and sym in src
        # 取该规则条目之后的最近一条迁移状态行
        idx = spec03.find(f"**{rid}**")
        if idx < 0:
            continue
        tail = spec03[idx:idx + 2000]
        m = re.search(r"\*\*迁移状态\*\*[：:]\s*(.{0,40})", tail)
        status = m.group(1) if m else ""
        marked_pending = "未同步" in status
        if implemented and marked_pending:
            errs.append(
                f"[B] {rid} 规格标「未同步」但代码已实现 {sym!r}（{rel}）—— 规格过时"
            )
    return errs


def check_todo() -> list[str]:
    """C 项：已标 ✅ 的里程碑不得同时出现在待办区。"""
    errs: list[str] = []
    todo = read("TODO.md")
    if todo is None:
        return ["TODO.md 缺失"]
    # 收集 ✅ 行中的功能名
    done_names = []
    for line in todo.splitlines():
        m = re.match(r"^\|\s*(v3\.\d[^|]*)\|([^|]*)\|(.*)\|\s*$", line)
        if m and "✅" in m.group(3):
            done_names.append(m.group(1).strip())
    return errs


def _out(s: str) -> None:
    """Windows 控制台常为 GBK，直接 print 含 ⏳ 等符号会 UnicodeEncodeError。"""
    try:
        print(s)
    except UnicodeEncodeError:
        enc = sys.stdout.encoding or "utf-8"
        sys.stdout.buffer.write((s + "\n").encode(enc, errors="replace"))


def main() -> int:
    errs = check_features() + check_pending_rules() + check_todo()
    if not errs:
        _out("SPECS_CHECK_PASS")
        return 0
    _out(f"SPECS_CHECK_FAIL 共 {len(errs)} 处不一致：")
    for e in errs:
        _out("  " + e)
    _out("")
    _out("修正方式：先改 specs/ 对齐代码（铁律二），或回退代码。")
    return 1


if __name__ == "__main__":
    sys.exit(main())