@echo off
chcp 65001 >nul
setlocal
set "PYTHONUTF8=1"
set "WXQ_DIR=%~dp0"
cd /d "%WXQ_DIR%"
if not exist "data.xlsx" (
  echo 未找到 data.xlsx，请将文件放在此 BAT 所在目录。
  goto :failed
)
set "WXQ_PYTHON=py -3"
%WXQ_PYTHON% --version >nul 2>&1
if errorlevel 1 set "WXQ_PYTHON=python"
%WXQ_PYTHON% --version >nul 2>&1
if errorlevel 1 (
  echo 未找到 Python 3，请先安装 Python 3 并启用 PATH。
  goto :failed
)
%WXQ_PYTHON% -c "import openpyxl" >nul 2>&1
if errorlevel 1 (
  echo 正在安装 Excel 读取依赖 openpyxl...
  %WXQ_PYTHON% -m pip install -r "%WXQ_DIR%requirements.txt"
  if errorlevel 1 goto :failed
)
%WXQ_PYTHON% "%WXQ_DIR%process_data.py"
if errorlevel 1 goto :failed
%WXQ_PYTHON% "%WXQ_DIR%..\build.py"
if errorlevel 1 goto :failed
echo.
echo 数据已生成并同步到 docs，请刷新网站的“万象棋”页面。
pause
exit /b 0
:failed
echo.
echo 处理失败，请根据上方提示检查后重试。
pause
exit /b 1
