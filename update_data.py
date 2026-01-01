import json
import os

# 기본 데이터 경로
workspace_dir = os.path.dirname(os.path.abspath(__file__))
external_data_dir = r"c:\Users\taehe\OneDrive\문서\coding\qplayrr\data"

# 게임별 매핑
game_mapping = {
    "olla_questions.json": "올라올라(꼬로록)",
    "oxxo_questions.json": "ox,xo", 
    "garo_questions.json": "가로세로"
}

# 통합 데이터
all_questions = []
total_questions = 0
all_games = set()

# 각 파일 처리
for filename, game_name in game_mapping.items():
    filepath = os.path.join(external_data_dir, filename)
    
    if os.path.exists(filepath):
        print(f"처리 중: {filename}")
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # 게임 데이터 추출
        if "questions" in data:
            for idx, question in enumerate(data["questions"]):
                item = {
                    "question": question.get("question", ""),
                    "answer": question.get("answer", ""),
                    "index": idx + 1,
                    "sheet": game_name
                }
                all_questions.append(item)
                total_questions += 1
        
        all_games.add(game_name)
        print(f"  ✓ {game_name}: {len(data.get('questions', []))} 문제 추가됨")
    else:
        print(f"  ✗ {filename} 파일을 찾을 수 없습니다")

# 통합된 data.json 생성
output_data = {
    "metadata": {
        "source_file": "Multiple JSON files",
        "total_items": total_questions,
        "sheets": sorted(list(all_games)),
        "sheet_count": len(all_games)
    },
    "data": all_questions
}

output_path = os.path.join(workspace_dir, "data.json")
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(output_data, f, ensure_ascii=False, indent=2)

print(f"\n✓ data.json 업데이트 완료")
print(f"  - 총 문제 수: {total_questions}")
print(f"  - 포함된 게임: {', '.join(sorted(all_games))}")
print(f"  - 저장 위치: {output_path}")
