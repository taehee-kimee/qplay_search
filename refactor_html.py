# index.html 리팩토링 스크립트 (수정 버전)
with open(r'c:\Users\taehe\OneDrive\문서\GitHub\qplay_search\index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. CSS 제거 및 링크 추가
# <style> 태그 찾기
style_start = content.find('    <style>')
style_end = content.find('    </style>') + len('    </style>\r\n')

# CSS 제거
content_no_css = content[:style_start] + content[style_end:]

# <title> 태그 뒤에 CSS 링크 추가
title_end = content_no_css.find('</title>') + len('</title>\r\n')
content_with_css_link = content_no_css[:title_end] + '    <link rel="stylesheet" href="styles.css">\r\n' + content_no_css[title_end:]

# 2. JavaScript 제거 및 링크 추가
# 첫 번째 <script type="module"> 찾기 (Feature Flags)
first_script_start = content_with_css_link.find('    <script type="module">', content_with_css_link.find('</head>') - 500)
first_script_end = content_with_css_link.find('    </script>', first_script_start) + len('    </script>\r\n')

# 두 번째 <script> 찾기 (메인 JavaScript)
second_script_start = content_with_css_link.find('    <script>', first_script_end)
second_script_end = content_with_css_link.rfind('    </script>') + len('    </script>\r\n')

# JavaScript 제거
content_no_js = content_with_css_link[:first_script_start] + content_with_css_link[first_script_end:second_script_start] + content_with_css_link[second_script_end:]

# </head> 태그 전에 JavaScript 링크 추가
head_end = content_no_js.find('</head>')
content_final = content_no_js[:head_end] + '    <script src="js/app.js"></script>\r\n' + content_no_js[head_end:]

# 파일 저장
with open(r'c:\Users\taehe\OneDrive\문서\GitHub\qplay_search\index.html', 'w', encoding='utf-8') as f:
    f.write(content_final)

print("index.html 리팩토링 완료")
print(f"원본 크기: {len(content)} 바이트")
print(f"최종 크기: {len(content_final)} 바이트")
print(f"감소: {len(content) - len(content_final)} 바이트")
