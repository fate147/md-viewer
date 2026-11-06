# -*- coding: utf-8 -*-
"""冒烟测试：启动 → 页面就绪 → 开始页（零文档状态）→ 干净退出（SMOKE_PASS）。

跑法：py smoke_app.py（会短暂弹窗，自动退出）。
2026-11-06：欢迎文档（ui/welcome.py）已删除，零文档启动进入开始页，不创建标签；
本脚本现断言「页面就绪且无标签」，即开始页状态。
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

# 配置隔离（2026-11-02 修）：冒烟必须从「无会话」启动才能验证开始页。
# 修前未隔离，读到真实 .md-viewer-config.json 的 session.open_tabs 会恢复上次
# 打开的文件（实测打开《鬼探实录.md》），开始页断言必然 SMOKE_FAIL——这是脚本
# 缺陷而非产品缺陷。指向专用临时配置并先清空，保证默认空会话 → 开始页。
from core import config as config_mod  # noqa: E402
SCRATCH = ROOT / "tmp"
SCRATCH.mkdir(parents=True, exist_ok=True)
SMOKE_CFG = SCRATCH / ".mdv-smoke-config.json"
SMOKE_CFG.unlink(missing_ok=True)
config_mod.CONFIG_PATH = SMOKE_CFG

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
ok = ready and not app.sess.tabs
print(f"ready={ready} tabs={len(app.sess.tabs)} (expect 0 → 开始页)")
print("SMOKE_PASS" if ok else "SMOKE_FAIL")

app.root.destroy()
SMOKE_CFG.unlink(missing_ok=True)
sys.exit(0 if ok else 1)
