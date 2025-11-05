# QPlay 문제 검색 시스템

Excel 파일을 업로드하고 문제를 검색할 수 있는 웹 애플리케이션입니다.

## 기능

- Excel 파일 업로드 및 자동 파싱
- 실시간 검색 기능
- 카테고리별 필터링
- 여러 시트 지원

## 로컬 실행

```bash
pip install -r requirements.txt
python server.py
```

## 배포 방법

### Render 사용 (추천)

1. GitHub에 코드 업로드
2. [Render.com](https://render.com)에서 계정 생성
3. "New Web Service" 선택
4. GitHub 리포지토리 연결
5. Build Command: `pip install -r requirements.txt`
6. Start Command: `gunicorn server:app`
7. Deploy!

### Railway 사용

1. GitHub에 코드 업로드
2. [Railway.app](https://railway.app)에서 계정 생성
3. "New Project" → "Deploy from GitHub repo"
4. 자동으로 배포됩니다!

### Netlify 사용 (정적 사이트)

1. Excel 파일을 JavaScript로 변환 필요
2. [Netlify](https://netlify.com)에서 드래그 앤 드롭으로 배포

## 파일 구조

- `index.html` - 메인 HTML 파일
- `server.py` - Flask 서버
- `requirements.txt` - Python 패키지 목록
- `큐플족보_251021.xlsx` - Excel 데이터 파일

## 라이선스

MIT
