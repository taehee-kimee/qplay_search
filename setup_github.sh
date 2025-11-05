#!/bin/bash
echo "========================================"
echo "  GitHub 연동 가이드"
echo "========================================"
echo ""

# Git 설치 확인
if ! command -v git &> /dev/null; then
    echo "[경고] Git이 설치되어 있지 않습니다."
    echo ""
    echo "macOS: brew install git"
    echo "Linux: sudo apt-get install git"
    echo ""
    exit 1
fi

echo "[확인] Git이 설치되어 있습니다."
echo ""
echo "2단계: GitHub 리포지토리 생성"
echo ""
echo "다음 단계를 따라주세요:"
echo "1. https://github.com 접속"
echo "2. 로그인 후 'New repository' 클릭"
echo "3. Repository name 입력 (예: qplay-search)"
echo "4. Public 또는 Private 선택"
echo "5. 'Create repository' 클릭"
echo ""

read -p "생성한 GitHub 리포지토리 URL을 입력하세요: " repo_url

if [ -z "$repo_url" ]; then
    echo ""
    echo "URL을 입력하지 않았습니다."
    exit 1
fi

echo ""
echo "3단계: Git 초기화 및 업로드"
echo ""

if [ ! -d .git ]; then
    echo "Git 저장소 초기화 중..."
    git init
    echo ""
fi

echo "파일 추가 중..."
git add .

echo ""
read -p "커밋 메시지를 입력하세요 (기본값: Initial commit): " commit_msg
commit_msg=${commit_msg:-Initial commit}

git commit -m "$commit_msg"
echo ""

echo "원격 저장소 연결 중..."
git branch -M main
git remote remove origin 2>/dev/null
git remote add origin "$repo_url"
echo ""

echo "GitHub에 업로드 중..."
git push -u origin main

if [ $? -eq 0 ]; then
    echo ""
    echo "========================================"
    echo "  성공! GitHub에 업로드되었습니다!"
    echo "========================================"
    echo ""
    echo "다음 단계:"
    echo "1. Render.com 또는 Railway.app 접속"
    echo "2. GitHub 리포지토리 연결"
    echo "3. 자동 배포 시작!"
    echo ""
else
    echo ""
    echo "[오류] 업로드에 실패했습니다."
    echo ""
    echo "수동으로 실행하려면:"
    echo "git push -u origin main"
    echo ""
fi
