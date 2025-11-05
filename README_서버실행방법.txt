========================================
로컬 웹 서버 실행 방법
========================================

✅ 방법 1: Flask 서버 (권장) - 더 나은 성능과 기능
   
   1. Flask 설치:
      pip install flask flask-cors
   
   2. 서버 실행:
      python server.py
   
   3. 브라우저에서 접속:
      http://localhost:5000

✅ 방법 2: 간단한 Python 서버
   
   python -m http.server 8000
   
   브라우저에서: http://localhost:8000/index.html

✅ 빠른 시작 (Windows):
   start_server.bat 파일을 더블클릭하세요!
   (서버 유형 선택 가능)

✅ 빠른 시작 (Mac/Linux):
   터미널에서 다음 명령어 실행:
   chmod +x start_server.sh
   ./start_server.sh

✅ Excel 파일 자동 로드:
   - Excel 파일(큐플족보_251021.xlsx)이 같은 폴더에 있으면
     웹 서버 환경에서 자동으로 로드됩니다!

✅ Node.js를 사용하는 경우:
   npx http-server -p 8000

========================================
Flask 서버의 장점
========================================
- 더 나은 성능과 안정성
- CORS 지원으로 다양한 환경에서 작동
- 향후 기능 확장이 쉬움 (API 추가 등)
- 프로덕션 환경에 배포 가능

========================================
주의사항
========================================
- index.html과 큐플족보_251021.xlsx 파일이 같은 폴더에 있어야 합니다.
- 서버를 종료하려면 Ctrl+C를 누르세요.
- Flask를 처음 사용하는 경우: pip install flask flask-cors
