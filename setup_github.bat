@echo off
chcp 65001 >nul
echo ========================================
echo   GitHub 연동 가이드
echo ========================================
echo.
echo 이 스크립트는 GitHub에 코드를 업로드하는 과정을 안내합니다.
echo.
echo 1단계: Git 설치 확인
echo.
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [경고] Git이 설치되어 있지 않습니다.
    echo.
    echo Git을 설치하려면:
    echo 1. https://git-scm.com/download/win 방문
    echo 2. 다운로드 후 설치
    echo 3. 설치 후 이 스크립트를 다시 실행하세요
    echo.
    pause
    exit /b 1
)

echo [확인] Git이 설치되어 있습니다.
echo.
echo 2단계: GitHub 리포지토리 생성
echo.
echo 다음 단계를 따라주세요:
echo 1. https://github.com 접속
echo 2. 로그인 후 "New repository" 클릭
echo 3. Repository name 입력 (예: qplay-search)
echo 4. Public 또는 Private 선택
echo 5. "Create repository" 클릭
echo.
set /p repo_url="생성한 GitHub 리포지토리 URL을 입력하세요 (예: https://github.com/사용자명/리포지토리명.git): "

if "%repo_url%"=="" (
    echo.
    echo URL을 입력하지 않았습니다. 나중에 직접 실행하세요:
    echo git remote add origin [리포지토리_URL]
    echo.
    pause
    exit /b 1
)

echo.
echo 3단계: Git 초기화 및 업로드
echo.

if not exist .git (
    echo Git 저장소 초기화 중...
    git init
    echo.
)

echo 파일 추가 중...
git add .

echo.
set /p commit_msg="커밋 메시지를 입력하세요 (기본값: Initial commit): "
if "%commit_msg%"=="" set commit_msg=Initial commit

git commit -m "%commit_msg%"
echo.

echo 원격 저장소 연결 중...
git branch -M main
git remote remove origin 2>nul
git remote add origin %repo_url%
echo.

echo GitHub에 업로드 중...
echo (GitHub 인증이 필요할 수 있습니다)
git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo   성공! GitHub에 업로드되었습니다!
    echo ========================================
    echo.
    echo 다음 단계:
    echo 1. Render.com 또는 Railway.app 접속
    echo 2. GitHub 리포지토리 연결
    echo 3. 자동 배포 시작!
    echo.
) else (
    echo.
    echo [오류] 업로드에 실패했습니다.
    echo.
    echo 수동으로 실행하려면:
    echo git push -u origin main
    echo.
)

pause
