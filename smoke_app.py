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

# 配置隔离（2026-11-02 修）：冒烟必须从「无会话」启动才能验证欢迎页。
# 修前未隔离，读到真实 .md-viewer-config.json 的 session.open_tabs 会恢复上次
# 打开的文件（实测打开《鬼探实录.md》），欢迎页断言必然 SMOKE_FAIL——这是脚本
# 缺陷而非产品缺陷。指向专用临时配置并先清空，保证默认空会话 → 欢迎页。
from core import config as config_mod  # noqa: E402
SMOKE_CFG = ROOT / ".mdv-smoke-config.json"
SMOKE_CFG.unlink(missing_ok=True)
config_mod.CONFIG_PATH = SMOKE_CFG

from core.session import tab_key  # noqa: E402  02 R-02-01：禁止 id(tab)

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
        app.web.request_text(tab_key(tab), lambda t: got.__setitem__("t", t))
    end = time.time() + 10
    while time.time() < end and "t" not in got:
        root.update()
        time.sleep(0.05)

ok = (ready and tab is not None
      and isinstance(got.get("t"), str) and "MD Viewer" in got["t"])
print(f"ready={ready} tab={getattr(tab, 'name', None)} welcome={'MD Viewer' in got.get('t', '')}")
print("SMOKE_PASS" if ok else "SMOKE_FAIL")

app.root.destroy()
SMOKE_CFG.unlink(missing_ok=True)
sys.exit(0 if ok else 1)
