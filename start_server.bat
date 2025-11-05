@echo off
chcp 65001 >nul
echo ========================================
echo   로컬 웹 서버 시작
echo ========================================
echo.
echo 서버 유형을 선택하세요:
echo   1. Flask 서버 (권장) - 더 나은 성능
echo   2. 간단한 Python 서버
echo.
set /p choice="선택 (1 또는 2): "

if "%choice%"=="1" (
    echo.
    echo Flask 서버를 시작합니다...
    echo 브라우저에서 http://localhost:5000 을 열어주세요.
    echo.
    python server.py
) else (
    echo.
    echo Python 웹 서버를 시작합니다...
    echo 브라우저에서 http://localhost:8000/index.html 을 열어주세요.
    echo.
    python -m http.server 8000
)

pause
