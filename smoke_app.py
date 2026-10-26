# -*- coding: utf-8 -*-
"""冒烟测试：启动 → 页面就绪 → 欢迎文档渲染 → 干净退出（SMOKE_PASS）。

跑法：py smoke_app.py（会短暂弹窗，自动退出）
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

spec = importlib.util.spec_from_file_location("mdv_main", ROOT / "src" / "main.pyw")
main_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(main_mod)

root = tk.Tk()
root.withdraw()
app = main_mod.App(root)
root.deiconify()

end = time.time() + 30
while not app._web_ready and time.time() < end:
    root.update()
    time.sleep(0.02)
ready = app._web_ready

got: dict = {}
tab = None
if ready:
    end = time.time() + 15
    while time.time() < end and not app.sess.tabs:
        root.update()
        time.sleep(0.05)
    tab = app.sess.active()
    if tab:
        app.web.request_text(id(tab), lambda t: got.__setitem__("t", t))
    end = time.time() + 10
    while time.time() < end and "t" not in got:
        root.update()
        time.sleep(0.05)

ok = (ready and tab is not None
      and isinstance(got.get("t"), str) and "MD Viewer" in got["t"])
print(f"ready={ready} tab={getattr(tab, 'name', None)} welcome={'MD Viewer' in got.get('t', '')}")
print("SMOKE_PASS" if ok else "SMOKE_FAIL")

app.root.destroy()
sys.exit(0 if ok else 1)
