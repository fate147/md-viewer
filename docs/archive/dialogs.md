# 对话框 (ui/dialogs.py)

> 文档状态：活文档（随代码原地更新） ｜ 最后更新：2026-09-14

查找/替换对话框。

## 功能

- 大小写/正则开关
- 命中高亮
- 全部替换（可撤销）

## 接口

```python
from ui import dialogs
dialogs.find_replace_dialog(parent, editor, theme, status_cb)
```