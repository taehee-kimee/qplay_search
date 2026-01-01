#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
꽁꽁 데이터를 categories에 추가하는 스크립트
첨부파일이나 외부 JSON 파일을 추가할 때 사용합니다.
"""
import json
from pathlib import Path

def add_kkong_category(kkong_data_path=None):
    """
    꽁꽁 카테고리를 추가합니다.
    
    Args:
        kkong_data_path: 꽁꽁 데이터 파일 경로 (list of dicts 형식)
    """
    WORKSPACE = Path('.')
    METADATA_FILE = WORKSPACE / 'metadata.json'
    CATEGORIES_DIR = WORKSPACE / 'categories'
    
    # metadata.json 로드
    with open(METADATA_FILE, 'r', encoding='utf-8') as f:
        metadata = json.load(f)
    
    # 꽁꽁 카테고리 정보
    kkong_category = {
        'id': 'kkong',
        'name': '꽁꽁',
        'count': 0,  # 나중에 업데이트
        'file': 'categories/kkong.json'
    }
    
    # 샘플 데이터 생성 (데이터 파일이 없을 경우)
    if kkong_data_path is None:
        kkong_data = [
            {
                "question": "꽁꽁 문제를 여기에 추가하세요",
                "answer": "답변",
                "sheet": "꽁꽁"
            }
        ]
        print("⚠️ 꽁꽁 데이터 파일이 없어 샘플 데이터로 생성했습니다.")
        print("📝 kkong.json 파일을 수정하여 실제 데이터를 추가하세요.")
    else:
        # 외부 파일에서 로드
        with open(kkong_data_path, 'r', encoding='utf-8') as f:
            file_data = json.load(f)
            # data 필드가 있으면 사용, 아니면 전체 배열로 간주
            kkong_data = file_data.get('data') if isinstance(file_data, dict) else file_data
        print(f"✅ {kkong_data_path}에서 {len(kkong_data):,}개의 꽁꽁 문제를 로드했습니다.")
    
    # sheet 필드 확인 및 추가
    for item in kkong_data:
        if 'sheet' not in item:
            item['sheet'] = '꽁꽁'
    
    # 꽁꽁 카테고리 데이터 저장
    kkong_file = CATEGORIES_DIR / 'kkong.json'
    cat_data = {
        'metadata': {
            'category_id': 'kkong',
            'category_name': '꽁꽁',
            'count': len(kkong_data),
            'source': 'added'
        },
        'data': kkong_data
    }
    
    with open(kkong_file, 'w', encoding='utf-8') as f:
        json.dump(cat_data, f, ensure_ascii=False, indent=2)
    
    print(f"💾 kkong.json 저장: {len(kkong_data):,}개 문제")
    
    # metadata.json에 꽁꽁 추가 (중복 확인)
    existing_kkong = any(cat['id'] == 'kkong' for cat in metadata['categories'])
    if existing_kkong:
        # 기존 꽁꽁 업데이트
        for cat in metadata['categories']:
            if cat['id'] == 'kkong':
                cat['count'] = len(kkong_data)
                break
        print("🔄 기존 꽁꽁 카테고리를 업데이트했습니다.")
    else:
        # 새 꽁꽁 추가
        kkong_category['count'] = len(kkong_data)
        metadata['categories'].append(kkong_category)
        metadata['total_items'] += len(kkong_data)
        print("✅ 꽁꽁 카테고리를 metadata에 추가했습니다.")
    
    # metadata.json 저장
    with open(METADATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
    
    print(f"\n🎉 완료!")
    print(f"- 총 문제: {metadata['total_items']:,}개")
    print(f"- 카테고리: {len(metadata['categories'])}개")
    print(f"- 카테고리 목록: {', '.join(cat['name'] for cat in metadata['categories'])}")

if __name__ == '__main__':
    import sys
    
    if len(sys.argv) > 1:
        # 인자가 있으면 해당 파일 사용
        add_kkong_category(sys.argv[1])
    else:
        # 인자가 없으면 샘플 데이터로 생성
        add_kkong_category()
