// '족보에 바로 반영하기' 버튼 → GitHub Actions의 병합 루틴(qsearch_exe/.github/workflows/merge-now.yml)을 바로 실행
//
// POST /api/merge-now  { key }   관리자 키가 맞을 때만 실행
// GET  /api/merge-now?key=...    최근 실행 상태 (진행 중 / 성공 / 실패)
//
// 필요 설정: Vercel 환경변수 GITHUB_DISPATCH_TOKEN (qsearch_exe의 Actions 쓰기 권한이 있는 GitHub 토큰)
import { isAdminKey, setCors } from './collect.js';

const REPO = 'taehee-kimee/qsearch_exe';
const WORKFLOW = 'merge-now.yml';

function gh(path, init = {}) {
    return fetch(`https://api.github.com/repos/${REPO}${path}`, {
        ...init,
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${process.env.GITHUB_DISPATCH_TOKEN}`,
            'User-Agent': 'qplay-merge-now',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(init.headers || {})
        }
    });
}

export default async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(204).end();

    let key = req.query?.key;
    if (req.method === 'POST') {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        key = body.key;
    }
    if (!isAdminKey(key)) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (!process.env.GITHUB_DISPATCH_TOKEN) return res.status(503).json({ ok: false, error: 'token-not-configured' });

    if (req.method === 'POST') {
        const r = await gh(`/actions/workflows/${WORKFLOW}/dispatches`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ref: 'main' })
        });
        if (r.status !== 204) {
            const text = await r.text();
            return res.status(502).json({ ok: false, error: `github-${r.status}`, detail: text.slice(0, 200) });
        }
        return res.status(200).json({ ok: true, startedAt: new Date().toISOString() });
    }

    if (req.method === 'GET') {
        const r = await gh(`/actions/workflows/${WORKFLOW}/runs?per_page=1`);
        if (!r.ok) return res.status(502).json({ ok: false, error: `github-${r.status}` });
        const run = (await r.json()).workflow_runs?.[0];
        return res.status(200).json({
            ok: true,
            run: run ? { status: run.status, conclusion: run.conclusion, createdAt: run.created_at, url: run.html_url } : null
        });
    }

    return res.status(405).json({ ok: false, error: 'method-not-allowed' });
}
