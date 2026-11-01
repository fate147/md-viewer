@echo off
rem ============================================================
rem MD Viewer - rebuild the two launcher exes with the current icon.
rem Run after changing installer\assets\md-editor-icon-dark*.svg and
rem regenerating mdviewer.ico (see AGENTS.md "icon" section).
rem
rem NOTE: this file MUST stay CRLF. cmd.exe mis-parses goto/errorlevel
rem in LF-only batch files and the window closes with no output.
rem ============================================================
setlocal
set "ROOT=%~dp0..\.."
set "LOG=%~dp0build_exe.log"
set "CSC="

if exist "%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not defined CSC if exist "%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"

echo ==== build start %DATE% %TIME% > "%LOG%"

if not defined CSC (
  echo [FAIL] csc.exe not found under %%WINDIR%%\Microsoft.NET\Framework*
  echo [FAIL] csc.exe not found >> "%LOG%"
  goto :end
)

if not exist "%ROOT%\installer\assets\mdviewer.ico" (
  echo [FAIL] icon missing: installer\assets\mdviewer.ico
  echo [FAIL] icon missing >> "%LOG%"
  goto :end
)

pushd "%ROOT%\installer"
if errorlevel 1 (
  echo [FAIL] cannot enter installer dir
  echo [FAIL] cannot enter installer dir >> "%LOG%"
  goto :end
)

echo [1/3] md-viewer.exe ...
echo [1/3] md-viewer.exe >> "%LOG%"
"%CSC%" -nologo -target:winexe -win32icon:assets/mdviewer.ico -out:..\dist-app\MDViewer\md-viewer.exe md-launcher.cs >> "%LOG%" 2>&1
if errorlevel 1 goto :buildfail

echo [2/3] mdviewer-assoc.exe ...
echo [2/3] mdviewer-assoc.exe >> "%LOG%"
"%CSC%" -nologo -target:winexe -win32icon:assets/mdviewer.ico -out:mdviewer-assoc.exe mdviewer-assoc.cs >> "%LOG%" 2>&1
if errorlevel 1 goto :buildfail

echo [3/3] copying mdviewer-assoc.exe ...
echo [3/3] copy >> "%LOG%"
copy /y mdviewer-assoc.exe ..\dist-app\MDViewer\ >> "%LOG%" 2>&1
if errorlevel 1 goto :buildfail

popd
echo.
echo [DONE] rebuilt with the new icon:
echo        dist-app\MDViewer\md-viewer.exe
echo        dist-app\MDViewer\mdviewer-assoc.exe
echo [DONE] >> "%LOG%"
goto :end

:buildfail
popd
echo.
echo [FAIL] csc reported an error - see the log below.
echo [FAIL] csc error >> "%LOG%"

:end
echo.
echo ---- %LOG% ----
type "%LOG%"
echo ----------------
echo.
pause
endlocal
