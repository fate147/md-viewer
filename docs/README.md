# MD Viewer 文档导读

> **类型**：入口（docs 目录导读）｜**权威**：行为规则以 `specs/` 为准，本文只指引查阅路径
> **最后核对**：2026-10-26（开源清理后）

> 新会话从根目录 `AGENTS.md` 进门。`docs/` 是**历史参考**，不作行为依据。

## 权威层级

```
AGENTS.md（根）    ← 唯一入口：三条铁律 + 分发与诊断纪律 + 常用命令
    │
specs/             ← 代码必须满足的契约（01 启动 / 02 标签 / 03 双态 /
    │                04 主题 / 05 桥 / 06 配置 / 07 导出 + changelog）
    │
docs/              ← 历史参考（可能过时，与 specs 冲突时一律以 specs 为准）
```

## 查什么 → 去哪

| 我想知道… | 去哪 | 性质 |
|---|---|---|
| 现在必须遵守什么规则 | `specs/01~07` + `specs/changelog.md` | **契约** |
| 产品要做成什么样 | [requirements.md](requirements.md) | 真源 |
| 界面怎么排版、四主题怎么定 | [DESIGN.md](DESIGN.md) | 真源 |
| 架构怎么分层、桥怎么走 | [architecture.md](architecture.md) | 活文档 |
| **现在做到哪、下一步做什么** | [plans/implementation-plan.md](plans/implementation-plan.md) | 台账（唯一） |
| 为什么选这个技术、否决了什么 | [decisions/tech-choices.md](decisions/tech-choices.md) | 历史（追加式，含勘误） |
| 最近改了什么 | [log/](log/) | 历史 |
| 旧架构长什么样 | [archive/](archive/) | 归档 |

## 目录

```
docs/
├── README.md               本文
├── architecture.md         架构设计（随代码维护的活文档）
├── DESIGN.md               视觉法：纸间微光 + 双排版模式
├── requirements.md         产品口径
├── plans/                  implementation-plan.md（进度台账 + 暂缓项）
├── decisions/              tech-choices.md（技术决策，追加式）
├── log/                    YYYY-MM.md 改动留痕（append_log.py 写入）
├── archive/                归档：v2 时代文档 + 已停止维护的模块文档
├── append_log.py           日志写入工具
└── sync.py                 文档同步工具（git post-commit 调用）
```

## 关于 `docs/archive/`

归档不等于废弃——被取代的文档移入此处并注明取代者，保留决策脉络：

- `design-v2-tkinter.md`、`PRODUCT.md`、`preview.md`、`editor.md`、`tabs.md`、
  `search.md`、`dialogs.md`、`audit-20260814.md` —— **v2 Tkinter 时代**
- `packaging.md`、`web-client.md`、`config.md`、`theme.md`、`export.md`、
  `plain_text.md`、`encoding.md` —— **v3 曾用的模块文档**，其规则已并入 `specs/`
  （其中 `packaging.md` 的踩坑结论保留在 `specs/01` R-01-05）

## 维护纪律

1. **状态只写台账**：任何"做到哪 / 下一步"只更新 `plans/implementation-plan.md`，`AGENTS.md` 不含状态。
2. **历史只增不改**：`log/`、`decisions/`、`archive/` 落笔后不回改；决策被推翻时追加勘误条目。
3. **规则变更走 specs**：行为规则只在 `specs/` 维护，并在 `specs/changelog.md` 留痕。
4. **废弃标废**：被取代的文档移入 `archive/` 并注明取代者，不静默删除。

> `docs/MODULES.md` 由 `sync.py` 本地生成，**不入库**（已列入 `.gitignore`）。
