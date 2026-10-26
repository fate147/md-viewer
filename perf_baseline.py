# -*- coding: utf-8 -*-
"""鬼探实录.md（2.3MB）性能基线：在副本上测，不碰原文件。

指标：打开(推送+提交+首渲) / F2 首次渲染(有改动) / F2 无改动切换 / 保存拉文往返。
跑法：py perf_baseline.py
"""
import importlib.util
import shutil
import sys
import tempfile
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

# 配置隔离：基线脚本的打开动作会写 recent_files，指向临时文件避免污染真实配置
from core import config as config_mod  # noqa: E402
config_mod.CONFIG_PATH = ROOT / ".mdv-test-config.json"

spec = importlib.util.spec_from_file_location("mdv_main", ROOT / "src" / "main.pyw")
main_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(main_mod)

from actions import open_file  # noqa: E402

SRC = ROOT / "鬼探实录.md"          # 版权样本不入库；缺失时下面给出明确提示
TMP = Path(tempfile.gettempdir()) / "mdv-perf-novel.md"
if not SRC.exists():
    sys.exit(f"缺少性能样本：{SRC}\n请把一个 2MB 级 .md 放到该路径后重跑（样本不入库）。")
shutil.copyfile(SRC, TMP)

root = tk.Tk()
root.withdraw()
app = main_mod.App(root)
root.deiconify()

end = time.time() + 30
while not app._web_ready and time.time() < end:
    root.update()
    time.sleep(0.02)
app.config["auto_save"] = False          # 基线测试绝不落盘

expected = len(TMP.read_text(encoding="utf-8-sig"))   # 文件带 BOM，按应用同款规则剥掉

# ---- 打开：open_file 调用 → drain 统计出现正确字数（含分块推送+提交+首渲）----
t0 = time.perf_counter()
open_file(app, str(TMP))
opened = None
stats = None
end = time.time() + 60
while time.time() < end:
    root.update()
    time.sleep(0.02)
    s = getattr(app, "_last_stats", None)
    if s and s.get("chars") == expected:
        opened = time.perf_counter() - t0
        stats = s
        break
print(f"OPEN_MS={int(opened*1000) if opened else -1}")
print(f"STATS={stats}")

# ---- F2 首渲（制造改动后 editor→reader，同步计时含 marked 渲染）----
app.web.run_cmd("toggleMode")            # → editor
time.sleep(0.3)
root.update()
app.web.insert_text("x")                 # 弄脏文档（副本）
box = {}
app.web._eval(
    "(function(){var t0=performance.now();window.__app.toggleMode();"
    "return Math.round(performance.now()-t0)})()", lambda r: box.__setitem__("r", r))
end = time.time() + 10
while time.time() < end and "r" not in box:
    root.update()
    time.sleep(0.02)
print(f"F2_RENDER_DIRTY_MS={box.get('r')}")

# ---- F2 无改动切回（reader→editor，含滚动锚点映射）----
box2 = {}
app.web._eval(
    "(function(){var t0=performance.now();window.__app.toggleMode();"
    "return Math.round(performance.now()-t0)})()", lambda r: box2.__setitem__("r", r))
end = time.time() + 10
while time.time() < end and "r" not in box2:
    root.update()
    time.sleep(0.02)
print(f"F2_TOGGLE_BACK_MS={box2.get('r')}")

# ---- 保存拉文往返（2.3MB 分块）----
got = {}
t0 = time.perf_counter()
app.web.request_text(id(app.sess.active()), lambda t: got.__setitem__("t", t))
end = time.time() + 30
while time.time() < end and "t" not in got:
    root.update()
    time.sleep(0.02)
print(f"PULL_TEXT_MS={int((time.perf_counter()-t0)*1000)} len={len(got.get('t') or '')}")

app.root.destroy()
TMP.unlink(missing_ok=True)
print("SRC_UNTOUCHED=", SRC.read_text(encoding="utf-8")[:10])
