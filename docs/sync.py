# -*- coding: utf-8 -*-
"""文档自动同步脚本：扫描代码结构，更新文档，归档过时文档。

用法：
    python docs/sync.py          # 同步文档
    python docs/sync.py --check  # 仅检查不同步，不修改
    python docs/sync.py --git    # 同步 + git add（用于 hook）

自动归档：过时的文档移动到 docs/archive/YYYY-MM-DD/
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
DOCS = ROOT / "docs"
ARCHIVE = DOCS / "archive"

# MODULES.md 的生成时间行：视为易变字段，不计入"实质内容"比较
_MODULES_TIME_RE = re.compile(r"^生成时间: .*$", re.MULTILINE)

# 需要跟踪的模块 → 文档映射
# 2026-10-26 开源清理：docs/features/* 已移入 docs/archive/ 作为历史参考，
# 不再参与同步检查；architecture.md 是唯一仍在原地维护的活文档。
MODULE_DOCS = {
    "src/main.pyw": "docs/architecture.md",
    "src/actions.py": "docs/architecture.md",
    "src/core/session.py": "docs/architecture.md",
    "src/ui/main_window.py": "docs/architecture.md",
    "src/ui/web_client.py": "docs/architecture.md",
}

# 功能文档 → 功能状态（待归档；已清空，features/ 目录已移除）
FEATURE_STATUS = {}


def getmtime(path: Path) -> float:
    return path.stat().st_mtime if path.exists() else 0


def scan_modules() -> dict[str, dict]:
    """扫描 src 目录，返回模块信息。"""
    modules = {}
    for py in sorted(SRC.rglob("*.py")):
        rel = py.relative_to(ROOT)
        try:
            content = py.read_text(encoding="utf-8")
            # 提取模块 docstring
            docstring = ""
            m = re.match(r'(?:"""(.*?)"""|\'\'\'(.*?)\'\'\')', content, re.DOTALL)
            if m:
                docstring = (m.group(1) or m.group(2)).strip().split("\n")[0]
            modules[str(rel)] = {
                "path": py,
                "lines": len(content.splitlines()),
                "docstring": docstring,
                "mtime": getmtime(py),
            }
        except Exception:
            pass
    return modules


def check_sync(modules: dict) -> list[str]:
    """检查文档与代码是否同步，返回不同步的列表。"""
    issues = []
    for mod_path, doc_path in MODULE_DOCS.items():
        mod_file = ROOT / mod_path
        doc_file = ROOT / doc_path
        if not mod_file.exists():
            issues.append(f"模块已删除: {mod_path}")
            continue
        if not doc_file.exists():
            issues.append(f"文档缺失: {doc_path} (模块: {mod_path})")
            continue
        if getmtime(mod_file) > getmtime(doc_file):
            issues.append(f"文档过时: {doc_path} ← {mod_path}")
    return issues


def archive_outdated():
    """归档过时的文档。"""
    today = datetime.now().strftime("%Y-%m-%d")
    archived = []
    for doc_path, status in FEATURE_STATUS.items():
        full = ROOT / doc_path
        if status == "removed" and full.exists():
            dest = ARCHIVE / today / full.name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(full), str(dest))
            archived.append(doc_path)
    return archived


def _substantive(text: str) -> str:
    """剥掉生成时间行后的实质内容。

    时间戳每次运行都变，若把它算进差异，post-commit hook 会永远认为
    docs/ 有改动，从而在每次提交后追加一个只含时间戳的假 commit。
    """
    return _MODULES_TIME_RE.sub("", text)


def generate_module_index(modules: dict) -> bool:
    """生成模块索引文档。

    实质内容（模块数/行数表）与现有文件一致时**跳过写入**，保持文件
    连 mtime 都不变——否则每次 commit 都会产生一个只差时间戳的变更。

    Returns:
        实际写入返回 True；跳过写入返回 False。
    """
    lines = ["# 模块索引（自动生成）\n"]
    lines.append(f"生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
    lines.append(f"模块总数: {len(modules)}\n")
    lines.append(f"代码总行数: {sum(m['lines'] for m in modules.values())}\n\n")
    lines.append("| 模块 | 行数 | 说明 |")
    lines.append("|---|---|---|")
    for path, info in sorted(modules.items()):
        doc = info["docstring"] or "-"
        lines.append(f"| `{path}` | {info['lines']} | {doc} |")
    new = "\n".join(lines)

    target = DOCS / "MODULES.md"
    if target.exists() and _substantive(target.read_text(encoding="utf-8")) \
            == _substantive(new):
        return False
    target.write_text(new, encoding="utf-8")
    return True


def main():
    parser = argparse.ArgumentParser(description="文档自动同步")
    parser.add_argument("--check", action="store_true", help="仅检查不同步")
    parser.add_argument("--git", action="store_true", help="同步后 git add")
    args = parser.parse_args()

    modules = scan_modules()

    if args.check:
        issues = check_sync(modules)
        if issues:
            print("发现不同步:")
            for i in issues:
                print(f"  - {i}")
            return 1
        print("文档已同步")
        return 0

    # 归档过时文档
    archived = archive_outdated()
    if archived:
        print(f"归档: {archived}")

    # 生成模块索引（无实质变化则跳过写入，不产生假 diff）
    if generate_module_index(modules):
        print("已生成 docs/MODULES.md")
    else:
        print("docs/MODULES.md 无实质变化，跳过")

    # 检查不同步
    issues = check_sync(modules)
    if issues:
        print("\n需手动更新:")
        for i in issues:
            print(f"  - {i}")

    # Git add
    if args.git:
        import subprocess
        subprocess.run(["git", "add", "docs/"], cwd=str(ROOT))
        print("已 git add docs/")

    return 0


if __name__ == "__main__":
    exit(main())
