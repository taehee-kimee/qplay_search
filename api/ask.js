// 족보에 없는 문제를 AI에게 물어보는 API (Vercel 함수)
//
// POST /api/ask  { sheet, question, choices: { "1": "...", "2": "..." } }
//   - 보기가 있는 문제(OX, 객관식) → TypeSafe Jev (Choice 질문, ~0.2초, 확신 점수 포함)
//   - 보기가 없는 주관식(가로세로, 꽁꽁 등) → Claude Haiku 5.5
//   응답: { ok, answer, choice?, confidence?, model }
//
// 필요 설정 (Vercel 환경변수): TYPESAFE_API_KEY, ANTHROPIC_API_KEY, AI_PASSWORD
// AI 모드는 비밀번호를 아는 사람만 쓴다 (여러 사람이 같이 쓰는 사이트라 요금이 새지 않게). body.pass로 받는다.
// POST { verify: true, pass } → 비밀번호만 확인
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

function passwordOk(pass) {
    const real = process.env.AI_PASSWORD;
    if (!real || typeof pass !== 'string' || !pass) return false;
    const a = crypto.createHash('sha256').update(pass).digest();
    const b = crypto.createHash('sha256').update(real).digest();
    return crypto.timingSafeEqual(a, b);
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

// Jev 사진 읽기 (https://docs.typesafe.ai/images.md, 헤더 TypeSafe-Danger-Zone-Images 필요, 280~1568px)
async function askJevImage(sheet, format, b64) {
    const ref = 'img-' + crypto.randomUUID();
    const isOx = sheet === 'ox,xo';
    const criteria = isOx
        ? { O: '화면의 진술이 사실이다(맞다)', X: '화면의 진술이 사실이 아니다(틀리다)' }
        : { 1: '화면의 1번 보기', 2: '화면의 2번 보기', 3: '화면의 3번 보기', 4: '화면의 4번 보기' };
    const r = await fetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
            'Content-Type': 'application/json',
            'TypeSafe-Danger-Zone-Images': 'true'
        },
        body: JSON.stringify({
            model: 'jev-latest',
            state: { screen: ref },
            assets: { [ref]: { type: 'image', format, data_base64: b64 } },
            questions: { answer: {
                type: 'choice',
                instructions: isOx
                    ? '`screen`은 한국어 OX 퀴즈 게임 화면이다. 화면에 적힌 진술이 맞는가'
                    : '`screen`은 한국어 퀴즈 게임 화면이다. 화면의 문제에 대한 정답 보기 번호',
                criteria
            } }
        }),
        signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error(`jev-vision ${r.status} ${(await r.text()).slice(0, 120)}`);
    const data = await r.json();
    const ans = data?.answers?.answer;
    if (!ans || !ans.choice) throw new Error('jev-vision-no-answer');
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
        // 생각을 끄면 정답률이 크게 떨어진다 (2026-11-14 족보 200문제: 보기 문제 79%→87%, OX 76%→86%).
        // 보기·OX(두 번째 의견)는 medium, 주관식은 속도 때문에 low.
        max_tokens: 3000,
        output_config: { effort: (isOx || choices) ? 'medium' : 'low' },
        system: `너는 한국어 퀴즈 정답을 맞히는 도우미다. ${rule}${hint} 문제가 "아닌 것/않는 것/틀린 것"을 물으면 조건에 맞지 않는 보기를 골라라. 모르면 가장 그럴듯한 답을 하나 내라. 답은 한국어(한글)로 써라.`,
        messages: [{ role: 'user', content }]
    });
    if (response.stop_reason === 'refusal') throw new Error('claude-refusal');
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const answer = clean((lines[lines.length - 1] || '').replace(/^(정답|답)\s*[:：]\s*/, '').replace(/[.。]$/, ''), 60);
    if (!answer) throw new Error('claude-empty');
    return answer;
}

// 화면 인식(OCR)이 깨졌을 때: 캡처 사진을 Claude가 직접 보고 문제·보기를 읽어 답한다
// (2026-11-14 시험: 흐린 화면 3문제 모두 정답, 1.3~3.7초, 입력 ~870토큰 ≈ 0.3원)
const VISION_SCHEMA = {
    type: 'object',
    properties: {
        is_quiz: { type: 'boolean' },
        question: { type: 'string' },
        choices: { type: 'array', items: { type: 'string' } },
        answer_number: { type: 'integer' },
        answer_text: { type: 'string' }
    },
    required: ['is_quiz', 'question', 'choices', 'answer_number', 'answer_text'],
    additionalProperties: false
};

async function askClaudeVision(sheet, image) {
    if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 15000, maxRetries: 1 });
    const kind = sheet === 'ox,xo'
        ? 'OX 퀴즈다. 진술이 맞으면 answer_text를 "O", 틀리면 "X"로 하고 answer_number는 0.'
        : sheet === '가로세로' || sheet === '꽁꽁'
            ? '주관식 퀴즈다. 정답 낱말을 answer_text에 쓰고 answer_number는 0.'
            : '보기가 있으면 정답 보기 번호를 answer_number(1부터)에, 그 보기 내용을 answer_text에 써라.';
    const response = await anthropic.messages.create({
        model: 'claude-haiku-5-5',
        max_tokens: 3000,
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: VISION_SCHEMA } },
        system: `너는 한국어 퀴즈 게임 화면을 보고 정답을 맞히는 도우미다. 화면의 문제와 보기를 그대로 읽어 question·choices에 옮기고 정답을 골라라. ${kind} 퀴즈 문제 화면이 아니면(대기실, 정답 발표, 순위 화면 등) is_quiz=false. 문제가 "아닌 것/않는 것/틀린 것"을 물으면 조건에 맞지 않는 보기를 골라라. 답은 한국어로.`,
        messages: [{
            role: 'user',
            content: [
                { type: 'image', source: { type: 'base64', media_type: image.type, data: image.data } },
                { type: 'text', text: '이 화면의 퀴즈 정답은?' }
            ]
        }]
    });
    if (response.stop_reason === 'refusal') throw new Error('claude-refusal');
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    return JSON.parse(text);
}

async function readBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) throw new Error('too large'); // 캡처 사진(JPEG) 때문에 1MB까지
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
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (!process.env.AI_PASSWORD) return res.status(503).json({ ok: false, error: 'password-not-configured' });
    if (!passwordOk(body.pass)) {
        // 비밀번호 마구 넣어보기도 횟수 제한에 걸리게
        if (rateLimited(ip)) return res.status(429).json({ ok: false, error: 'rate-limited' });
        return res.status(401).json({ ok: false, error: 'bad-password' });
    }
    if (body.verify === true) return res.status(200).json({ ok: true });

    // 캡처 사진으로 묻기
    if (typeof body.image === 'string') {
        const m = body.image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
        const vsheet = clean(body.sheet, 30);
        if (!m || m[2].length > 900 * 1024 || !SHEETS.has(vsheet)) return res.status(400).json({ ok: false, error: 'bad-image' });
        if (rateLimited(ip)) return res.status(429).json({ ok: false, error: 'rate-limited' });
        // engine: 'jev' → Jev가 사진을 보고 보기 번호(또는 O/X)만 고른다. 0.2초·약 0.07원 (Claude 사진은 1.5~4초·약 0.3원)
        // 시험판(Dreamer-ready) 기능이라 실패하면 화면이 Claude 사진으로 다시 묻는다.
        if (body.engine === 'jev') {
            if (!process.env.TYPESAFE_API_KEY) return res.status(503).json({ ok: false, error: 'jev-not-configured' });
            if (vsheet !== 'ox,xo' && vsheet !== '올라올라(꼬로록)') return res.status(400).json({ ok: false, error: 'jev-vision-sheet' });
            if (!/^image\/(jpeg|png)$/.test(m[1])) return res.status(400).json({ ok: false, error: 'bad-image' });
            try {
                const v = await askJevImage(vsheet, m[1] === 'image/png' ? 'png' : 'jpg', m[2]);
                console.log('[ask] jev-vision', JSON.stringify({ sheet: vsheet, a: v.choice, p: v.confidence }));
                return res.status(200).json({ ok: true, model: 'jev-vision', choice: v.choice, answer: v.choice, confidence: v.confidence });
            } catch (e) {
                console.error('ask jev-vision failed:', e && e.message);
                return res.status(502).json({ ok: false, error: 'ai-failed' });
            }
        }
        if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ ok: false, error: 'claude-not-configured' });
        try {
            const v = await askClaudeVision(vsheet, { type: m[1], data: m[2] });
            console.log('[ask] vision', JSON.stringify({ sheet: vsheet, quiz: v.is_quiz, q: v.question, c: v.choices, n: v.answer_number, a: v.answer_text }));
            if (!v.is_quiz) return res.status(200).json({ ok: false, error: 'not-quiz' });
            const choiceText = v.answer_number > 0 && v.choices[v.answer_number - 1] ? v.choices[v.answer_number - 1] : '';
            const answer = v.answer_number > 0 ? `${v.answer_number}. ${choiceText || v.answer_text}` : v.answer_text;
            // choice: Jev 답과 맞대 보기 위한 값 (OX는 O/X, 객관식은 보기 번호)
            const vChoice = vsheet === 'ox,xo'
                ? ((String(v.answer_text).toUpperCase().match(/[OX]/) || [null])[0])
                : (v.answer_number > 0 ? String(v.answer_number) : null);
            return res.status(200).json({ ok: true, model: 'claude-vision', question: clean(v.question, 300), choices: v.choices.map(c => clean(c, 60)), answer: clean(vsheet === 'ox,xo' && vChoice ? vChoice : answer, 80), choice: vChoice, confidence: null });
        } catch (e) {
            console.error('ask vision failed:', e && e.message);
            return res.status(502).json({ ok: false, error: 'ai-failed' });
        }
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
    // 화면 인식이 깨진 글(숫자 덩어리, 낱자 ㅣㅡㅁ)은 AI가 엉뚱한 답을 내므로 받지 않는다
    const garbled = s => /\d{7,}/.test(s) || (s.match(/[ㅏ-ㅣ]/g) || []).length >= 2
        || /방정보|블랙리스트|서바이벌|PLA[VY]ING|성별아이디|게임이종료/i.test(s.replace(/\s/g, '')); // 대기실 화면
    if (garbled(question) || Object.values(choices).some(garbled)) {
        console.log('[ask] garbled', JSON.stringify({ sheet, q: question, c: choices }));
        return res.status(422).json({ ok: false, error: 'garbled' });
    }

    // 카테고리에 맞게 답한다: OX 카테고리는 질문 모양과 상관없이 항상 O/X (화면 인식이 문장 끝을 깨뜨려도)
    const isOx = sheet === 'ox,xo';
    const hasChoices = Object.keys(choices).length >= 2;
    // second: 'claude' → Jev가 확신 못 한 문제를 Claude에게 다시 묻는다 (화면이 Jev 답을 먼저 보여준 뒤 부름)
    const forceClaude = body.second === 'claude';
    const hash = crypto.createHash('sha256').update(JSON.stringify([sheet, question, isOx ? null : choices, forceClaude])).digest('hex');
    if (cache.has(hash)) return res.status(200).json({ ...cache.get(hash), cached: true });

    if (rateLimited(ip)) return res.status(429).json({ ok: false, error: 'rate-limited' });

    try {
        let result;
        if (forceClaude) {
            if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ ok: false, error: 'claude-not-configured' });
            const text = await askClaude(sheet, question, hasChoices ? choices : null, isOx);
            let answer = text;
            let choice = null;
            if (isOx) {
                const ox = text.toUpperCase().match(/[OX]/g);
                choice = ox ? ox[ox.length - 1] : null;
                answer = choice || text;
            } else if (hasChoices) {
                const m = text.match(/[1-6]/g);
                const last = m ? m[m.length - 1] : null;
                choice = last && choices[last] ? last : null;
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
        // 틀린 답 추적용 기록 (Vercel 런타임 로그). 문제 글과 답만 남긴다.
        console.log('[ask]', JSON.stringify({ sheet, q: question, c: hasChoices ? choices : undefined, m: result.model, a: result.answer, p: result.confidence, second: forceClaude || undefined }));
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
        cache.set(hash, result);
        return res.status(200).json(result);
    } catch (e) {
        console.error('ask failed:', e && e.message);
        return res.status(502).json({ ok: false, error: 'ai-failed' });
    }
}
