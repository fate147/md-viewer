# -*- coding: utf-8 -*-
"""配置模块（core）：读写 .md-viewer-config.json，字段校验 + 默认值合并。

- 配置格式延续 v1.0（.md-viewer-config.json），只扩展字段，不做迁移。
- 写入采用原子写（临时文件 + os.replace），避免崩溃损坏配置。
- 本模块零 UI 依赖（硬约束 1）。
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
from pathlib import Path

# ---------------------------------------------------------------- 路径

def app_base_dir() -> Path:
    """应用基目录：frozen 时为 exe 所在目录；源码时为项目根（src/core/config.py → 上两级）。"""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent.parent


CONFIG_PATH = app_base_dir() / ".md-viewer-config.json"

# ---------------------------------------------------------------- 默认值（架构 §5.1）

DEFAULTS: dict = {
    "theme": "paper",
    "window": {"width": 1280, "height": 800, "x": None, "y": None, "maximized": False},
    "layout": {
        "reading_mode": "auto",   # 排版模式: auto|book|doc（2026-10-11）
        "toc_visible": True,      # 目录显示（specs/06 R-06-07，2026-11-01）
        "toc_mode": "auto",       # auto|always|never：auto=书卷显示/文档隐藏
    },
    "font": {"size": 17, "family": "Georgia"},
    "auto_save": True,
    "recent_files": [],
    "session": {"open_tabs": [], "active_tab": 0},
}

_lock = threading.Lock()


# ---------------------------------------------------------------- 工具

def _deep_merge(base: dict, extra: dict) -> dict:
    """递归合并：extra 覆盖 base，缺失键取 base 默认值。"""
    out = dict(base)
    for k, v in extra.items():
        if k in base and isinstance(base[k], dict) and isinstance(v, dict):
            out[k] = _deep_merge(base[k], v)
        else:
            out[k] = v
    return out


def _atomic_write_json(path: Path, data: dict) -> None:
    """原子写 JSON：临时文件 + os.replace。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".mdv-cfg-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, str(path))
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------- 公开接口

def load() -> dict:
    """读取配置，与默认值合并后返回。文件缺失/损坏时返回默认值（不抛异常）。"""
    with _lock:
        try:
            if CONFIG_PATH.exists():
                with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                if isinstance(raw, dict):
                    return _deep_merge(DEFAULTS, raw)
        except (OSError, ValueError):
            pass
        return _deep_merge(DEFAULTS, {})


def save(data: dict) -> None:
    """保存配置：保留式合并（现有文件 ← data ← DEFAULTS）后原子写入。

    读现有文件失败（不存在/解析失败）时降级为 existing={} 继续写，
    禁止因读失败而中止保存或丢数据。
    """
    with _lock:
        existing: dict = {}
        try:
            if CONFIG_PATH.exists():
                with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                if isinstance(raw, dict):
                    existing = raw
        except (OSError, ValueError):
            existing = {}
        merged = _deep_merge(DEFAULTS, _deep_merge(existing, data))
        try:
            _atomic_write_json(CONFIG_PATH, merged)
        except OSError:
            # 配置写失败不致命，静默跳过（v1.0 行为延续）
            pass
