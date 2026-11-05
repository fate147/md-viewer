#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SDD 提交闸门（commit-msg hook）。

规则（2026-11-05 用户拍板）：
- 功能/流程/契约变化：提交信息写 `Spec: 00,04`，并同时改对应 specs 与 changelog。
- 小 bug / 重构 / 性能：写 `Spec: none`，不强制改规格。
- `feat` 类型提交：必须列规格，写 `none` 或缺失一律拒绝。

用法：commit-msg hook 会把提交信息文件路径作为 argv[1] 传入。
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def fail(msg: str) -> int:
    print("", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    print("SDD GATE: COMMIT BLOCKED", file=sys.stderr)
    print(msg, file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    return 1


def staged_files() -> set[str]:
    try:
        out = subprocess.check_output(
            ["git", "-c", "core.quotepath=false", "-C", str(ROOT),
             "diff", "--cached", "--name-only", "--diff-filter=ACMR"],
            text=True, encoding="utf-8", errors="replace")
    except Exception:
        return set()
    return {line.strip().replace("\\", "/") for line in out.splitlines()
            if line.strip()}


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        return 0
    msg_path = Path(argv[1])
    try:
        text = msg_path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return 0

    lines = [ln.strip() for ln in text.splitlines()
             if ln.strip() and not ln.strip().startswith("#")]
    subject = lines[0] if lines else ""
    is_feat = bool(re.match(r"^feat(?:\([^)]*\))?!?\s*:", subject, re.I))

    m = re.search(r"(?im)^\s*Spec(?:-Impact)?\s*:\s*(.+?)\s*$", text)
    spec = m.group(1).strip() if m else None
    spec_none = (spec is None or spec.lower() in ("none", "no", "-"))

    if is_feat and spec_none:
        return fail("feat 提交必须声明规格落点，例如 `Spec: 00,04`；\n"
                    "小 bug/重构请用 fix/refactor 类型并写 `Spec: none`。")

    if spec_none:
        return 0

    ids = sorted(set(re.findall(r"\b0[0-7]\b", spec)))
    if not ids:
        return fail("`Spec:` 必须列出 00~07 规格编号，或写 `Spec: none`。")

    changed = staged_files()
    missing = []
    for sid in ids:
        prefix = f"specs/{sid}-"
        if not any(p.startswith(prefix) for p in changed):
            missing.append(f"specs/{sid}-*.md")
    if changed and "specs/changelog.md" not in changed:
        missing.append("specs/changelog.md")
    if missing:
        return fail("声明了规格但本次提交未包含：\n  - " + "\n  - ".join(missing))

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))