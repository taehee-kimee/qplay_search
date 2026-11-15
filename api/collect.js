// 모든 사용자가 모은 문제를 한곳에 모으는 API (Vercel 함수 + Supabase)
//
// POST /api/collect  { client, items: [{ sheet, question, answer, note }] }
//   웹 수집기가 정답 화면으로 확정한 문제를 보낸다. retract: true 면 예전에 보낸 문제를 취소한다. 제출 1건 = submissions 표의 1줄.
// GET  /api/collect?key=...&cursor=...
//   족보 병합 루틴(관리자)만 읽는다. key는 관리자 PC에만 있고, 여기에는 해시만 둔다.
// DELETE /api/collect?key=...&before=2026-11-15T12:00:00Z   관리자: 그 시각 전에 올라온 제출 지우기
// GET  /api/collect?recent=1   누구나: 최근 3일 수집된 정답(질문·답만). 검색 화면이 밤 병합 전에도 바로 쓴다
// GET  /api/collect?item=submissions/...
//   목록이 알려준 주소로 제출 1건을 읽는다 (이름 끝의 무작위 글자를 알아야 읽힘)
//
// 병합 루틴(qsearch_exe/scripts/merge_collected.py)이 예전 Vercel Blob 때와 같은 모양(blobs/pathname/url/cursor/hasMore)으로
// 읽으므로 응답 모양은 그대로 둔다.
//
// 필요 설정 (Vercel 환경변수): SUPABASE_URL, SUPABASE_SECRET_KEY (예전 이름 SUPABASE_SERVICE_ROLE_KEY도 됨)
// 표 만들기: supabase/schema.sql 을 Supabase SQL Editor에서 한 번 실행
import crypto from 'node:crypto';

const ADMIN_KEY_SHA256 = '9589b6af72b43970e160a4a5483b7099e3908fa6fe282647ea898a7e6e240233';
const SHEETS = new Set(['가로세로', '꽁꽁', '올라올라(꼬로록)', 'ox,xo']);
const ALLOWED_ORIGINS = [
    'https://qplay-search.vercel.app',
    'https://taehee-kimee.github.io',
    'http://127.0.0.1:8765',
    'http://localhost:8765'
];
const MAX_ITEMS = 20;
const PAGE = 1000;
const ITEM_RE = /^submissions\/\d{4}-\d{2}-\d{2}\/\d{13}-[0-9a-f]{24}\.json$/;

function clean(value, max) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// 화면 인식이 엉뚱한 화면(대기실·방 목록)을 문제로 읽은 것
const LOBBY = /엠블럼|닉\s*네\s*임|사이버머니|블[랙택]\s*리스트|큐플\s*[버비H]|입은옷보기|[게계]?[임인]\s*[래레러]』?벨/;
const OX_ANSWER = { '0': 'O', o: 'O', O: 'O', 'ㅇ': 'O', '×': 'X', x: 'X', X: 'X' };
const compact = s => String(s).replace(/[^0-9A-Za-z가-힣]/g, '');

// 받을 때 거른다: 대기실 화면, OX 안내 꼬리, O/X가 아닌 OX 답, 보기에 없는 답, 깨진 글자가 든 답
// (2026-11-15: 걸러지지 않은 제출에 '국경일이 아닌 것은? → 반복 재생산' 같은 엉뚱한 답이 많았음)
export function validateItems(items) {
    if (!Array.isArray(items)) return [];
    const out = [];
    for (const raw of items.slice(0, MAX_ITEMS)) {
        if (!raw || typeof raw !== 'object') continue;
        const sheet = clean(raw.sheet, 30);
        let question = clean(raw.question, 300);
        let answer = clean(raw.answer, 80);
        const note = clean(raw.note, 80);
        if (!SHEETS.has(sheet) || !answer || LOBBY.test(question)) continue;
        if (sheet === 'ox,xo') {
            question = question.replace(/\s*맞으면.*$/, '').replace(/[\s.]+$/, '');
            if (question && !question.endsWith('?')) question += '?';
            answer = OX_ANSWER[answer] || '';
            if (!answer) continue;
        }
        // 가려진 문제는 답이 보기 가운데 있어야 한다
        if (question.startsWith('(가려진 문제)')) {
            const choices = question.replace(/^.*?보기:\s*/, '').split('/').map(compact);
            if (!choices.includes(compact(answer))) continue;
        }
        if ((question.match(/[가-힣A-Za-z]/g) || []).length < 4) continue;
        if (/[「」『』«»|\{}※]/.test(answer)) continue;
        out.push({ sheet, question, answer, note });
    }
    return out;
}

export function isAdminKey(key) {
    if (!key) return false;
    return crypto.createHash('sha256').update(String(key)).digest('hex') === ADMIN_KEY_SHA256;
}

export function setCors(req, res) {
    const origin = req.headers.origin;
    if (origin && (ALLOWED_ORIGINS.includes(origin) || /^https:\/\/qplay-search[-a-z0-9]*\.vercel\.app$/.test(origin))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readBody(req, limit = 64 * 1024) {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) throw new Error('too large');
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

// 최근 수집된 정답 (밤 병합 전이라 아직 족보에 없는 문제): 보낸 사람별 '보냄/취소'를 순서대로 반영해 남은 것만
const RECENT_DAYS = 3;
async function recentAnswers(db) {
    const since = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString();
    const live = new Map(); // sheet|질문|답 → { item, sources:Set }
    let after = 0;
    for (let page = 0; page < 10; page++) {
        const rows = await db(`submissions?select=id,record&uploaded_at=gt.${encodeURIComponent(since)}&id=gt.${after}&order=id.asc&limit=${PAGE}`) || [];
        for (const { id, record } of rows) {
            after = id;
            const source = String(record?.source || 'unknown');
            for (const it of validateItems(record?.items)) {
                const k = `${it.sheet}|${compact(it.question)}|${compact(it.answer)}`;
                if (record.retract === true) {
                    const e = live.get(k);
                    if (e) { e.sources.delete(source); if (!e.sources.size) live.delete(k); }
                } else {
                    const e = live.get(k) || { item: { sheet: it.sheet, question: it.question, answer: it.answer }, sources: new Set() };
                    e.sources.add(source);
                    live.set(k, e);
                }
            }
        }
        if (rows.length < PAGE) break;
    }
    return [...live.values()].map(e => ({ ...e.item, n: e.sources.size }));
}

// Supabase REST(PostgREST)를 fetch로 직접 부른다 (SDK 없이). 설정이 없으면 null
export function supabase() {
    // 환경변수에 주소가 두 번 붙어 들어간 적이 있어(…supabase.cohttps://…) 첫 주소만 쓴다
    const raw = String(process.env.SUPABASE_URL || '').trim();
    const base = (raw.match(/https:\/\/[a-z0-9-]+\.supabase\.co/i) || [raw.replace(/\/+$/, '')])[0];
    const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !key) return null;
    return async (path, init = {}) => {
        const r = await fetch(`${base}/rest/v1/${path}`, {
            ...init,
            headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
            signal: AbortSignal.timeout(15000)
        });
        if (!r.ok) throw new Error(`supabase ${r.status} ${(await r.text()).slice(0, 200)}`);
        const text = await r.text();
        return text ? JSON.parse(text) : null;
    };
}

async function handle(req, res, db) {
    // 병합 루틴 상태(merge_state): PC 루틴과 클라우드('바로 반영하기')가 같은 상태를 쓰도록 여기 둔다.
    // 공개하면 안 되는 내용(보낸 사람 식별값)이 있어 관리자 키로만 읽고 쓴다.
    if (req.query?.state !== undefined) {
        if (!isAdminKey(req.query?.key)) return res.status(401).json({ ok: false, error: 'unauthorized' });
        if (req.method === 'GET') {
            const rows = await db('merge_state?select=state,updated_at&id=eq.1');
            if (!rows || !rows.length) return res.status(200).json({ ok: true, state: null });
            return res.status(200).json({ ok: true, state: rows[0].state, uploadedAt: rows[0].updated_at });
        }
        if (req.method === 'PUT') {
            let body;
            try {
                body = await readBody(req, 8 * 1024 * 1024);
            } catch (e) {
                return res.status(400).json({ ok: false, error: 'bad-body' });
            }
            if (!body || typeof body.state !== 'object' || body.state === null) return res.status(400).json({ ok: false, error: 'no-state' });
            await db('merge_state?on_conflict=id', {
                method: 'POST',
                headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
                body: JSON.stringify({ id: 1, state: body.state, updated_at: new Date().toISOString() })
            });
            return res.status(200).json({ ok: true });
        }
        return res.status(405).json({ ok: false, error: 'method-not-allowed' });
    }

    if (req.method === 'POST') {
        let body;
        try {
            body = await readBody(req);
        } catch (e) {
            return res.status(400).json({ ok: false, error: 'bad-body' });
        }
        const items = validateItems(body.items);
        if (!items.length) return res.status(400).json({ ok: false, error: 'no-valid-items' });

        const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
        const record = {
            at: new Date().toISOString(),
            client: clean(body.client, 40),
            source: crypto.createHash('sha256').update(`qplay:${ip}`).digest('hex').slice(0, 16),
            items
        };
        // retract: 사용자가 '모은 문제'에서 지운 문제 → 병합 루틴이 같은 보낸 사람의 제출을 취소한다
        if (body.retract === true) record.retract = true;
        // 이름 = 날짜/밀리초-무작위. 병합 루틴이 이 이름 순서(=보낸 순서)로 처리하고, 처리한 이름을 기억한다.
        const pathname = `submissions/${record.at.slice(0, 10)}/${Date.now()}-${crypto.randomBytes(12).toString('hex')}.json`;
        await db('submissions', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ pathname, uploaded_at: record.at, record })
        });
        return res.status(200).json({ ok: true, count: items.length });
    }

    // 관리자 정리: 주어진 시각보다 먼저 올라온 제출을 지운다 (정리본을 다시 올린 뒤 예전 것을 비울 때)
    if (req.method === 'DELETE') {
        if (!isAdminKey(req.query?.key)) return res.status(401).json({ ok: false, error: 'unauthorized' });
        const before = String(req.query?.before || '');
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(before)) return res.status(400).json({ ok: false, error: 'bad-before' });
        const rows = await db(`submissions?uploaded_at=lt.${encodeURIComponent(before)}&select=id`, {
            method: 'DELETE',
            headers: { Prefer: 'return=representation' }
        });
        return res.status(200).json({ ok: true, deleted: (rows || []).length });
    }

    if (req.method === 'GET') {
        // 누구나: 최근 수집된 정답 → 검색 화면이 족보에 섞어서 보여준다 (질문·답만, 보낸 사람 정보 없음)
        if (req.query?.recent !== undefined) {
            const items = await recentAnswers(db);
            res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
            return res.status(200).json({ ok: true, days: RECENT_DAYS, items });
        }
        // 제출 1건 읽기 (목록의 url이 가리키는 곳)
        if (req.query?.item !== undefined) {
            const item = String(req.query.item);
            if (!ITEM_RE.test(item)) return res.status(404).json({ ok: false, error: 'not-found' });
            const rows = await db(`submissions?select=record&pathname=eq.${encodeURIComponent(item)}&limit=1`);
            if (!rows || !rows.length) return res.status(404).json({ ok: false, error: 'not-found' });
            return res.status(200).json(rows[0].record);
        }
        if (!isAdminKey(req.query?.key)) return res.status(401).json({ ok: false, error: 'unauthorized' });
        const after = /^\d{1,15}$/.test(String(req.query?.cursor || '')) ? String(req.query.cursor) : '0';
        const rows = await db(`submissions?select=id,pathname,uploaded_at&id=gt.${after}&order=id.asc&limit=${PAGE}`) || [];
        const origin = `https://${req.headers.host || 'qplay-search.vercel.app'}`;
        const hasMore = rows.length === PAGE;
        return res.status(200).json({
            ok: true,
            blobs: rows.map(b => ({
                pathname: b.pathname,
                url: `${origin}/api/collect?item=${encodeURIComponent(b.pathname)}`,
                uploadedAt: b.uploaded_at
            })),
            cursor: hasMore ? String(rows[rows.length - 1].id) : null,
            hasMore
        });
    }

    return res.status(405).json({ ok: false, error: 'method-not-allowed' });
}

export default async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    const db = supabase();
    if (!db) return res.status(503).json({ ok: false, error: 'storage-not-configured' });
    try {
        return await handle(req, res, db);
    } catch (e) {
        // 원인(cause)까지 남긴다: 주소 오타면 'fetch failed'만으로는 알 수 없다 (ENOTFOUND 등)
        console.error('collect failed:', e && e.message, e && e.cause ? `(${e.cause.code || ''} ${e.cause.message || ''})` : '');
        return res.status(502).json({ ok: false, error: 'storage-failed' });
    }
}
