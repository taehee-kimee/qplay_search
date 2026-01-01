#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
꽁꽁 문제 데이터 파일을 categories/kkong.json으로 병합하는 스크립트
"""
import json
from pathlib import Path

# 꽁꽁 데이터 로드 (이미 생성된 샘플에서 시작)
WORKSPACE = Path('.')

# 꽁꽁 문제 데이터 (형식: { "question": "...", "answer": "..." })
kkong_questions = [
    # 여기에 꽁꽁 문제를 추가하세요
    # 예시:
    # {
    #     "question": "한국의 수도는?",
    #     "answer": "서울"
    # },
]

def update_kkong_data():
    """꽁꽁 카테고리 데이터를 업데이트합니다"""
    CATEGORIES_DIR = WORKSPACE / 'categories'
    KKONG_FILE = CATEGORIES_DIR / 'kkong.json'
    METADATA_FILE = WORKSPACE / 'metadata.json'
    
    if kkong_questions:
        # sheet 필드 추가
        for item in kkong_questions:
            if 'sheet' not in item:
                item['sheet'] = '꽁꽁'
        
        # kkong.json 저장
        cat_data = {
            'metadata': {
                'category_id': 'kkong',
                'category_name': '꽁꽁',
                'count': len(kkong_questions),
                'source': 'added'
            },
            'data': kkong_questions
        }
        
        with open(KKONG_FILE, 'w', encoding='utf-8') as f:
            json.dump(cat_data, f, ensure_ascii=False, indent=2)
        
        # metadata.json 업데이트
        with open(METADATA_FILE, 'r', encoding='utf-8') as f:
            metadata = json.load(f)
        
        for cat in metadata['categories']:
            if cat['id'] == 'kkong':
                cat['count'] = len(kkong_questions)
                break
        
        with open(METADATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)
        
        print(f"✅ 꽁꽁 데이터 업데이트: {len(kkong_questions):,}개")
    else:
        print("ℹ️ 꽁꽁 문제가 없습니다. kkong_questions 리스트에 데이터를 추가하세요.")

if __name__ == '__main__':
    update_kkong_data()
