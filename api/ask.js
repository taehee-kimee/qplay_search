// 족보에 없는 문제를 AI에게 물어보는 API (Vercel 함수)
//
// POST /api/ask  { sheet, question, choices: { "1": "...", "2": "..." } }
//   - 보기가 있는 문제(OX, 객관식) → TypeSafe Jev (Choice 질문, ~0.2초, 확신 점수 포함)
//   - 보기가 없는 주관식(가로세로, 꽁꽁 등) → Claude Haiku 5.5
//   응답: { ok, answer, choice?, confidence?, model }
//
// 필요 설정 (Vercel 환경변수): TYPESAFE_API_KEY, ANTHROPIC_API_KEY
// 남용 방지: IP당 1분 20회 (인스턴스 메모리 기준이라 대략적), 같은 문제는 캐시해서 다시 부르지 않음.
// 진짜 상한은 TypeSafe/Anthropic 콘솔의 월 사용 한도로 건다.
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { setCors } from './collect.js';

const SHEETS = new Set(['가로세로', '꽁꽁', '올라올라(꼬로록)', 'ox,xo']);
const RATE_LIMIT = 20;            // IP당 1분
const RATE_WINDOW_MS = 60 * 1000;
const CACHE_MAX = 2000;
const hits = new Map();           // ip → [timestamps]
const cache = new Map();          // hash → response

function clean(value, max) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function rateLimited(ip) {
    const now = Date.now();
    const list = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
    if (list.length >= RATE_LIMIT) {
        hits.set(ip, list);
        return true;
    }
    list.push(now);
    hits.set(ip, list);
    if (hits.size > 5000) hits.clear();
    return false;
}

// OX 문제 끝의 안내 꼬리 ("맞으면 0, 틀리면 X. 3초내에 결정하세요!!") 제거
function stripOxTail(q) {
    return q.replace(/맞으면\s*[0Oo]\s*[,.]?\s*틀리면\s*[Xx×].*$/, '').trim();
}

async function askJev(question, criteria) {
    const r = await fetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'jev-latest',
            state: question,
            questions: { answer: { type: 'choice', instructions: '이 한국어 퀴즈 문제의 정답', criteria } }
        }),
        signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error(`jev ${r.status}`);
    const data = await r.json();
    const ans = data?.answers?.answer;
    if (!ans || !ans.choice) throw new Error('jev-no-answer');
    return { choice: ans.choice, confidence: typeof ans.confidence === 'number' ? ans.confidence : null };
}

let anthropic = null;
async function askClaude(sheet, question, choices = null, isOx = false) {
    if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 10000, maxRetries: 1 });
    const hint = sheet === '가로세로'
        ? ' 뜻풀이에 맞는 낱말을 답하라. "OO"처럼 동그라미가 있으면 그 글자 수에 맞춰라.'
        : '';
    let content = `문제: ${question}`;
    let rule = '정답 낱말이나 짧은 구절 하나만 출력하고 설명은 하지 마라.';
    if (isOx) {
        content += '\n진술이 맞으면 O, 틀리면 X.';
        rule = 'O 또는 X 한 글자만 출력하라.';
    } else if (choices) {
        content += '\n보기:\n' + Object.entries(choices).map(([k, v]) => `${k}. ${v}`).join('\n');
        rule = '정답 보기의 번호 하나만 출력하라.';
    }
    const response = await anthropic.messages.create({
        model: 'claude-haiku-5-5',
        max_tokens: 64,
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' },
        system: `너는 한국어 퀴즈 정답을 맞히는 도우미다. ${rule}${hint} 모르면 가장 그럴듯한 답을 하나 내라.`,
        messages: [{ role: 'user', content }]
    });
    if (response.stop_reason === 'refusal') throw new Error('claude-refusal');
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const answer = clean(text.split('\n')[0].replace(/^(정답|답)\s*[:：]\s*/, '').replace(/[.。]$/, ''), 60);
    if (!answer) throw new Error('claude-empty');
    return answer;
}

async function readBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 16 * 1024) throw new Error('too large');
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export default async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method-not-allowed' });

    let body;
    try {
        body = await readBody(req);
    } catch (e) {
        return res.status(400).json({ ok: false, error: 'bad-body' });
    }
    const sheet = clean(body.sheet, 30);
    let question = clean(body.question, 300);
    const choices = {};
    if (body.choices && typeof body.choices === 'object') {
        for (const [k, v] of Object.entries(body.choices).slice(0, 6)) {
            const key = clean(String(k), 2);
            const value = clean(v, 60);
            if (/^[1-6]$/.test(key) && value) choices[key] = value;
        }
    }
    if (!SHEETS.has(sheet)) return res.status(400).json({ ok: false, error: 'bad-sheet' });
    if (sheet === 'ox,xo') question = stripOxTail(question);
    if (question.replace(/\s/g, '').length < 4) return res.status(400).json({ ok: false, error: 'too-short' });

    const isOx = sheet === 'ox,xo';
    const hasChoices = Object.keys(choices).length >= 2;
    // second: 'claude' → Jev가 확신 못 한 문제를 Claude에게 다시 묻는다 (화면이 Jev 답을 먼저 보여준 뒤 부름)
    const forceClaude = body.second === 'claude';
    const hash = crypto.createHash('sha256').update(JSON.stringify([sheet, question, isOx ? null : choices, forceClaude])).digest('hex');
    if (cache.has(hash)) return res.status(200).json({ ...cache.get(hash), cached: true });

    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (rateLimited(ip)) return res.status(429).json({ ok: false, error: 'rate-limited' });

    try {
        let result;
        if (forceClaude) {
            if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ ok: false, error: 'claude-not-configured' });
            const text = await askClaude(sheet, question, hasChoices ? choices : null, isOx);
            let answer = text;
            let choice = null;
            if (isOx) {
                choice = /^[OoㅇＯ0]/.test(text) ? 'O' : /^[XxＸ×]/.test(text) ? 'X' : null;
                answer = choice || text;
            } else if (hasChoices) {
                const m = text.match(/[1-6]/);
                choice = m && choices[m[0]] ? m[0] : null;
                answer = choice ? `${choice}. ${choices[choice]}` : text;
            }
            result = { ok: true, model: 'claude', choice, answer, confidence: null };
        } else if (isOx || hasChoices) {
            if (!process.env.TYPESAFE_API_KEY) return res.status(503).json({ ok: false, error: 'jev-not-configured' });
            const criteria = isOx
                ? { O: '문제의 진술이 사실이다(맞다)', X: '문제의 진술이 사실이 아니다(틀리다)' }
                : choices;
            const { choice, confidence } = await askJev(question, criteria);
            result = {
                ok: true,
                model: 'jev',
                choice,
                answer: isOx ? choice : `${choice}. ${choices[choice] || ''}`.trim(),
                confidence
            };
        } else {
            if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ ok: false, error: 'claude-not-configured' });
            result = { ok: true, model: 'claude', answer: await askClaude(sheet, question), confidence: null };
        }
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
        cache.set(hash, result);
        return res.status(200).json(result);
    } catch (e) {
        console.error('ask failed:', e && e.message);
        return res.status(502).json({ ok: false, error: 'ai-failed' });
    }
}
