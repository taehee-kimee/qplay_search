// 모든 사용자가 모은 문제를 한곳에 모으는 API (Vercel 함수 + Vercel Blob)
//
// POST /api/collect  { client, items: [{ sheet, question, answer, note }] }
//   웹 수집기가 정답 화면으로 확정한 문제를 보낸다. retract: true 면 예전에 보낸 문제를 취소한다. 제출 1건 = Blob 파일 1개 (덮어쓰기 경쟁 없음).
// GET  /api/collect?key=...&cursor=...
//   족보 병합 루틴(관리자)만 읽는다. key는 관리자 PC에만 있고, 여기에는 해시만 둔다.
//
// 필요 설정: Vercel 대시보드에서 Blob 스토어를 만들어 이 프로젝트에 연결 (BLOB_STORE_ID 자동 생성, 인증은 OIDC)
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

export function createHandler(getBlob) {
    return async function handler(req, res) {
        setCors(req, res);
        if (req.method === 'OPTIONS') return res.status(204).end();

        // 새 Vercel Blob은 BLOB_STORE_ID + 자동 로그인(OIDC), 예전 방식은 BLOB_READ_WRITE_TOKEN
        if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) {
            return res.status(503).json({ ok: false, error: 'storage-not-configured' });
        }
        const blob = await getBlob();

        // 병합 루틴 상태(merge_state.json): PC 루틴과 클라우드('바로 반영하기')가 같은 상태를 쓰도록 여기 둔다.
        // 공개 저장소에 두면 안 되는 내용(보낸 사람 식별값)이 있어 관리자 키로만 읽고 쓴다.
        if (req.query?.state !== undefined) {
            if (!isAdminKey(req.query?.key)) return res.status(401).json({ ok: false, error: 'unauthorized' });
            const page = await blob.list({ prefix: 'state/merge_state' });
            const latest = page.blobs.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)))[0];
            if (req.method === 'GET') {
                if (!latest) return res.status(200).json({ ok: true, state: null });
                const r = await fetch(`${latest.url}?t=${Date.now()}`, { cache: 'no-store' });
                return res.status(200).json({ ok: true, state: await r.json(), uploadedAt: latest.uploadedAt });
            }
            if (req.method === 'PUT') {
                let body;
                try {
                    body = await readBody(req, 8 * 1024 * 1024);
                } catch (e) {
                    return res.status(400).json({ ok: false, error: 'bad-body' });
                }
                if (!body || typeof body.state !== 'object') return res.status(400).json({ ok: false, error: 'no-state' });
                await blob.put('state/merge_state.json', JSON.stringify(body.state), {
                    access: 'public', addRandomSuffix: true, contentType: 'application/json'
                });
                if (page.blobs.length) await blob.del(page.blobs.map(b => b.url));
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
            const day = record.at.slice(0, 10);
            await blob.put(`submissions/${day}/${Date.now()}.json`, JSON.stringify(record), {
                access: 'public',
                addRandomSuffix: true,
                contentType: 'application/json'
            });
            return res.status(200).json({ ok: true, count: items.length });
        }

        // 임시(관리자): 공개 주소가 막혔을 때 서버 안에서 제출 내용을 읽어 돌려준다
        if (req.method === 'GET' && req.query?.dump !== undefined) {
            if (!isAdminKey(req.query?.key)) return res.status(401).json({ ok: false, error: 'unauthorized' });
            const page = await blob.list({ prefix: 'submissions/', cursor: req.query?.cursor || undefined, limit: 100 });
            const records = [];
            for (const b of page.blobs) {
                try {
                    let text;
                    if (typeof blob.get === 'function') {
                        const r = await blob.get(b.url, { access: 'public' });
                        text = r && r.stream ? await new Response(r.stream).text() : null;
                    }
                    if (text == null) {
                        const r = await fetch(b.url, { cache: 'no-store' });
                        text = r.ok ? await r.text() : null;
                        if (!r.ok) throw new Error(`fetch ${r.status}`);
                    }
                    records.push({ pathname: b.pathname, rec: JSON.parse(text) });
                } catch (e) {
                    records.push({ pathname: b.pathname, error: String(e && e.message || e).slice(0, 200) });
                }
            }
            return res.status(200).json({ ok: true, records, cursor: page.cursor || null, hasMore: !!page.hasMore });
        }

        if (req.method === 'GET') {
            if (!isAdminKey(req.query?.key)) return res.status(401).json({ ok: false, error: 'unauthorized' });
            const page = await blob.list({ prefix: 'submissions/', cursor: req.query?.cursor || undefined, limit: 1000 });
            return res.status(200).json({
                ok: true,
                blobs: page.blobs.map(b => ({ pathname: b.pathname, url: b.url, uploadedAt: b.uploadedAt })),
                cursor: page.cursor || null,
                hasMore: !!page.hasMore
            });
        }

        return res.status(405).json({ ok: false, error: 'method-not-allowed' });
    };
}

export default createHandler(() => import('@vercel/blob'));
