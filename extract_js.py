# JavaScript 파일 분리 스크립트
import re

# index.html 읽기
with open(r'c:\Users\taehe\OneDrive\문서\GitHub\qplay_search\index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# JavaScript 코드 추출 (195-3123줄 사이의 모든 script 내용)
# 첫 번째 script 태그 찾기 (195줄부터)
script_start = content.find('<script type="module">', content.find('</head>'))
script_end = content.find('</script>', script_start)
first_script = content[script_start + len('<script type="module">'):script_end].strip()

# 두 번째 script 태그 찾기
second_script_start = content.find('<script>', script_end + 10)
second_script_end = content.rfind('</script>')
second_script = content[second_script_start + len('<script>'):second_script_end].strip()

# 전체 JavaScript 코드
full_js = first_script + '\n\n' + second_script

print(f"전체 JavaScript 코드 길이: {len(full_js)} 문자")
print(f"첫 번째 스크립트: {len(first_script)} 문자")
print(f"두 번째 스크립트: {len(second_script)} 문자")

# 파일 저장 (임시로 전체 코드 확인)
with open(r'c:\Users\taehe\OneDrive\문서\GitHub\qplay_search\js\temp_full.js', 'w', encoding='utf-8') as f:
    f.write(full_js)

print("임시 파일 생성 완료: js/temp_full.js")
