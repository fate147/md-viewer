# -*- coding: utf-8 -*-
"""视觉检查辅助：以隔离配置打开指定文档并保持窗口，供截图验收。

跑法：py visual_check.py <文档路径>   （窗口由截图脚本/人工关闭）
"""
import importlib.util
import sys
import time
from pathlib import Path

import ctypes
try:
    ctypes.oledll.ole32.CoInitializeEx(None, 0x2)
except Exception:
    pass

import tkinter as tk

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from core import config as config_mod  # noqa: E402
config_mod.CONFIG_PATH = ROOT / ".mdv-test-config.json"   # 不污染真实配置

spec = importlib.util.spec_from_file_location("mdv_main", ROOT / "src" / "main.pyw")
main_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(main_mod)

from actions import open_file  # noqa: E402

if len(sys.argv) < 2 or not Path(sys.argv[1]).is_file():
    print("usage: py visual_check.py <文档路径>")
    sys.exit(1)

root = tk.Tk()
root.withdraw()
app = main_mod.App(root)
root.deiconify()

end = time.time() + 30
while not app._web_ready and time.time() < end:
    root.update()
    time.sleep(0.02)
open_file(app, sys.argv[1])
app.run()
