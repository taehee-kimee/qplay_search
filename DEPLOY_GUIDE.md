========================================
공개 웹사이트 배포 단계별 가이드
========================================

🎯 목표: 모든 사람이 접근할 수 있는 웹사이트 만들기

========================================
방법 1: Render 사용 (가장 추천!) ⭐
========================================

✅ 장점:
   - 무료 플랜 제공
   - 설정이 매우 간단
   - GitHub 연동으로 자동 배포
   - Flask 서버 지원

📝 단계:

1. GitHub에 코드 업로드
   - GitHub.com에서 새 리포지토리 생성
   - 모든 파일을 업로드

2. Render 계정 생성
   - https://render.com 접속
   - "Get Started for Free" 클릭
   - GitHub 계정으로 로그인

3. 새 웹 서비스 생성
   - Dashboard에서 "New +" 클릭
   - "Web Service" 선택
   - GitHub 리포지토리 연결

4. 설정 입력
   - Name: qplay-search (원하는 이름)
   - Region: Singapore (가장 가까운 지역)
   - Branch: main
   - Root Directory: (비워두기)
   - Environment: Python 3
   - Build Command: pip install -r requirements.txt
   - Start Command: gunicorn server:app
   - Instance Type: Free

5. 배포!
   - "Create Web Service" 클릭
   - 5-10분 정도 기다리면 완료!
   - 주소: https://qplay-search.onrender.com (예시)

========================================
방법 2: Railway 사용
========================================

✅ 장점:
   - 무료 크레딧 제공
   - 매우 사용하기 쉬움
   - GitHub 연동

📝 단계:

1. GitHub에 코드 업로드

2. Railway 계정 생성
   - https://railway.app 접속
   - "Login" 클릭
   - GitHub 계정으로 로그인

3. 새 프로젝트 생성
   - "New Project" 클릭
   - "Deploy from GitHub repo" 선택
   - 리포지토리 선택

4. 자동 배포!
   - Railway가 자동으로 감지하고 배포
   - 주소: https://qplay-search.up.railway.app (예시)

========================================
방법 3: Netlify (정적 사이트)
========================================

⚠️ 주의: Excel 파일을 JavaScript로 변환해야 함

📝 단계:

1. Excel 파일을 JavaScript로 변환
   python convert_to_js.py

2. HTML 파일 수정하여 excel_data.js 포함

3. Netlify에 배포
   - https://netlify.com 접속
   - 파일 드래그 앤 드롭

========================================
배포 전 체크리스트
========================================

✅ 모든 파일이 GitHub에 업로드되었는지 확인
✅ requirements.txt에 모든 패키지가 포함되어 있는지 확인
✅ server.py가 올바르게 작동하는지 로컬에서 테스트
✅ Excel 파일이 같은 폴더에 있는지 확인

========================================
배포 후 확인사항
========================================

✅ 웹사이트가 정상적으로 로드되는지 확인
✅ Excel 파일이 자동으로 로드되는지 확인
✅ 검색 기능이 작동하는지 확인
✅ 카테고리 선택이 작동하는지 확인

========================================
무료 플랜 제한사항
========================================

Render:
- 무료 플랜은 15분간 사용 안 하면 sleep
- 첫 로드 시 조금 느릴 수 있음

Railway:
- 월 $5 크레딧 제공
- 사용량에 따라 제한될 수 있음

========================================
도움이 필요하면?
========================================

각 서비스의 공식 문서를 참고하세요:
- Render: https://render.com/docs
- Railway: https://docs.railway.app
- Netlify: https://docs.netlify.com