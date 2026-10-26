# 配置模块 (core/config.py)

> 文档状态：活文档（随代码原地更新） ｜ 最后更新：2026-10-11

读写 `.md-viewer-config.json`，字段校验 + 默认值合并。

## 功能

- 配置读取与默认值合并（`_deep_merge`：旧配置缺的新键自动补默认值）
- 原子写入（临时文件 + os.replace）
- 线程安全（threading.Lock）

## 配置结构

```json
{
  "theme": "paper",
  "window": {"width": 1280, "height": 800, "x": null, "y": null},
  "layout": {"reading_mode": "auto"},
  "font": {"size": 17, "family": "Georgia"},
  "auto_save": true,
  "recent_files": [],
  "session": {"open_tabs": [], "active_tab": 0}
}
```

### reading_mode（2026-10-11 新增）

`layout.reading_mode`: `auto`（默认）| `book` | `doc`。阅读层双排版模式：
`auto` 按内容判别（代码围栏数 + 表格数 ≥ 2 → 文档模式），`book` 强制书卷
（衬线/缩进/两端对齐），`doc` 强制文档（无衬线/左对齐）。菜单「视图 →
排版模式」切换并持久化；下发链路 `App.set_reading_mode` → `web.set_reading_mode`。

⚠️ 进程内测试（test_bridge_integration.py / perf_baseline.py / visual_check.py）
已把 `config_mod.CONFIG_PATH` 指到 `.mdv-test-config.json`，不会污染真实配置。
