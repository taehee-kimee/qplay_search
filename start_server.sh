#!/bin/bash
echo "========================================"
echo "  로컬 웹 서버 시작"
echo "========================================"
echo ""
echo "Python 웹 서버를 시작합니다..."
echo "브라우저에서 http://localhost:8000/index.html 을 열어주세요."
echo ""
echo "종료하려면 Ctrl+C를 누르세요."
echo ""
echo "========================================"
echo ""

python3 -m http.server 8000
