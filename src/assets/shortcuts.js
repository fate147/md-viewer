// 快捷键单一数据源（shortcuts.js）：首页/帮助面板/命令面板全部由这份表生成。
// 修改快捷键时只改这里；specs/00 的「功能闭环」与实现保持一致。
(function () {
  "use strict";
  window.MDV_SHORTCUTS = [
    { keys: "Ctrl+O", scope: "全局", desc: "打开文件", keywords: "open" },
    { keys: "Ctrl+N", scope: "全局", desc: "新建文档", keywords: "new" },
    { keys: "Ctrl+S", scope: "全局", desc: "保存", keywords: "save" },
    { keys: "Ctrl+Shift+S", scope: "全局", desc: "另存为", keywords: "saveas" },
    { keys: "Ctrl+W", scope: "全局", desc: "关闭当前文件", keywords: "close" },
    { keys: "Ctrl+Q", scope: "全局", desc: "退出", keywords: "quit" },
    { keys: "Ctrl+K", scope: "全局", desc: "命令面板", keywords: "palette command" },
    { keys: "Ctrl+Z / Ctrl+Y", scope: "全局", desc: "撤销 / 重做", keywords: "undo redo" },
    { keys: "Ctrl+X / Ctrl+C / Ctrl+V", scope: "全局", desc: "剪切 / 复制 / 粘贴", keywords: "cut copy paste" },
    { keys: "Ctrl+A", scope: "全局", desc: "全选", keywords: "select all" },
    { keys: "Ctrl+F", scope: "全局", desc: "查找", keywords: "find" },
    { keys: "Ctrl+H", scope: "全局", desc: "查找 / 替换", keywords: "replace" },
    { keys: "F2", scope: "全局", desc: "编辑 ⇄ 阅读切换", keywords: "toggle edit read" },
    { keys: "Ctrl+Shift+O", scope: "全局", desc: "显示 / 隐藏目录", keywords: "toc" },
    { keys: "Ctrl+Shift+P", scope: "全局", desc: "导出 HTML", keywords: "export html" },
    { keys: "Ctrl+← / Ctrl+→", scope: "阅读态", desc: "上一章 / 下一章", keywords: "chapter" },
  ];
})();
