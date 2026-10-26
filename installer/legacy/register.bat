@echo off
chcp 65001 >nul
title MD Viewer - 设为 .md 默认程序
setlocal

rem 安装器/守护程序（C#，用系统自带 csc.exe 编译，无需管理员权限）
if not exist "%~dp0installer\mdviewer-assoc.exe" (
    echo [ERROR] 缺少 installer\mdviewer-assoc.exe
    pause
    exit /b 1
)
if not exist "%~dp0md-viewer\md-viewer.exe" (
    echo [ERROR] 未找到 md-viewer\md-viewer.exe
    echo 请先用 pyinstaller md-viewer.spec 打包，并把 dist\md-viewer 复制到本目录。
    pause
    exit /b 1
)

echo 正在把 .md 的默认程序设为 MD Viewer，并注册登录时的守护...
start "" /wait "%~dp0installer\mdviewer-assoc.exe" --install "%~dp0md-viewer"
if exist "%~dp0installer\mdviewer-assoc.log" type "%~dp0installer\mdviewer-assoc.log"
echo.
echo [完成] 双击任意 .md 即用 MD Viewer 打开。
echo 之后即使别的程序抢走关联，下次登录也会自动夺回。
echo.
pause
endlocal
