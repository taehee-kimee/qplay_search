# index.html에서 JavaScript 제거하고 외부 링크 추가
with open(r'c:\Users\taehe\OneDrive\문서\GitHub\qplay_search\index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# JavaScript 시작 위치 찾기 (Service Worker 스크립트 이후)
# 20줄 이후부터 body 시작 전까지가 JavaScript
new_lines = []
in_script = False
script_count = 0

for i, line in enumerate(lines):
    # Service Worker 스크립트는 유지 (11-19줄)
    if i < 20:
        new_lines.append(line)
    # </head> 태그 전에 외부 스크립트 추가
    elif '</head>' in line:
        new_lines.append('    <script src="js/app.js"></script>\n')
        new_lines.append(line)
    # <script> 태그 시작 감지
    elif '<script' in line and i >= 20:
        in_script = True
        script_count += 1
    # </script> 태그 종료 감지
    elif '</script>' in line and in_script:
        in_script = False
        # 마지막 스크립트 이후부터 다시 추가
        if script_count >= 2:  # 두 번째 스크립트 이후
            continue
    # 스크립트 내부는 건너뛰기
    elif in_script:
        continue
    # body 이후는 모두 추가
    elif '<body>' in line or (i > 20 and not in_script and script_count >= 2):
        new_lines.append(line)

# 파일 저장
with open(r'c:\Users\taehe\OneDrive\문서\GitHub\qplay_search\index.html', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print(f"index.html 업데이트 완료")
print(f"원본 줄 수: {len(lines)}")
print(f"새 줄 수: {len(new_lines)}")
