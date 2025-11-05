@echo off
chcp 65001 >nul
echo ========================================
echo   GitHub Desktop 사용 준비
echo ========================================
echo.
echo GitHub Desktop을 사용하기 위해 Git 저장소를 초기화합니다.
echo.

REM Git이 설치되어 있는지 확인
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] Git이 설치되어 있지 않습니다.
    echo GitHub Desktop을 설치하면 Git도 함께 설치됩니다.
    echo.
    echo 다음 단계:
    echo 1. https://desktop.github.com 접속하여 GitHub Desktop 다운로드
    echo 2. GitHub Desktop 설치
    echo 3. 설치 후 이 스크립트를 다시 실행하거나
    echo    GitHub Desktop에서 직접 "Add Local Repository" 사용
    echo.
    pause
    exit /b 1
)

echo [1/3] Git 저장소 초기화 중...
if exist .git (
    echo Git 저장소가 이미 초기화되어 있습니다.
) else (
    git init
    if %errorlevel% neq 0 (
        echo [오류] Git 초기화 실패
        pause
        exit /b 1
    )
    echo 완료!
)

echo.
echo [2/3] 파일 추가 중...
git add .
if %errorlevel% neq 0 (
    echo [오류] 파일 추가 실패
    pause
    exit /b 1
)
echo 완료!

echo.
echo [3/3] 초기 커밋 생성 중...
git commit -m "Initial commit: Excel 문제 검색 시스템" >nul 2>&1
if %errorlevel% equ 0 (
    echo 완료!
) else (
    echo 이미 커밋된 파일이 있습니다. (정상)
)

echo.
echo ========================================
echo   준비 완료!
echo ========================================
echo.
echo 다음 단계:
echo.
echo 1. GitHub Desktop을 열어주세요
echo    (설치되어 있지 않다면: https://desktop.github.com)
echo.
echo 2. GitHub Desktop에서:
echo    - File ^> Add Local Repository 클릭
echo    - 이 폴더를 선택: %CD%
echo    - Add Repository 클릭
echo.
echo 3. GitHub Desktop 상단에서:
echo    - "Publish repository" 버튼 클릭
echo    - Repository name 입력 (예: qplay-search)
echo    - Description 입력 (선택사항)
echo    - "Keep this code private" 체크 해제 (Public으로)
echo    - "Publish repository" 클릭
echo.
echo 4. 완료! GitHub에 업로드됩니다.
echo.
pause

