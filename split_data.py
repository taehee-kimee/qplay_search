#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
data.json을 카테고리별로 분리하는 스크립트
"""
import json
import os
from pathlib import Path

# 워크스페이스 경로
WORKSPACE = Path('.')
DATA_FILE = WORKSPACE / 'data.json'
CATEGORIES_DIR = WORKSPACE / 'categories'

# 파일 내용 로드
print("📂 data.json 로드 중...")
with open(DATA_FILE, 'r', encoding='utf-8') as f:
    data = json.load(f)

# 카테고리별로 데이터 분리
print("\n📊 카테고리별 데이터 분리 중...")
categories_data = {}
for item in data['data']:
    sheet_name = item['sheet']
    if sheet_name not in categories_data:
        categories_data[sheet_name] = []
    categories_data[sheet_name].append(item)

# 카테고리 디렉토리 생성
CATEGORIES_DIR.mkdir(exist_ok=True)
print(f"📁 {CATEGORIES_DIR} 디렉토리 생성됨")

# 카테고리 ID 매핑
category_mapping = {
    'ox,xo': 'ox_xo',
    '가로세로': 'garoseseo',
    '올라올라(꼬로록)': 'ollaolla',
    '꽁꽁': 'kkong'
}

# 각 카테고리별 JSON 파일 생성
print("\n💾 카테고리별 JSON 파일 생성 중...")
category_list = []

for sheet_name, items in sorted(categories_data.items()):
    cat_id = category_mapping.get(sheet_name, sheet_name.lower().replace(' ', '_'))
    cat_file = CATEGORIES_DIR / f'{cat_id}.json'
    
    # 카테고리 데이터 저장
    cat_data = {
        'metadata': {
            'category_id': cat_id,
            'category_name': sheet_name,
            'count': len(items),
            'source': 'data.json'
        },
        'data': items
    }
    
    with open(cat_file, 'w', encoding='utf-8') as f:
        json.dump(cat_data, f, ensure_ascii=False, indent=2)
    
    print(f"✅ {cat_file.name}: {len(items):,}개 문제")
    
    # 메타데이터 목록에 추가
    category_list.append({
        'id': cat_id,
        'name': sheet_name,
        'count': len(items),
        'file': f'categories/{cat_id}.json'
    })

# metadata.json 생성
metadata = {
    'version': '2.0',
    'type': 'category_split',
    'total_items': len(data['data']),
    'categories': category_list,
    'generated_at': '2026-01-01'
}

metadata_file = WORKSPACE / 'metadata.json'
with open(metadata_file, 'w', encoding='utf-8') as f:
    json.dump(metadata, f, ensure_ascii=False, indent=2)

print(f"\n✅ metadata.json 생성 완료")
print(f"\n📊 최종 통계:")
print(f"- 총 문제 수: {metadata['total_items']:,}")
print(f"- 카테고리 수: {len(category_list)}")
print(f"- 저장 위치: {CATEGORIES_DIR}/")

print(f"\n🎉 분리 완료!")
