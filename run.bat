@echo off
chcp 65001 >nul
setlocal EnableExtensions
title MD Viewer - 源码模式
cd /d "%~dp0"

rem ============================================================
rem  MD Viewer 源码模式启动器（双击即用）
rem  报错优先于美观：前台运行 python.exe，异常才会留在窗口里。
rem  退出码约定见 specs/01 R-01-06：2=缺 WebView2，3=CLR 装配失败。
rem ============================================================

rem ---------- 1. 找 Python 3.12 ----------
set "PYCMD="
py -3.12 -c "import sys" >nul 2>nul && set "PYCMD=py -3.12"
if not defined PYCMD (
    python -c "import sys" >nul 2>nul && set "PYCMD=python"
)
if not defined PYCMD (
    echo [ERROR] 未找到 Python。请安装 Python 3.12，并勾选 Add python.exe to PATH
    echo         https://www.python.org/downloads/
    pause
    exit /b 1
)

rem ---------- 2. 依赖自检（缺了立刻报，别等程序崩） ----------
%PYCMD% -c "import tkwebview2" >nul 2>nul
if errorlevel 1 (
    echo [ERROR] 依赖未安装。请在当前目录依次执行：
    echo.
    echo         %PYCMD% -m pip install -r requirements.txt
    echo         %PYCMD% -m pip install "clr-loader==0.2.6" --no-deps
    echo.
    echo 第二步不能省，原因见 requirements.txt 文末注释。
    pause
    exit /b 1
)

rem ---------- 3. clr-loader 版本提醒（最常见的启动失败原因） ----------
%PYCMD% -c "import importlib.metadata as m,sys;sys.exit(0 if m.version('clr-loader')=='0.2.6' else 1)" >nul 2>nul
if errorlevel 1 (
    echo [WARN] clr-loader 不是 0.2.6，启动可能报「运行时装配失败」。
    echo        修正：%PYCMD% -m pip install "clr-loader==0.2.6" --no-deps
    echo.
)

rem ---------- 4. 启动 ----------
echo 启动 MD Viewer ...
%PYCMD% "src\main.pyw"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
    echo.
    echo [退出码 %RC%] 启动失败。诊断日志：md-viewer-error.log
    echo 退出码 2 = 缺 WebView2 Runtime；3 = CLR / pythonnet 装配失败
    echo 详见 https://github.com/fate147/md-viewer/blob/main/README.md 已知限制
    pause
)

endlocal
