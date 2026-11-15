// 모든 사용자가 모은 문제를 한곳에 모으는 API (Vercel 함수 + Supabase)
//
// POST /api/collect  { client, items: [{ sheet, question, answer, note }] }
//   웹 수집기가 정답 화면으로 확정한 문제를 보낸다. retract: true 면 예전에 보낸 문제를 취소한다. 제출 1건 = submissions 표의 1줄.
// GET  /api/collect?key=...&cursor=...
//   족보 병합 루틴(관리자)만 읽는다. key는 관리자 PC에만 있고, 여기에는 해시만 둔다.
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

export function validateItems(items) {
    if (!Array.isArray(items)) return [];
    const out = [];
    for (const raw of items.slice(0, MAX_ITEMS)) {
        if (!raw || typeof raw !== 'object') continue;
        const sheet = clean(raw.sheet, 30);
        const question = clean(raw.question, 300);
        const answer = clean(raw.answer, 80);
        const note = clean(raw.note, 80);
        if (!SHEETS.has(sheet) || question.length < 4 || !answer) continue;
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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
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

// Supabase REST(PostgREST)를 fetch로 직접 부른다 (SDK 없이). 설정이 없으면 null
function supabase() {
    const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
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

    if (req.method === 'GET') {
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
        console.error('collect failed:', e && e.message);
        return res.status(502).json({ ok: false, error: 'storage-failed' });
    }
}
