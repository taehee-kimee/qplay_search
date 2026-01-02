"""
중복 문제 찾기 스크립트
문제와 답이 완전히 일치하는 중복 문제를 찾아서 리포트 생성
"""
import json
import os
from collections import defaultdict

# 카테고리 파일 목록
categories_dir = r'c:\Users\taehe\OneDrive\문서\GitHub\qplay_search\categories'
category_files = [
    'ox_xo.json',
    'garoseseo.json',
    'ollaolla.json',
    'kkong.json'
]

# 중복 문제 저장용 딕셔너리 (키: (question, answer), 값: 문제 정보 리스트)
duplicates = defaultdict(list)
total_problems = 0
total_duplicates = 0

print("=" * 80)
print("중복 문제 검사 시작")
print("=" * 80)

# 각 카테고리 파일 읽기
for filename in category_files:
    filepath = os.path.join(categories_dir, filename)
    
    if not os.path.exists(filepath):
        print(f"[경고] 파일을 찾을 수 없습니다: {filename}")
        continue
    
    print(f"\n[파일] {filename} 검사 중...")
    
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
        problems = data.get('data', [])
        
        for problem in problems:
            question = problem.get('question', '').strip()
            answer = problem.get('answer', '').strip()
            index = problem.get('index', 0)
            sheet = problem.get('sheet', '')
            
            # 문제와 답을 키로 사용
            key = (question, answer)
            
            # 문제 정보 저장
            duplicates[key].append({
                'file': filename,
                'sheet': sheet,
                'index': index,
                'question': question,
                'answer': answer
            })
            
            total_problems += 1
    
    print(f"   [완료] {len(problems)}개 문제 검사 완료")

print(f"\n총 {total_problems}개 문제 검사 완료")

# 중복 문제 필터링 (2개 이상 등장한 문제만)
duplicate_groups = {k: v for k, v in duplicates.items() if len(v) > 1}
total_duplicates = sum(len(v) - 1 for v in duplicate_groups.values())  # 원본 제외한 중복 개수

print(f"\n중복 문제 그룹: {len(duplicate_groups)}개")
print(f"중복된 문제 총 개수: {total_duplicates}개 (원본 제외)")

# 결과 파일 생성
output_file = r'c:\Users\taehe\OneDrive\문서\GitHub\qplay_search\utils\duplicate_report.txt'

with open(output_file, 'w', encoding='utf-8') as f:
    f.write("=" * 80 + "\n")
    f.write("중복 문제 리포트\n")
    f.write("=" * 80 + "\n\n")
    f.write(f"총 검사 문제 수: {total_problems}개\n")
    f.write(f"중복 문제 그룹: {len(duplicate_groups)}개\n")
    f.write(f"중복된 문제 총 개수: {total_duplicates}개 (원본 제외)\n")
    f.write("\n" + "=" * 80 + "\n\n")
    
    # 중복 횟수가 많은 순으로 정렬
    sorted_duplicates = sorted(duplicate_groups.items(), key=lambda x: len(x[1]), reverse=True)
    
    for idx, ((question, answer), occurrences) in enumerate(sorted_duplicates, 1):
        f.write(f"[중복 그룹 #{idx}] - {len(occurrences)}회 중복\n")
        f.write("-" * 80 + "\n")
        f.write(f"문제: {question}\n")
        f.write(f"답: {answer}\n")
        f.write(f"\n등장 위치:\n")
        
        for occ in occurrences:
            f.write(f"  - 파일: {occ['file']}, 카테고리: {occ['sheet']}, Index: {occ['index']}\n")
        
        f.write("\n" + "=" * 80 + "\n\n")

print(f"\n[완료] 리포트 생성 완료: {output_file}")

# 카테고리별 통계
print("\n" + "=" * 80)
print("카테고리별 중복 통계")
print("=" * 80)

category_stats = defaultdict(int)
for occurrences in duplicate_groups.values():
    for occ in occurrences:
        category_stats[occ['sheet']] += 1

for category, count in sorted(category_stats.items(), key=lambda x: x[1], reverse=True):
    print(f"{category}: {count}개 중복 문제 포함")

print("\n" + "=" * 80)
print("검사 완료!")
print("=" * 80)
