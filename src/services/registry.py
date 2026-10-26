# -*- coding: utf-8 -*-
"""默认程序注册服务（services）：包装 v1.0 mdviewer_reg（保留资产，勿重写）。

mdviewer_reg.py 实现 Windows UserChoice 哈希算法，静默无弹窗注册 .md 关联。
本模块负责把它接入 2.0 分层（源码运行时注入项目根到 sys.path，打包时由
spec pathex 兜底），UI 层只调用 ensure_default()。
"""

from __future__ import annotations

import sys
from pathlib import Path

from core.config import app_base_dir

_ROOT = app_base_dir()
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import mdviewer_reg  # noqa: E402  保留资产，仅转发


def ensure_default(exe_path: str | Path) -> bool:
    """确保 .md 默认关联到指定 exe（幂等，可在每次启动时调用）。

    Args:
        exe_path: md-viewer.exe 绝对路径。

    Returns:
        True = 已就位或注册成功；False = 注册失败（无 SID 等）。
    """
    return bool(mdviewer_reg.ensure_default(str(exe_path)))
