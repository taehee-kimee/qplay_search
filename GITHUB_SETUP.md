========================================
GitHub 연동 단계별 가이드
========================================

✅ 방법 1: 자동 스크립트 사용 (가장 쉬움!)

   Windows:
   - setup_github.bat 파일을 더블클릭하세요!

   Mac/Linux:
   - 터미널에서 실행:
     chmod +x setup_github.sh
     ./setup_github.sh

✅ 방법 2: 수동으로 실행

1단계: Git 설치 확인
   git --version
   
   설치되어 있지 않다면:
   - Windows: https://git-scm.com/download/win
   - Mac: brew install git
   - Linux: sudo apt-get install git

2단계: GitHub 리포지토리 생성
   1. https://github.com 접속 및 로그인
   2. 우측 상단 "+" 버튼 → "New repository" 클릭
   3. Repository name 입력 (예: qplay-search)
   4. Public 또는 Private 선택
   5. "Create repository" 클릭
   6. 생성된 리포지토리 URL 복사
      (예: https://github.com/사용자명/qplay-search.git)

3단계: Git 초기화 및 업로드
   다음 명령어를 순서대로 실행:

   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/사용자명/리포지토리명.git
   git push -u origin main

   (GitHub 인증이 필요할 수 있습니다)

4단계: 배포 플랫폼 연결
   - Render.com 또는 Railway.app 접속
   - GitHub 리포지토리 연결
   - 자동 배포!

========================================
주의사항
========================================

⚠️ Excel 파일(큐플족보_251021.xlsx)도 함께 업로드해야 합니다!
   - .gitignore에 의해 제외되지 않도록 확인하세요
   - 파일 크기가 크면 업로드에 시간이 걸릴 수 있습니다

⚠️ GitHub 인증
   - Personal Access Token이 필요할 수 있습니다
   - GitHub Settings → Developer settings → Personal access tokens
   - 또는 GitHub Desktop 사용 권장

========================================
문제 해결
========================================

Q: "git: command not found" 오류
A: Git을 설치하세요 (위 1단계 참고)

Q: 인증 오류
A: GitHub Personal Access Token 사용 또는 GitHub Desktop 사용

Q: 큰 파일 업로드 오류
A: Git LFS (Large File Storage) 사용 또는 파일을 분할

========================================
