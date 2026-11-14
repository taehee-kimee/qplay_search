// 보기 역추적 + 족보에 없는 문제 수집 (설치형 QuizHelper v2.0.3과 같은 규칙)
//
// 1) 보기 역추적: 문제 글자 위에 검은 줄이 그어져 본문 OCR이 깨지거나 사라져도,
//    깨끗하게 읽힌 보기(1~4번) 중 하나를 정답으로 가진 문제를 족보에서 찾는다.
//    본문이 손상됐고 보기가 3개 이상 읽혔을 때만 동작한다.
// 2) 문제 수집: 문제 화면을 기억해 뒀다가 이어지는 정답 화면("[정 답] 정답은 3 ...")에서
//    진짜 답을 확정하고, 족보에 없거나 족보 답이 틀렸으면 이 브라우저(localStorage)에 저장한다.
(function () {
    'use strict';

    const STORAGE_KEY = 'qplay:collected:v1';
    const OUTBOX_KEY = 'qplay:collected:outbox';   // 서버로 보낼 대기열
    const CLIENT_KEY = 'qplay:client-id';
    const RETRACT_KEY = 'qplay:collected:retract'; // 지웠다고 서버에 알릴 대기열
    const DEBUG_KEY = 'qplay:collect:debug';       // 최근 원본 OCR 30개 (수집이 안 될 때 원인 확인용)
    // 모든 사용자의 수집분을 모으는 곳 (GitHub Pages에서도 같은 주소로 보낸다)
    const COLLECT_ENDPOINT = 'https://qplay-search.vercel.app/api/collect';
    const PENDING_LIFETIME_MS = 90 * 1000;

    // ===== 문자열 유틸 =====

    function normalizeText(text) {
        if (!text) return '';
        return String(text)
            .replace(/\|/g, 'l')
            .replace(/`/g, "'")
            .replace(/~/g, '-')
            .replace(/[^0-9A-Za-z_\s가-힣ㄱ-ㅎㅏ-ㅣ]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function compactKey(text) {
        return normalizeText(text).replace(/ /g, '');
    }

    // 한글 음절 → 초/중/종성 (자모 1개 오인식 허용 비교용: 첩→접, 탱→행)
    function toJamo(text) {
        let out = '';
        for (const ch of text) {
            const code = ch.charCodeAt(0);
            if (code >= 0xAC00 && code <= 0xD7A3) {
                const c = code - 0xAC00;
                out += String.fromCharCode(0x1100 + Math.floor(c / 588));
                out += String.fromCharCode(0x1161 + Math.floor((c % 588) / 28));
                const jong = c % 28;
                if (jong > 0) out += String.fromCharCode(0x11A7 + jong);
            } else {
                out += ch;
            }
        }
        return out;
    }

    // FuzzySharp Fuzz.Ratio와 같은 방식 (삽입/삭제 거리 기반, 0~100)
    function ratio(a, b) {
        if (!a.length && !b.length) return 100;
        if (!a.length || !b.length) return 0;
        const prev = new Array(b.length + 1).fill(0);
        const cur = new Array(b.length + 1).fill(0);
        for (let i = 1; i <= a.length; i++) {
            for (let j = 1; j <= b.length; j++) {
                cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
            }
            for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
        }
        return Math.round((200 * prev[b.length]) / (a.length + b.length));
    }

    // 짧은 쪽을 긴 쪽의 같은 길이 구간들과 비교한 최고 점수 (Fuzz.PartialRatio 근사)
    function partialRatio(a, b) {
        let s = a, l = b;
        if (s.length > l.length) { s = b; l = a; }
        if (!s.length) return 0;
        if (s.length === l.length) return ratio(s, l);
        let best = 0;
        for (let i = 0; i + s.length <= l.length; i++) {
            const r = ratio(s, l.substr(i, s.length));
            if (r > best) best = r;
            if (best === 100) break;
        }
        return best;
    }

    // 정답 비교용 키: 원본 + 닉네임/별표/슬래시 꼬리 제거본
    function answerKeys(answer) {
        const keys = [];
        const raw = compactKey(answer);
        if (raw.length >= 2) keys.push(raw);

        let core = String(answer || '');
        const slash = core.indexOf('/');
        if (slash > 0) core = core.substring(0, slash);
        const star = core.search(/[★☆*※•▪▫]/);
        if (star > 0) core = core.substring(0, star);
        const spacedHyphen = core.indexOf(' -');
        if (spacedHyphen > 0) core = core.substring(0, spacedHyphen);
        const coreKey = compactKey(core);
        if (coreKey.length >= 2 && !keys.includes(coreKey)) keys.push(coreKey);

        const bareHyphen = core.indexOf('-');
        if (bareHyphen > 0) {
            const head = compactKey(core.substring(0, bareHyphen));
            if (head.length >= 2 && !keys.includes(head)) keys.push(head);
        }
        return keys;
    }

    function cachedAnswerKeys(item) {
        if (!item.__answerKeys) item.__answerKeys = answerKeys(item.answer);
        return item.__answerKeys;
    }

    function answersEquivalent(a, b, jamoThreshold = 85, minFuzzyLength = 3) {
        const ka = answerKeys(a), kb = answerKeys(b);
        for (const x of ka) {
            for (const y of kb) {
                if (x === y) return true;
                if (x.length >= minFuzzyLength && y.length >= minFuzzyLength &&
                    ratio(toJamo(x), toJamo(y)) >= jamoThreshold) return true;
            }
        }
        return false;
    }

    // 정답 화면 글자가 잘려 나온 경우 ("헤세-보" ⊂ "헤세-보봐리부인")
    function isTruncatedReading(fullAnswer, reading) {
        const r = compactKey(reading);
        if (r.length < 2) return false;
        return answerKeys(fullAnswer).some(k => k.length > r.length && k.startsWith(r));
    }

    // ===== 화면 파싱 =====

    // Tesseract가 "지 진 계"처럼 한글을 한 글자씩 띄어 읽은 경우 붙인다.
    // 한글 토큰 대부분이 한 글자일 때만 동작 (정상 띄어쓰기 문장은 그대로 둔다)
    function fixSpacing(text, minTokens = 3) {
        if (!text) return text;
        const tokens = text.split(/\s+/).filter(Boolean);
        const hangulTokens = tokens.filter(t => /[가-힣]/.test(t));
        if (hangulTokens.length < minTokens) return text.trim();
        const single = hangulTokens.filter(t => /^[가-힣]$/.test(t)).length;
        if (single / hangulTokens.length < 0.6) return text.trim();
        return text.trim()
            .replace(/([가-힣])\s+(?=[가-힣](\s|$|[?.,!)]))/g, '$1')
            .replace(/(^|\s)(\d(?:\s\d)+)(?=\s|$|[가-힣])/g, (m, pre, digits) => pre + digits.replace(/\s/g, '')); // "1 8 6 7" → "1867"
    }

    function flatten(text) {
        return String(text || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    // "[정 답] 정답은 3. 노량대첩 [설 명] ..." / "[정 답1 정답은 4 [설 명] ..." / "정답은 사과 입니다"
    function parseAnswerScreen(text) {
        // Tesseract는 "정 답 은"처럼 글자 사이에 공백을 넣는 일이 많다
        const m = text.match(/(?:정\s*[답담]\s*\S?\s*)?정\s*[답담]\s*[은는]\s*(.+?)\s*(?:\[\s*설|설\s*명|$)/);
        if (!m) return null;
        const rest = m[1].trim();
        if (rest.includes('플레이어마다')) return { skip: true }; // 매크로 방지 문제
        const numbered = rest.match(/^([1-4])(?:\s*[.,)]\s*(.*))?$/);
        if (numbered) {
            const t = (numbered[2] || '').trim();
            return { number: parseInt(numbered[1], 10), text: t || null };
        }
        const subjective = rest.replace(/\s*(입니다|이다)?\s*[.!]*$/, '').trim();
        return { number: null, text: subjective || null };
    }

    // "1. 진주대첩 3. 노량대첩 2. 한산도대첩 4. 행주대첩" → {1:..., 2:..., 3:..., 4:...}
    function extractNumberedChoices(text) {
        // 번호 뒤 구분자는 . ) , 모두 허용 (OCR이 점을 쉼표로 읽는 경우)
        const plain = collectChoices(text, /(?<!\d)([1-4])\s*[.),]\s*(\D{1,30}?)\s*(?=(?<!\d)[1-4]\s*[.),]|$)/g);
        if (Object.keys(plain.choices).length >= 2) return plain;
        // 보기에 숫자가 들어간 경우 ("1. 1972 뮌헨 2. 1984 LA"): 번호 앞에 공백이 있을 때만 번호로 본다
        const withDigits = collectChoices(text, /(?:^|\s)([1-4])\s*[.),]\s*(.{1,30}?)\s*(?=\s[1-4]\s*[.),]|$)/g);
        return Object.keys(withDigits.choices).length > Object.keys(plain.choices).length ? withDigits : plain;
    }

    function collectChoices(text, re) {
        const choices = {};
        let firstIndex = -1;
        let m;
        while ((m = re.exec(text)) !== null) {
            const n = parseInt(m[1], 10);
            const value = fixSpacing(m[2].trim(), 2); // 보기는 짧으니 "박 쥐"도 붙인다
            if (!value || choices[n]) continue;
            if (firstIndex < 0) firstIndex = m.index;
            choices[n] = value;
        }
        return { choices, firstIndex };
    }

    function stripQuestionMarker(body) {
        return body
            .replace(/출제자\s*[:：]\s*\S+\s*/g, '')
            .replace(/\(\d+\s*글자\)/g, '')
            .replace(/^\s*[\[<]?\s*문\s*제(?:\s*\d{1,2}(?:\s*[\]>1l|]|[가-힣](?=\s))?|\s*[\]>1l|]|[가-힣](?=\s))?\s*/, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // 본문이 사라졌거나(한글 3자 미만, 영어 문제 제외) 깨진 문자 비율이 높으면 손상.
    // 웹은 일반 검색보다 먼저 판단하므로 "채도란?" 같은 짧은 질문, <책 제목> 같은 괄호는 손상으로 보지 않는다.
    function isBodyDamaged(body) {
        const hangul = (body.match(/[가-힣]/g) || []).length;
        const latin = (body.match(/[a-zA-Z]/g) || []).length;
        if (hangul < 3 && latin < 8) return true;
        const compact = body.replace(/\s/g, '');
        if (!compact.length) return true;
        const garbage = (compact.match(/[^가-힣a-zA-Z0-9?？.,'"‘’“”()<>\[\]〈〉《》『』「」!~·:%/\-]/g) || []).length;
        return garbage / compact.length >= 0.12;
    }

    function qualityOf(s) {
        const hangul = (s.match(/[가-힣]/g) || []).length;
        const garbage = (s.match(/[^가-힣a-zA-Z0-9\s?？.,'"()!~·:%/\-]/g) || []).length;
        return hangul - garbage * 3;
    }

    const SYSTEM_PATTERNS = [
        /에\s*관한\s*문제입니다/, /문제를\s*모두\s*풀었/, /사용자\s*대기중/, /시상식/,
        /오신\s*것을\s*환영/, /오신것을\s*환영/, /정답\s*번호를\s*클릭/
    ];

    // OCR이 한 글자씩 띄어 읽어도("에 관 한 문 제 입 니 다") 안내 화면을 알아보도록 공백을 빼고 비교
    function isSystemScreen(text) {
        const compact = String(text || '').replace(/\s+/g, '');
        return SYSTEM_PATTERNS.some(p => p.test(text) || p.test(compact));
    }

    function parseQuestionScreen(text) {
        if (isSystemScreen(text)) return null;
        let marker = text.search(/[\[<]\s*문\s*제/);
        let markerless = false;
        if (marker < 0) {
            // "[문제]" 표시가 깨져 읽힌 경우("쁘 제끼 에 픽 게 임 즈 의 …? 1. 포 트 나 이 트 2. …"):
            // 물음표로 끝나는 본문 + 보기 3개 이상이면 문제 화면으로 본다
            const probe = extractNumberedChoices(text);
            if (Object.keys(probe.choices).length < 3 || probe.firstIndex < 0) return null;
            if (!/[?？]/.test(text.substring(0, probe.firstIndex))) return null;
            marker = 0;
            markerless = true;
        }

        let afterMarker = text.substring(marker);
        // 깨진 표시 조각("쁘 제끼 ", "2H 1 ")을 본문 앞에서 떼기
        if (markerless) afterMarker = afterMarker.replace(/^\s*(?:\S{1,3}\s+)?\S{0,2}제\S{0,2}\s+(?=\S)/, '');
        // "[문제 5]"의 꼬리만 남은 경우 ("5] 고구려 고분벽화에…")
        if (markerless) afterMarker = afterMarker.replace(/^\s*\d{1,2}\s*[\]>)|]\s*/, '');
        if (/이미지\s*속?\s*(의\s*)?한글/.test(afterMarker)) return { captcha: true };

        const { choices, firstIndex } = extractNumberedChoices(afterMarker);
        const bodyRaw = firstIndex >= 0 ? afterMarker.substring(0, firstIndex) : afterMarker;
        // 물음표 뒤에 붙은 1~2글자 부스러기("…양식은? 엑") 제거
        const body = fixSpacing(stripQuestionMarker(bodyRaw))
            .replace(/([?？])\s*\S{1,2}$/, '$1')
            .replace(/\s+([?？])/g, '$1');
        if (!body && Object.keys(choices).length < 2) return null;
        return { body, choices };
    }

    // ===== 보기 역추적 =====

    function findByChoices(question, items) {
        const choiceValues = Object.keys(question.choices)
            .sort()
            .map(k => question.choices[k]);
        const choiceKeys = choiceValues.map(compactKey).filter(k => k.length >= 2);
        // 보기 4개가 모두 읽혔을 때만 (하나라도 빠지면 그게 정답일 수 있음)
        if (choiceKeys.length < 4) return [];
        const choiceJamo = choiceKeys.map(toJamo);
        const normalizedBody = normalizeText(question.body);

        const hits = [];
        for (const item of items) {
            let matched = false;
            for (const key of cachedAnswerKeys(item)) {
                for (let i = 0; i < choiceKeys.length && !matched; i++) {
                    const ck = choiceKeys[i];
                    if (key === ck) matched = true;
                    else if (key.length >= 3 && ck.length >= 3 && Math.abs(key.length - ck.length) <= 1 &&
                        ratio(toJamo(key), choiceJamo[i]) >= 85) matched = true;
                }
                if (matched) break;
            }
            if (!matched) continue;
            const sim = normalizedBody.length >= 2 ? partialRatio(normalizedBody, normalizeText(item.question)) : 0;
            hits.push({ item, sim });
        }

        // 같은 답끼리 묶고, 남아 있는 본문 조각과 비슷한 순으로
        const byAnswer = new Map();
        for (const h of hits) {
            const k = compactKey(h.item.answer);
            if (!byAnswer.has(k) || byAnswer.get(k).sim < h.sim) byAnswer.set(k, h);
        }
        return [...byAnswer.values()]
            .sort((a, b) => b.sim - a.sim)
            .map((h, i) => ({ ...h.item, matchScore: 100 - i, choiceFallback: true }));
    }

    // ===== 수집 저장소 =====

    function loadStore() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    function saveStore(store) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
            return true;
        } catch (e) {
            return false;
        }
    }

    function collectedFor(sheet) {
        const list = loadStore()[sheet];
        return Array.isArray(list) ? list : [];
    }

    function totalCount() {
        return Object.values(loadStore()).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
    }

    // 족보 데이터 + 이 브라우저에서 모은 문제
    function withCollected(data, sheet) {
        const extra = collectedFor(sheet).map(c => ({
            question: c.question,
            answer: c.answer,
            index: -1,
            sheet,
            collected: true
        }));
        return extra.length ? data.concat(extra) : data;
    }

    function toTsv() {
        const store = loadStore();
        const clean = s => String(s || '').replace(/[\t\r\n]+/g, ' ').trim();
        const lines = ['카테고리\t질문\t답\t메모'];
        for (const [sheet, list] of Object.entries(store)) {
            for (const c of list || []) {
                lines.push([sheet, c.question, c.answer, `${c.note || ''} ${c.time || ''}`].map(clean).join('\t'));
            }
        }
        return lines.join('\r\n') + '\r\n';
    }

    // ===== 수집기 상태 =====

    let pending = null;

    function isSameQuestion(a, b) {
        let shared = 0;
        for (const k of Object.keys(a.choices)) {
            if (b.choices[k] && answersEquivalent(a.choices[k], b.choices[k])) shared++;
        }
        if (shared >= 2) return true;
        const na = normalizeText(a.body), nb = normalizeText(b.body);
        return na.length >= 5 && nb.length >= 5 && ratio(na, nb) >= 80;
    }

    function rememberQuestion(q, sheet, now) {
        const candidate = {
            sheet,
            body: q.body,
            choices: { ...q.choices },
            variants: Object.fromEntries(Object.entries(q.choices).map(([k, v]) => [k, [v]])),
            matched: [],
            quality: qualityOf(q.body) + Object.keys(q.choices).length * 5,
            seenAt: now
        };

        if (pending && pending.sheet === sheet && now - pending.seenAt < PENDING_LIFETIME_MS && isSameQuestion(pending, candidate)) {
            if (candidate.quality > pending.quality) {
                pending.body = candidate.body;
                pending.quality = candidate.quality;
            }
            for (const [k, v] of Object.entries(candidate.choices)) {
                if (!pending.choices[k] || qualityOf(v) > qualityOf(pending.choices[k])) pending.choices[k] = v;
                pending.variants[k] = pending.variants[k] || [];
                if (!pending.variants[k].includes(v)) pending.variants[k].push(v);
            }
            pending.seenAt = now;
        } else {
            pending = candidate;
        }
    }

    function onAnswer(ans, items, now) {
        const p = pending;
        if (!p || now - p.seenAt > PENDING_LIFETIME_MS) return null;

        const choiceCount = Object.keys(p.choices).length;
        let trueAnswer = null;
        if (ans.number && p.choices[ans.number]) trueAnswer = p.choices[ans.number];
        else if (ans.text && (ans.number || choiceCount === 0)) trueAnswer = ans.text;
        if (!trueAnswer) return null;

        pending = null; // 한 문제당 한 번만
        trueAnswer = trueAnswer.trim();

        // 검색 결과 상위권에 이미 정답이 있으면 족보가 알고 있는 것 (OCR 오인식은 너그럽게)
        const readings = [trueAnswer];
        if (ans.text) readings.push(ans.text);
        if (ans.number && p.variants[ans.number]) readings.push(...p.variants[ans.number]);
        const known = p.matched.some(m => readings.some(r => answersEquivalent(m, r, 75, 2) || isTruncatedReading(m, r)));
        if (known) return null;

        if (isSystemScreen(p.body)) return null; // 안내 화면이 질문으로 잡힌 경우 (안전장치)

        let question, note;
        if (isBodyDamaged(p.body)) {
            if (choiceCount < 3) return null; // 진짜 답이 안 보이는 보기였을 수 있음
            question = '(가려진 문제) 보기: ' + Object.keys(p.choices).sort().map(k => p.choices[k]).join(' / ');
            note = '본문가려짐';
        } else {
            question = p.body;
            note = p.matched.length ? `오답매칭(${p.matched[0]})` : '족보없음';
        }
        if (question.length < 4) return null;

        // 중복 확인 (족보 + 이미 모은 것): 같은 답을 가진 항목 중 질문이 비슷하면 족보에 이미 있는 것
        const qKey = compactKey(question);
        const normalizedBody = normalizeText(p.body);
        const dup = items.some(it => {
            if (!answersEquivalent(it.answer, trueAnswer, 75, 2)) return false;
            if (compactKey(it.question) === qKey) return true;
            return normalizedBody.length >= 5 && partialRatio(normalizedBody, normalizeText(it.question)) >= 70;
        });
        if (dup) return null;

        const store = loadStore();
        const list = Array.isArray(store[p.sheet]) ? store[p.sheet] : [];
        if (list.some(c => compactKey(c.question) === qKey && answersEquivalent(c.answer, trueAnswer))) return null;

        const d = new Date(now);
        const pad = n => String(n).padStart(2, '0');
        const time = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        const saved = { question, answer: trueAnswer, note, time };
        list.push(saved);
        store[p.sheet] = list;
        if (!saveStore(store)) return null;

        enqueueForServer({ sheet: p.sheet, question, answer: trueAnswer, note });
        return { ...saved, sheet: p.sheet };
    }

    /**
     * 매 캡처마다 원본 OCR 글자로 호출.
     * 반환: { saved: 새로 모은 문제 | null, fallback: { items, choices, key } | null }
     */
    function observe(rawText, sheet, items, now = Date.now()) {
        const result = { saved: null, fallback: null };
        if (!rawText || !sheet) return result;
        const text = flatten(rawText);
        recordDebug(text);

        const ans = parseAnswerScreen(text);
        if (ans) {
            if (ans.skip) pending = null;
            else result.saved = onAnswer(ans, items || [], now);
            return result;
        }

        const q = parseQuestionScreen(text);
        if (!q) return result;
        if (q.captcha) { pending = null; return result; }

        rememberQuestion(q, sheet, now);

        if (Object.keys(q.choices).length >= 4 && isBodyDamaged(q.body)) {
            const found = findByChoices(q, items || []);
            if (found.length) {
                const choices = Object.keys(q.choices).sort().map(k => q.choices[k]);
                result.fallback = { items: found, choices, key: 'CHOICES:' + choices.join('|') };
                setMatchedAnswers(found.slice(0, 5).map(i => i.answer));
            }
        }
        return result;
    }

    // 문제 화면 검색 결과의 상위 답들 (정답 화면에서 족보가 맞았는지 판단용)
    function setMatchedAnswers(answers) {
        if (pending) pending.matched = (answers || []).filter(Boolean).slice(0, 5);
    }

    // ===== 서버 전송 (모든 사용자 수집분을 한곳으로) =====

    function readJson(key, fallback) {
        try {
            const v = JSON.parse(localStorage.getItem(key));
            return v == null ? fallback : v;
        } catch (e) {
            return fallback;
        }
    }

    function writeJson(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 저장 공간 부족 등 */ }
    }

    function clientId() {
        let id = null;
        try { id = localStorage.getItem(CLIENT_KEY); } catch (e) { /* ignore */ }
        if (!id) {
            id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)) + '';
            try { localStorage.setItem(CLIENT_KEY, id); } catch (e) { /* ignore */ }
        }
        return id;
    }

    function enqueueForServer(item) {
        const box = readJson(OUTBOX_KEY, []);
        box.push(item);
        writeJson(OUTBOX_KEY, box.slice(-200));
        flushOutbox();
    }

    let flushing = false;
    async function flushOutbox() {
        if (flushing || typeof fetch === 'undefined') return;
        const box = readJson(OUTBOX_KEY, []);
        if (!box.length) return;
        flushing = true;
        try {
            const batch = box.slice(0, 20);
            const res = await fetch(COLLECT_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client: clientId(), items: batch })
            });
            // 200: 저장됨, 400: 서버가 거절한 형식 → 둘 다 대기열에서 뺀다. 503(저장소 미설정)·네트워크 오류는 다음에 다시
            if (res.ok || res.status === 400) {
                const rest = readJson(OUTBOX_KEY, []).slice(batch.length);
                writeJson(OUTBOX_KEY, rest);
                if (rest.length) setTimeout(flushOutbox, 1000);
            }
        } catch (e) {
            /* 오프라인 등: 다음 기회에 */
        } finally {
            flushing = false;
        }
    }

    // '서버에 바로 올리기' 버튼: 주어진 문제(없으면 이 브라우저에서 모은 전부)를 지금 바로 보낸다.
    // 같은 브라우저가 같은 문제를 다시 보내도 병합 루틴이 보낸 사람 기준으로 한 번만 센다.
    async function uploadNow(items) {
        if (typeof fetch === 'undefined') return { sent: 0, failed: 0, error: 'no-fetch' };
        if (!Array.isArray(items)) {
            items = [];
            for (const [sheet, list] of Object.entries(loadStore())) {
                for (const c of list || []) items.push({ sheet, question: c.question, answer: c.answer, note: c.note || '' });
            }
        }
        // 대기열에 남은 것도 함께 (중복은 질문+답으로 걸러냄)
        const seen = new Set();
        const all = [];
        for (const it of items.concat(readJson(OUTBOX_KEY, []))) {
            const k = `${it.sheet}|${compactKey(it.question)}|${compactKey(it.answer)}`;
            if (seen.has(k)) continue;
            seen.add(k);
            all.push({ sheet: it.sheet, question: it.question, answer: it.answer, note: it.note || '' });
        }
        let sent = 0, rejected = 0, failed = 0, error = null;
        for (let i = 0; i < all.length; i += 20) {
            const batch = all.slice(i, i + 20);
            try {
                const res = await fetch(COLLECT_ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ client: clientId(), items: batch })
                });
                if (res.ok) {
                    const body = await res.json().catch(() => ({}));
                    const n = typeof body.count === 'number' ? body.count : batch.length;
                    sent += n;
                    rejected += batch.length - n;
                } else if (res.status === 400) {
                    rejected += batch.length;
                } else {
                    failed += batch.length;
                    error = `server-${res.status}`;
                }
            } catch (e) {
                failed += batch.length;
                error = 'network';
            }
        }
        // 보내기에 성공(또는 서버가 형식 거절)했으면 대기열 비우기
        if (!failed) writeJson(OUTBOX_KEY, []);
        return { sent, rejected, failed, error, total: all.length };
    }

    // '모은 문제'에서 지우기: 이 브라우저 목록·전송 대기열에서 빼고, 이미 보낸 것은 서버에 취소를 알린다
    function removeCollected(sheet, question, answer) {
        const same = it => it.sheet === sheet && compactKey(it.question) === compactKey(question) &&
            compactKey(it.answer) === compactKey(answer);
        const store = loadStore();
        const before = (store[sheet] || []).length;
        store[sheet] = (store[sheet] || []).filter(c => !same({ sheet, question: c.question, answer: c.answer }));
        if (!store[sheet].length) delete store[sheet];
        saveStore(store);
        writeJson(OUTBOX_KEY, readJson(OUTBOX_KEY, []).filter(it => !same(it)));
        const box = readJson(RETRACT_KEY, []);
        box.push({ sheet, question, answer, note: '' });
        writeJson(RETRACT_KEY, box.slice(-200));
        flushRetracts();
        return before - (store[sheet] || []).length;
    }

    // '모은 문제'에서 직접 고치기: 이 브라우저 목록을 바꾸고, 서버에는 예전 것을 취소한 뒤 고친 것을 새로 보낸다
    function editCollected(sheet, oldQuestion, oldAnswer, newQuestion, newAnswer) {
        const clean = v => String(v || '').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
        newQuestion = clean(newQuestion);
        newAnswer = clean(newAnswer);
        if (newQuestion.length < 4 || !newAnswer) return { ok: false, error: 'too-short' };
        const same = (q, a) => compactKey(q) === compactKey(oldQuestion) && compactKey(a) === compactKey(oldAnswer);
        const store = loadStore();
        const list = Array.isArray(store[sheet]) ? store[sheet] : [];
        const item = list.find(c => same(c.question, c.answer));
        if (!item) return { ok: false, error: 'not-found' };
        if (item.question === newQuestion && item.answer === newAnswer) return { ok: true, changed: false };
        // 이미 같은 문제·답이 목록에 따로 있으면 이 줄만 지운다
        const dupe = list.find(c => c !== item && compactKey(c.question) === compactKey(newQuestion) && compactKey(c.answer) === compactKey(newAnswer));
        if (dupe) store[sheet] = list.filter(c => c !== item);
        else {
            item.question = newQuestion;
            item.answer = newAnswer;
            item.note = /직접수정/.test(item.note || '') ? item.note : `${item.note ? item.note + ' ' : ''}직접수정`;
        }
        saveStore(store);
        // 띄어쓰기·기호만 바뀐 경우: 서버의 병합 루틴은 어차피 같은 문제로 보니 다시 보낼 필요 없음
        if (same(newQuestion, newAnswer)) return { ok: true, changed: true };
        // 예전 내용: 아직 안 보냈으면 대기열에서 빼고, 보냈을 수 있으니 취소도 알린다
        writeJson(OUTBOX_KEY, readJson(OUTBOX_KEY, []).filter(it => !(it.sheet === sheet && same(it.question, it.answer))));
        const box = readJson(RETRACT_KEY, []);
        box.push({ sheet, question: oldQuestion, answer: oldAnswer, note: '' });
        writeJson(RETRACT_KEY, box.slice(-200));
        flushRetracts();
        // 취소가 먼저 서버에 닿도록 조금 뒤에 새 내용을 보낸다 (병합 루틴은 보낸 순서대로 처리)
        const fresh = { sheet, question: newQuestion, answer: newAnswer, note: dupe ? (dupe.note || '') : item.note };
        setTimeout(() => enqueueForServer(fresh), 1500);
        return { ok: true, changed: true };
    }

    let retracting = false;
    async function flushRetracts() {
        if (retracting || typeof fetch === 'undefined') return;
        const box = readJson(RETRACT_KEY, []);
        if (!box.length) return;
        retracting = true;
        try {
            const batch = box.slice(0, 20);
            const res = await fetch(COLLECT_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client: clientId(), retract: true, items: batch })
            });
            if (res.ok || res.status === 400) {
                const rest = readJson(RETRACT_KEY, []).slice(batch.length);
                writeJson(RETRACT_KEY, rest);
                if (rest.length) setTimeout(flushRetracts, 1000);
            }
        } catch (e) {
            /* 오프라인 등: 다음 기회에 */
        } finally {
            retracting = false;
        }
    }

    function recordDebug(text) {
        const log = readJson(DEBUG_KEY, []);
        log.push({ t: new Date().toISOString().slice(5, 19), s: text.slice(0, 240) });
        writeJson(DEBUG_KEY, log.slice(-30));
    }

    // 예전 버그로 게임 안내 화면("…에 관한 문제입니다")이 질문으로 저장된 항목 정리 (병합 루틴도 이런 항목은 버린다)
    function purgeSystemScreens() {
        const store = loadStore();
        let removed = 0;
        for (const sheet of Object.keys(store)) {
            const list = Array.isArray(store[sheet]) ? store[sheet] : [];
            const kept = list.filter(c => !isSystemScreen(c && c.question));
            removed += list.length - kept.length;
            if (kept.length) store[sheet] = kept; else delete store[sheet];
        }
        if (removed) {
            saveStore(store);
            writeJson(OUTBOX_KEY, readJson(OUTBOX_KEY, []).filter(it => !isSystemScreen(it && it.question)));
        }
        return removed;
    }
    if (typeof localStorage !== 'undefined') purgeSystemScreens();

    // 페이지를 열 때 못 보낸 것들 다시 보내기
    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('load', () => setTimeout(() => { flushOutbox(); flushRetracts(); }, 3000));
    }

    window.QplayCollect = {
        observe,
        setMatchedAnswers,
        withCollected,
        totalCount,
        toTsv,
        flushOutbox,
        uploadNow,
        removeCollected,
        editCollected,
        // AI 질문용: 문제 화면 원본 OCR → { body, choices } (문제 화면이 아니면 null)
        parseQuestion: (text) => { try { const r = parseQuestionScreen(flatten(text)); return r && !r.captcha ? r : null; } catch (e) { return null; } },
        pendingUploads: () => readJson(OUTBOX_KEY, []).length,
        // 표시용 정리 (예전에 띄어 읽힌 채 저장된 문제도 보기 좋게): 루틴의 tidy_text와 같은 규칙
        tidy: (text, isQuestion) => {
            let t = fixSpacing(String(text || '').replace(/\s+/g, ' '), isQuestion ? 3 : 2);
            if (isQuestion) t = t.replace(/^\s*\d{1,2}\s*[\]>|]\s*/, ''); // 문제 번호 표시의 꼬리 ("5] …")
            if (!isQuestion) t = t.replace(/[\s\-–_|>]+$/, ''); // 답 끝의 "-", "|" 같은 부스러기
            if (isQuestion) {
                t = t.replace(/([?？])\s*\S{0,2}\s*[1-4](?:\s*[.,)]|\s).*$/, '$1')
                    .replace(/([?？])\s*\S{1,2}$/, '$1')
                    .replace(/\s+([?？])/g, '$1');
            }
            return t;
        },
        // 테스트용
        _internal: { parseAnswerScreen, parseQuestionScreen, extractNumberedChoices, isBodyDamaged, findByChoices, answersEquivalent, ratio, partialRatio, toJamo, resetPending: () => { pending = null; } }
    };
})();
