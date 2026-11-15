-- 수집 문제 저장소 (api/collect.js). Supabase 대시보드 → SQL Editor에 붙여 넣고 한 번 실행한다.

-- 사용자들이 보낸 수집 제출 (제출 1건 = 1줄). pathname은 병합 루틴이 '이미 처리한 제출'을 기억하는 이름.
create table if not exists public.submissions (
    id          bigint generated always as identity primary key,
    pathname    text        not null unique,
    uploaded_at timestamptz not null default now(),
    record      jsonb       not null
);

-- 병합 루틴 상태 (항상 1줄)
create table if not exists public.merge_state (
    id         smallint    primary key default 1 check (id = 1),
    state      jsonb       not null,
    updated_at timestamptz not null default now()
);

-- AI 답 공유 저장소 (api/ask.js): 같은 문제를 누가 다시 물어도 AI를 다시 부르지 않게
create table if not exists public.ai_answers (
    hash       text        primary key,
    sheet      text        not null,
    question   text        not null,
    result     jsonb       not null,
    created_at timestamptz not null default now()
);
alter table public.ai_answers enable row level security;

-- 정책 없이 RLS만 켠다 → 공개 키로는 못 읽고 못 쓰고, 서버가 쓰는 비밀 키만 접근한다.
alter table public.submissions enable row level security;
alter table public.merge_state enable row level security;
