"""
중복 문제 제거 스크립트
각 중복 그룹에서 첫 번째 문제만 남기고 나머지는 삭제
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

print("=" * 80)
print("중복 문제 제거 시작")
print("=" * 80)

# 전체 데이터 수집 및 중복 확인
all_data = {}  # 파일명 -> 데이터 리스트
duplicates = defaultdict(list)  # (question, answer) -> 문제 정보 리스트

# 1단계: 모든 데이터 로드 및 중복 찾기
print("\n[1단계] 데이터 로드 및 중복 검사 중...")
for filename in category_files:
    filepath = os.path.join(categories_dir, filename)
    
    if not os.path.exists(filepath):
        print(f"[경고] 파일을 찾을 수 없습니다: {filename}")
        continue
    
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
        all_data[filename] = data
        problems = data.get('data', [])
        
        for idx, problem in enumerate(problems):
            question = problem.get('question', '').strip()
            answer = problem.get('answer', '').strip()
            
            # 문제와 답을 키로 사용
            key = (question, answer)
            
            # 문제 정보 저장 (파일명, 배열 인덱스 포함)
            duplicates[key].append({
                'file': filename,
                'array_index': idx,
                'index': problem.get('index', 0),
                'sheet': problem.get('sheet', ''),
                'question': question,
                'answer': answer
            })

# 2단계: 중복 문제 필터링 (2개 이상 등장한 문제만)
duplicate_groups = {k: v for k, v in duplicates.items() if len(v) > 1}
print(f"   중복 문제 그룹: {len(duplicate_groups)}개 발견")

# 3단계: 삭제할 인덱스 수집 (각 그룹에서 첫 번째 제외)
to_delete = defaultdict(set)  # 파일명 -> 삭제할 배열 인덱스 set

for (question, answer), occurrences in duplicate_groups.items():
    # 첫 번째는 유지, 나머지는 삭제
    for occ in occurrences[1:]:  # 첫 번째(occurrences[0])는 건너뛰기
        to_delete[occ['file']].add(occ['array_index'])

total_to_delete = sum(len(indices) for indices in to_delete.values())
print(f"   삭제 예정 문제 수: {total_to_delete}개")

# 4단계: 백업 생성
print("\n[2단계] 원본 파일 백업 중...")
backup_dir = os.path.join(categories_dir, 'backup_before_dedup')
os.makedirs(backup_dir, exist_ok=True)

for filename in category_files:
    src = os.path.join(categories_dir, filename)
    dst = os.path.join(backup_dir, filename)
    if os.path.exists(src):
        import shutil
        shutil.copy2(src, dst)
        print(f"   백업 완료: {filename}")

print(f"\n백업 위치: {backup_dir}")

# 5단계: 중복 제거 및 파일 저장
print("\n[3단계] 중복 문제 제거 중...")

total_removed = 0
for filename, data in all_data.items():
    if filename not in to_delete:
        print(f"   {filename}: 중복 없음")
        continue
    
    indices_to_delete = sorted(to_delete[filename], reverse=True)
    original_count = len(data['data'])
    
    # 역순으로 삭제 (인덱스 변경 방지)
    for idx in indices_to_delete:
        del data['data'][idx]
    
    removed_count = len(indices_to_delete)
    total_removed += removed_count
    
    # 메타데이터 업데이트
    if 'metadata' in data:
        data['metadata']['count'] = len(data['data'])
    
    # 파일 저장
    filepath = os.path.join(categories_dir, filename)
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"   {filename}: {original_count}개 -> {len(data['data'])}개 (제거: {removed_count}개)")

# 6단계: 결과 리포트 생성
print("\n[4단계] 결과 리포트 생성 중...")

report_file = r'c:\Users\taehe\OneDrive\문서\GitHub\qplay_search\utils\deduplication_report.txt'
with open(report_file, 'w', encoding='utf-8') as f:
    f.write("=" * 80 + "\n")
    f.write("중복 문제 제거 리포트\n")
    f.write("=" * 80 + "\n\n")
    f.write(f"총 제거된 문제 수: {total_removed}개\n")
    f.write(f"중복 그룹 수: {len(duplicate_groups)}개\n")
    f.write(f"백업 위치: {backup_dir}\n")
    f.write("\n" + "=" * 80 + "\n\n")
    
    f.write("파일별 제거 현황:\n")
    f.write("-" * 80 + "\n")
    for filename, data in all_data.items():
        if filename in to_delete:
            removed = len(to_delete[filename])
            remaining = len(data['data'])
            f.write(f"{filename}:\n")
            f.write(f"  - 제거: {removed}개\n")
            f.write(f"  - 남은 문제: {remaining}개\n\n")
    
    f.write("\n" + "=" * 80 + "\n\n")
    f.write("제거된 중복 문제 목록:\n")
    f.write("(각 그룹에서 첫 번째 문제는 유지됨)\n")
    f.write("=" * 80 + "\n\n")
    
    for idx, ((question, answer), occurrences) in enumerate(sorted(duplicate_groups.items(), key=lambda x: len(x[1]), reverse=True), 1):
        f.write(f"[중복 그룹 #{idx}] - {len(occurrences)}회 중복 ({len(occurrences)-1}개 제거)\n")
        f.write("-" * 80 + "\n")
        f.write(f"문제: {question}\n")
        f.write(f"답: {answer}\n\n")
        f.write(f"[유지] {occurrences[0]['file']}, Index: {occurrences[0]['index']}\n")
        f.write(f"\n[제거된 항목들]\n")
        for occ in occurrences[1:]:
            f.write(f"  - {occ['file']}, Index: {occ['index']}\n")
        f.write("\n" + "=" * 80 + "\n\n")

print(f"\n[완료] 리포트 생성 완료: {report_file}")

# 최종 통계
print("\n" + "=" * 80)
print("중복 제거 완료!")
print("=" * 80)
print(f"총 제거된 문제 수: {total_removed}개")
print(f"백업 위치: {backup_dir}")
print(f"상세 리포트: {report_file}")
print("=" * 80)
