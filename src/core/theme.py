# -*- coding: utf-8 -*-
"""主题模块（core）：4 套主题定义 + CSS 变量下发 + 预览 CSS 生成。

css_vars() 是前端（assets/app.css）颜色变量的唯一数据源：ui 层把它经桥
推给页面 setTheme()，编辑层与阅读层同吃一套变量，主题切换瞬时生效。
pygments_style() 供 services.export 的 HTML 导出使用。
"""

from __future__ import annotations

PYG_STYLE = {'paper': 'default', 'midnight': 'monokai', 'forest': 'friendly', 'pure': 'xcode'}

# 每套主题的语义色板（css_vars 与 preview 规则共用；2026-10-11 提取）
_PREVIEW_COLORS = {
    'paper': {
        'fg': '#2c2c2c', 'bg': '#fdfbf7', 'heading': '#1a1a1a',
        'accent': '#d4a373', 'muted': '#888888',
        'code_bg': '#f0ece4', 'code_fg': '#8b7355',
        'pre_bg': '#f5f1eb', 'border': '#e0dcd4',
        'quote_bg': '#f8f4ee', 'th_bg': '#f0ece4',
    },
    'midnight': {
        'fg': '#d4d4d4', 'bg': '#1e1e1e', 'heading': '#e0e0e0',
        'accent': '#4ec9b0', 'muted': '#888888',
        'code_bg': '#2d2d3a', 'code_fg': '#6a9955',
        'pre_bg': '#252530', 'border': '#333340',
        'quote_bg': '#252530', 'th_bg': '#2d2d3a',
    },
    'forest': {
        'fg': '#1a2a2a', 'bg': '#f4f7f6', 'heading': '#0e1e1e',
        'accent': '#6b8f71', 'muted': '#7a9a80',
        'code_bg': '#e8f0eb', 'code_fg': '#4a6a50',
        'pre_bg': '#ecf2ee', 'border': '#d4e0d8',
        'quote_bg': '#ecf2ee', 'th_bg': '#e8f0eb',
    },
    'pure': {
        'fg': '#333333', 'bg': '#ffffff', 'heading': '#1a1a1a',
        'accent': '#0366d6', 'muted': '#999999',
        'code_bg': '#f5f5f5', 'code_fg': '#d63384',
        'pre_bg': '#f8f8f8', 'border': '#e8e8e8',
        'quote_bg': '#f8f8f8', 'th_bg': '#f5f5f5',
    },
}

# 共享的预览样式基础（排版基调：衬线正文、窄栏居中、两端对齐、段首缩进。
# 2026-10-11 起阅读层改由 app.css 承担精细排版；此字典保留供 HTML 导出）。
_PREVIEW_BASE = {
    'body': "font-size:19px;line-height:2;max-width:36em;margin:0 auto;padding:48px 24px 48px 24px;text-align:justify;font-family:Georgia,'Times New Roman','Songti SC','STSong','SimSun',serif",
    'h1': "font-size:26px;font-weight:700;text-align:center;margin:36px 0 24px 0;padding-bottom:0;border-bottom:none",
    'h2': "font-size:21px;font-weight:700;margin:30px 0 16px 0;padding-bottom:.3em;border-bottom:1px solid",
    'h3': "font-size:19px;font-weight:700;margin:24px 0 12px 0",
    'h4': "font-size:19px;font-weight:600;margin:20px 0 10px 0",
    'h5': "font-size:18px;font-weight:600;margin:18px 0 8px 0",
    'h6': "font-size:17px;font-weight:600;margin:16px 0 8px 0",
    'a': "text-decoration:none",
    'code': "padding:2px 5px;border-radius:3px;font-family:'Consolas','Courier New',monospace;font-size:0.85em",
    'pre': "border-radius:8px;padding:14px;overflow-x:auto;line-height:1.6;margin:16px 0",
    'pre code': "background:transparent;padding:0;border-radius:0;font-size:0.85em",
    'blockquote': "padding:10px 18px;margin:16px 0;border-radius:0 4px 4px 0;border-left:3px solid",
    'th': "padding:8px 12px;text-align:left;font-weight:600",
    'td': "padding:8px 12px;text-align:left",
    'table': "border-collapse:collapse;width:100%;margin:16px 0",
    'img': "max-width:100%;border-radius:4px;margin:10px 0",
    'hr': "border:none;border-top:1px solid;margin:28px 0",
    'p': "margin:6px 0;text-indent:2em",
    'li p': "text-indent:0",
    'td p, th p': "text-indent:0",
    'blockquote p': "text-indent:0",
    'ul': "margin:12px 0;padding-left:28px",
    'ol': "margin:12px 0;padding-left:28px",
    'li': "margin:5px 0",
    'strong': "font-weight:700",
    'em': "font-style:italic",
}

def _make_preview(colors: dict) -> dict:
    p = dict(_PREVIEW_BASE)
    p['body'] = _PREVIEW_BASE['body'] + f";color:{colors['fg']};background:{colors['bg']}"
    p['h1'] = _PREVIEW_BASE['h1'] + f";color:{colors['heading']}"
    p['h2'] = _PREVIEW_BASE['h2'] + f";color:{colors['heading']};border-bottom-color:{colors['border']}"
    p['h3'] = _PREVIEW_BASE['h3'] + f";color:{colors['fg']}"
    p['h4'] = _PREVIEW_BASE['h4'] + f";color:{colors['fg']}"
    p['h5'] = _PREVIEW_BASE['h5'] + f";color:{colors['muted']}"
    p['h6'] = _PREVIEW_BASE['h6'] + f";color:{colors['muted']}"
    p['a'] = _PREVIEW_BASE['a'] + f";color:{colors['accent']}"
    p['code'] = _PREVIEW_BASE['code'] + f";background:{colors['code_bg']};color:{colors['code_fg']}"
    p['pre'] = _PREVIEW_BASE['pre'] + f";background:{colors['pre_bg']};border:1px solid {colors['border']}"
    p['pre code'] = _PREVIEW_BASE['pre code'] + f";color:{colors['fg']}"
    p['blockquote'] = _PREVIEW_BASE['blockquote'] + f";color:{colors['muted']};background:{colors['quote_bg']};border-left-color:{colors['accent']}"
    p['th'] = _PREVIEW_BASE['th'] + f";background:{colors['th_bg']};color:{colors['fg']};border:1px solid {colors['border']}"
    p['td'] = _PREVIEW_BASE['td'] + f";color:{colors['fg']};border:1px solid {colors['border']}"
    p['hr'] = _PREVIEW_BASE['hr'] + f";border-top-color:{colors['border']}"
    p['p'] = _PREVIEW_BASE['p'] + f";color:{colors['fg']}"
    p['ul'] = _PREVIEW_BASE['ul'] + f";color:{colors['fg']}"
    p['ol'] = _PREVIEW_BASE['ol'] + f";color:{colors['fg']}"
    p['li'] = _PREVIEW_BASE['li'] + f";color:{colors['fg']}"
    p['strong'] = _PREVIEW_BASE['strong'] + f";color:{colors['heading']}"
    p['em'] = _PREVIEW_BASE['em'] + f";color:{colors['fg']}"
    return p

THEMES = [
    {
        'id': 'paper',
        'name': '温润纸白',
        'ui': {
            'bg': '#fdfbf7', 'fg': '#2c2c2c', 'accent': '#d4a373',
            'toolbar_bg': '#fdfbf7', 'toolbar_fg': '#666666',
            'toolbar_btn_bg': '#f0ece4', 'toolbar_btn_fg': '#555555',
            'status_bg': '#fdfbf7', 'status_fg': '#6a6a6a',
            'line_numbers': '#d0ccc4', 'divider': '#e8e4dc',
        },
        'editor': {
            'font': ('Georgia', 17), 'fg': '#2c2c2c', 'bg': '#fdfbf7',
            'selectbackground': '#e8dcc8', 'selectforeground': '#2c2c2c',
            'insertbackground': '#2c2c2c', 'padx': 40, 'pady': 32,
        },
        'preview': _make_preview(_PREVIEW_COLORS['paper']),
    },
    {
        'id': 'midnight',
        'name': '深夜墨黑',
        'ui': {
            'bg': '#1e1e1e', 'fg': '#d4d4d4', 'accent': '#4ec9b0',
            'toolbar_bg': '#252525', 'toolbar_fg': '#888888',
            'toolbar_btn_bg': '#333333', 'toolbar_btn_fg': '#aaaaaa',
            'status_bg': '#252525', 'status_fg': '#888888',
            'line_numbers': '#555555', 'divider': '#333333',
        },
        'editor': {
            'font': ('Georgia', 17), 'fg': '#d4d4d4', 'bg': '#1e1e1e',
            'selectbackground': '#264f78', 'selectforeground': '#ffffff',
            'insertbackground': '#d4d4d4', 'padx': 40, 'pady': 32,
        },
        'preview': _make_preview(_PREVIEW_COLORS['midnight']),
    },
    {
        'id': 'forest',
        'name': '森之息',
        'ui': {
            'bg': '#f4f7f6', 'fg': '#1a2a2a', 'accent': '#6b8f71',
            'toolbar_bg': '#f4f7f6', 'toolbar_fg': '#666666',
            'toolbar_btn_bg': '#e8f0eb', 'toolbar_btn_fg': '#4a6a50',
            'status_bg': '#f4f7f6', 'status_fg': '#6a6a6a',
            'line_numbers': '#b0c0b0', 'divider': '#d4e0d8',
        },
        'editor': {
            'font': ('Georgia', 17), 'fg': '#1a2a2a', 'bg': '#f4f7f6',
            'selectbackground': '#c8e0d0', 'selectforeground': '#1a2a2a',
            'insertbackground': '#1a2a2a', 'padx': 40, 'pady': 32,
        },
        'preview': _make_preview(_PREVIEW_COLORS['forest']),
    },
    {
        'id': 'pure',
        'name': '极简纯白',
        'ui': {
            'bg': '#ffffff', 'fg': '#333333', 'accent': '#0366d6',
            'toolbar_bg': '#ffffff', 'toolbar_fg': '#666666',
            'toolbar_btn_bg': '#f5f5f5', 'toolbar_btn_fg': '#333333',
            'status_bg': '#ffffff', 'status_fg': '#666666',
            'line_numbers': '#cccccc', 'divider': '#e8e8e8',
        },
        'editor': {
            'font': ('Georgia', 17), 'fg': '#333333', 'bg': '#ffffff',
            'selectbackground': '#c8e1ff', 'selectforeground': '#333333',
            'insertbackground': '#333333', 'padx': 40, 'pady': 32,
        },
        'preview': _make_preview(_PREVIEW_COLORS['pure']),
    },
]


def get(theme_id: str) -> dict:
    for t in THEMES:
        if t["id"] == theme_id:
            return t
    return THEMES[0]


def theme_ids() -> list[str]:
    return [t["id"] for t in THEMES]


def theme_names() -> list[str]:
    return [t["name"] for t in THEMES]


def css_vars(theme_id: str) -> dict:
    """主题 → 前端 CSS 变量表（app.js setTheme 逐条 setProperty）。

    __hljs 不是 CSS 变量：app.js 用它切 <html data-hljs>，决定代码高亮
    走亮色还是暗色一套（midnight → dark，其余 light）。
    """
    t = get(theme_id)
    ui, ed, c = t["ui"], t["editor"], _PREVIEW_COLORS[t["id"]]
    return {
        "--bg": ui["bg"], "--fg": ui["fg"], "--accent": ui["accent"],
        "--heading": c["heading"], "--muted": c["muted"],
        "--code-bg": c["code_bg"], "--code-fg": c["code_fg"],
        "--pre-bg": c["pre_bg"], "--border": c["border"],
        "--quote-bg": c["quote_bg"], "--th-bg": c["th_bg"],
        "--select": ed["selectbackground"], "--caret": ed["insertbackground"],
        "--linenum": ui["line_numbers"], "--divider": ui["divider"],
        "--status-fg": ui["status_fg"], "--tabbar-bg": ui["toolbar_bg"],
        "--btn-bg": ui["toolbar_btn_bg"], "--btn-fg": ui["toolbar_btn_fg"],
        "__hljs": "dark" if t["id"] == "midnight" else "light",
    }


def preview_css(theme_id: str) -> str:
    t = get(theme_id)
    rules = t.get("preview", {})
    parts = []
    for sel, style in rules.items():
        parts.append(sel + " { " + style + " }")
    return "\n".join(parts)


def pygments_style(theme_id: str) -> str:
    return PYG_STYLE.get(theme_id, "default")
