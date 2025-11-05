@echo off
chcp 65001 >nul
echo ========================================
echo   GitHub에 퍼블리시하기
echo ========================================
echo.

REM Git이 설치되어 있는지 확인
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] Git이 설치되어 있지 않습니다.
    echo https://git-scm.com/download/win 에서 Git을 설치해주세요.
    pause
    exit /b 1
)

echo [1/5] Git 저장소 초기화 중...
git init
if %errorlevel% neq 0 (
    echo [오류] Git 초기화 실패
    pause
    exit /b 1
)

echo.
echo [2/5] 파일 추가 중...
git add .
if %errorlevel% neq 0 (
    echo [오류] 파일 추가 실패
    pause
    exit /b 1
)

echo.
echo [3/5] 커밋 생성 중...
git commit -m "Initial commit: Excel 문제 검색 시스템"
if %errorlevel% neq 0 (
    echo [경고] 커밋 생성 실패 (이미 커밋된 파일일 수 있습니다)
)

echo.
echo [4/5] 브랜치 이름 변경 중...
git branch -M main
if %errorlevel% neq 0 (
    echo [경고] 브랜치 이름 변경 실패
)

echo.
echo ========================================
echo   다음 단계를 진행하세요:
echo ========================================
echo.
echo 1. GitHub.com에 접속하여 새 리포지토리를 만드세요.
echo    (https://github.com/new)
echo.
echo 2. 리포지토리 이름을 입력하세요 (예: qplay-search)
echo.
echo 3. 아래 명령어를 실행하세요:
echo    git remote add origin https://github.com/사용자명/리포지토리명.git
echo    git push -u origin main
echo.
echo 또는 아래에 GitHub 리포지토리 URL을 입력하세요:
echo.
set /p REPO_URL="GitHub 리포지토리 URL (예: https://github.com/사용자명/리포지토리명.git): "

if not "%REPO_URL%"=="" (
    echo.
    echo [5/5] 원격 저장소 연결 중...
    git remote add origin %REPO_URL%
    if %errorlevel% neq 0 (
        echo [경고] 원격 저장소 추가 실패 (이미 추가되어 있을 수 있습니다)
        git remote set-url origin %REPO_URL%
    )
    
    echo.
    echo 푸시 중...
    git push -u origin main
    if %errorlevel% neq 0 (
        echo.
        echo [오류] 푸시 실패
        echo 인증이 필요할 수 있습니다. GitHub Desktop을 사용하거나
        echo Personal Access Token을 사용하세요.
        pause
        exit /b 1
    )
    
    echo.
    echo ========================================
    echo   성공적으로 GitHub에 업로드되었습니다!
    echo ========================================
    echo.
    echo 리포지토리: %REPO_URL%
    echo.
) else (
    echo.
    echo GitHub 리포지토리 URL을 입력하지 않았습니다.
    echo 나중에 다음 명령어로 푸시할 수 있습니다:
    echo   git remote add origin https://github.com/사용자명/리포지토리명.git
    echo   git push -u origin main
    echo.
)

pause

