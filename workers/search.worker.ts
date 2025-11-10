type WorkerMessage = BuildIndexMessage | SearchMessage | CancelMessage | GetFlagsMessage;

interface BuildIndexMessage {
  readonly type: 'build-index';
  readonly id: string;
  readonly documents: readonly SearchDocument[];
  readonly timeout?: number;
}

interface SearchMessage {
  readonly type: 'search';
  readonly id: string;
  readonly query: string;
  readonly limit?: number;
  readonly useFast?: boolean;
}

interface CancelMessage {
  readonly type: 'cancel';
  readonly id: string;
}

interface GetFlagsMessage {
  readonly type: 'get-flags';
  readonly id: string;
}

interface SearchDocument {
  readonly id: string;
  readonly text: string;
  readonly payload?: unknown;
}

interface SearchResult {
  readonly id: string;
  readonly text: string;
  readonly score: number;
  readonly dice: number;
  readonly distance: number;
  readonly margin: number;
  readonly payload?: unknown;
}

interface SearchResponse {
  readonly type: 'search-result';
  readonly id: string;
  readonly results: readonly SearchResult[];
  readonly used: 'fast' | 'legacy';
}

interface IndexReadyResponse {
  readonly type: 'index-ready';
  readonly id: string;
  readonly size: number;
}

interface IndexProgressResponse {
  readonly type: 'index-progress';
  readonly id: string;
  readonly progress: number;
  readonly total: number;
}

interface SearchErrorResponse {
  readonly type: 'search-error';
  readonly id: string;
  readonly error: string;
}

const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF]/g;
const CONFUSABLE_MAPPING: Record<string, string> = {
  '﹣': '-', '－': '-', '―': '-', 'ｰ': '-', 'ー': '-',
  '～': '~', '﹗': '!', '！': '!', '﹘': '-', '‒': '-',
  '／': '/', '⧸': '/', '∕': '/',
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9'
};

const CONFUSABLE_REGEX = buildConfusableRegex(CONFUSABLE_MAPPING);
const DEFAULT_INDEX_TIMEOUT_MS = 10000;

let documents: SearchDocument[] = [];
let normalizedDocuments: string[] = [];
let trigramCache = new Map<number, Set<string>>();
let trigramIndex = new Map<string, Set<number>>();
let activeSearchId: string | null = null;
let indexReady = false;
let enableFastSearch = false;
let enableShadowTest = false;

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (!isWorkerMessage(data)) {
    return;
  }

  if (data.type === 'get-flags') {
    self.postMessage({ type: 'flags', id: data.id, enableFastSearch, indexReady });
    return;
  }

  if (data.type === 'build-index') {
    void handleBuildIndex(data);
    return;
  }

  if (data.type === 'search') {
    void handleSearch(data);
    return;
  }

  void handleCancel(data);
});

async function handleBuildIndex(message: BuildIndexMessage): Promise<void> {
  const timeout = message.timeout ?? DEFAULT_INDEX_TIMEOUT_MS;
  const startTime = performance.now();
  indexReady = false;

  try {
    documents = [...message.documents];
    normalizedDocuments = [];
    trigramCache = new Map();
    trigramIndex = new Map();

    const total = documents.length;
    for (let index = 0; index < total; index += 1) {
      if (performance.now() - startTime > timeout) {
        self.postMessage({
          type: 'search-error',
          id: message.id,
          error: '인덱스 구축이 타임아웃되었습니다. 이번 세션은 레거시 검색을 사용합니다.'
        });
        return;
      }

      const normalized = normalizeKo(documents[index]?.text ?? '');
      normalizedDocuments.push(normalized);
      const trigrams = extractTrigrams(normalized);
      trigramCache.set(index, trigrams);
      trigrams.forEach(trigram => {
        const bucket = trigramIndex.get(trigram);
        if (bucket) {
          bucket.add(index);
        } else {
          trigramIndex.set(trigram, new Set([index]));
        }
      });

      if (index % 100 === 0 || index === total - 1) {
        self.postMessage({
          type: 'index-progress',
          id: message.id,
          progress: index + 1,
          total
        });
      }
    }

    indexReady = true;
    const response: IndexReadyResponse = {
      type: 'index-ready',
      id: message.id,
      size: documents.length
    };
    self.postMessage(response);
  } catch (error) {
    indexReady = false;
    const response: SearchErrorResponse = {
      type: 'search-error',
      id: message.id,
      error: error instanceof Error ? error.message : '색인 생성 중 오류가 발생했습니다.'
    };
    self.postMessage(response);
  }
}

async function handleSearch(message: SearchMessage): Promise<void> {
  // 이전 요청이 있으면 취소 처리 (stale guard)
  if (activeSearchId !== null && activeSearchId !== message.id) {
    // 이전 요청은 무시됨 (결과를 보내지 않음)
  }
  
  activeSearchId = message.id;
  const { id, query } = message;
  const useFast = (message.useFast ?? enableFastSearch) && indexReady;

  try {
    const normalizedQuery = normalizeKo(query);
    if (normalizedQuery.length === 0) {
      // 요청이 취소되었는지 확인
      if (activeSearchId !== id) {
        return;
      }
      const response: SearchResponse = {
        type: 'search-result',
        id,
        results: [],
        used: useFast ? 'fast' : 'legacy'
      };
      self.postMessage(response);
      return;
    }

    let results: SearchResult[];

    if (useFast) {
      results = await performFastSearch(normalizedQuery, message.limit ?? 3);
    } else {
      results = await performLegacySearch(normalizedQuery, message.limit ?? 3);
    }

    // 요청이 취소되었는지 확인
    if (activeSearchId !== id) {
      return;
    }

    const margin = calculateMargin(results);
    const response: SearchResponse = {
      type: 'search-result',
      id,
      results: results.map(result => ({ ...result, margin })),
      used: useFast ? 'fast' : 'legacy'
    };
    self.postMessage(response);
  } catch (error) {
    // 요청이 취소되었는지 확인
    if (activeSearchId !== id) {
      return;
    }
    const response: SearchErrorResponse = {
      type: 'search-error',
      id,
      error: error instanceof Error ? error.message : '검색 중 오류가 발생했습니다.'
    };
    self.postMessage(response);
  } finally {
    if (activeSearchId === id) {
      activeSearchId = null;
    }
  }
}

async function performFastSearch(query: string, limit: number): Promise<SearchResult[]> {
  // 짧은 문장(6자 미만)일 때는 legacy 검색 또는 fullscan 사용
  if (query.length < 6) {
    // 먼저 legacy 검색 시도
    const legacyResults = await performLegacySearch(query, limit);
    if (legacyResults.length > 0) {
      return legacyResults;
    }
    // legacy에서 결과가 없으면 fullscan (edit distance 기반)
    return performFullScan(query, limit);
  }

  const queryTrigrams = extractTrigrams(query);
  const candidateScores = collectCandidates(queryTrigrams);
  
  // 후보가 없을 때 fallback
  if (candidateScores.size === 0) {
    const legacyResults = await performLegacySearch(query, limit);
    if (legacyResults.length > 0) {
      return legacyResults;
    }
    return performFullScan(query, limit);
  }
  
  const results = rankCandidates(query, queryTrigrams, candidateScores, query.length);
  
  // 결과가 없거나 너무 적을 때 fallback
  if (results.length === 0 || (results.length < limit && results[0]?.score < 0.3)) {
    const legacyResults = await performLegacySearch(query, limit);
    if (legacyResults.length > 0) {
      return legacyResults;
    }
    return performFullScan(query, limit);
  }
  
  return results.slice(0, limit);
}

async function performLegacySearch(query: string, limit: number): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const queryLower = query.toLowerCase();

  documents.forEach((document, index) => {
    const text = document.text.toLowerCase();
    if (text.includes(queryLower)) {
      const score = text.indexOf(queryLower) === 0 ? 1.0 : 0.8;
      results.push({
        id: document.id,
        text: document.text,
        score,
        dice: score,
        distance: 0,
        margin: 0,
        payload: document.payload
      });
    }
  });

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Full scan: edit distance 기반 전체 검색 (fallback용)
function performFullScan(query: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];
  const queryLength = query.length;
  const maxDistance = Math.max(2, Math.floor(queryLength * 0.3)); // 최대 편집 거리

  for (let index = 0; index < documents.length; index += 1) {
    const normalizedDocument = normalizedDocuments[index];
    if (!normalizedDocument) {
      continue;
    }

    const distance = levenshtein(query, normalizedDocument);
    if (distance > maxDistance) {
      continue;
    }

    const maxLength = Math.max(queryLength, normalizedDocument.length, 1);
    const similarity = 1 - distance / maxLength;
    
    // 짧은 문장일 때 더 관대한 점수
    const score = queryLength < 6 ? similarity * 0.9 : similarity * 0.7;

    results.push({
      id: documents[index]?.id ?? String(index),
      text: documents[index]?.text ?? '',
      score,
      dice: similarity,
      distance,
      margin: 0,
      payload: documents[index]?.payload
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

function collectCandidates(queryTrigrams: Set<string>): Map<number, number> {
  const candidateScores = new Map<number, number>();
  queryTrigrams.forEach(trigram => {
    const candidates = trigramIndex.get(trigram);
    if (!candidates) {
      return;
    }

    candidates.forEach(index => {
      const previous = candidateScores.get(index) ?? 0;
      candidateScores.set(index, previous + 1);
    });
  });

  return candidateScores;
}

function rankCandidates(query: string, queryTrigrams: Set<string>, candidates: Map<number, number>, queryLength: number): SearchResult[] {
  const results: SearchResult[] = [];
  
  // 짧은 문장일 때 임계치 완화
  const isShortQuery = queryLength < 6;
  const diceMin = isShortQuery ? 0.1 : 0.2;
  const scoreMin = isShortQuery ? 0.15 : 0.25;

  candidates.forEach((sharedCount, documentIndex) => {
    const documentTrigrams = trigramCache.get(documentIndex);
    const normalizedDocument = normalizedDocuments[documentIndex];
    if (!documentTrigrams) {
      return;
    }

    const dice = diceCoefficient(sharedCount, queryTrigrams.size, documentTrigrams.size);
    
    // 짧은 문장일 때 dice 임계치 완화
    if (dice < diceMin) {
      return;
    }
    
    const distance = levenshtein(query, normalizedDocument);
    const maxLength = Math.max(query.length, normalizedDocument.length, 1);
    const normalizedSimilarity = 1 - distance / maxLength;
    
    // 짧은 문장일 때 similarity 가중치 증가
    const similarityWeight = isShortQuery ? 0.5 : 0.3;
    const diceWeight = isShortQuery ? 0.5 : 0.7;
    const score = dice * diceWeight + normalizedSimilarity * similarityWeight;

    // 최소 점수 필터링
    if (score < scoreMin) {
      return;
    }

    results.push({
      id: documents[documentIndex]?.id ?? String(documentIndex),
      text: documents[documentIndex]?.text ?? '',
      score,
      dice,
      distance,
      margin: 0,
      payload: documents[documentIndex]?.payload
    });
  });

  return results.sort((a, b) => b.score - a.score);
}

function diceCoefficient(shared: number, querySize: number, documentSize: number): number {
  if (querySize + documentSize === 0) {
    return 0;
  }
  return (2 * shared) / (querySize + documentSize);
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    matrix[row][0] = row;
  }

  for (let col = 0; col < cols; col += 1) {
    matrix[0][col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      if (a[row - 1] === b[col - 1]) {
        matrix[row][col] = matrix[row - 1][col - 1];
        continue;
      }

      const insertion = matrix[row][col - 1] + 1;
      const deletion = matrix[row - 1][col] + 1;
      const substitution = matrix[row - 1][col - 1] + 1;
      matrix[row][col] = Math.min(insertion, deletion, substitution);
    }
  }

  return matrix[rows - 1][cols - 1];
}

function extractTrigrams(text: string): Set<string> {
  const padded = text.length < 3 ? text.padEnd(3, '_') : text;
  const trigrams = new Set<string>();
  for (let index = 0; index <= padded.length - 3; index += 1) {
    trigrams.add(padded.slice(index, index + 3));
  }
  return trigrams;
}

function normalizeKo(source: string): string {
  const nfkc = source.normalize('NFKC').normalize('NFC');
  const withoutZeroWidth = nfkc.replace(ZERO_WIDTH_REGEX, '');
  const replaced = withoutZeroWidth.replace(CONFUSABLE_REGEX, char => CONFUSABLE_MAPPING[char] ?? char);
  
  // 구두점 제거 (검색 시 구두점 차이로 인한 매칭 실패 방지)
  const withoutPunctuation = replaced.replace(/[?.,!;:(){}[\]'"＂'""]/g, '');
  
  // 공백 제거 후 길이로 판단 (공백 제거 전 길이로 판단하면 '안드로이드 법칙' 같은 경우 문제 발생)
  const withoutWhitespace = withoutPunctuation.replace(/\s+/g, '');
  const isShort = withoutWhitespace.length < 6;
  
  if (isShort) {
    // 공백은 하나로 정규화하되 제거하지 않음
    const normalized = withoutPunctuation.replace(/\s+/g, ' ').trim();
    return normalized.toLowerCase();
  }
  
  // 긴 문장은 기존대로 공백 제거
  return withoutWhitespace.toLowerCase();
}

function calculateMargin(results: readonly SearchResult[]): number {
  if (results.length === 0) {
    return 0;
  }
  if (results.length === 1) {
    return results[0]?.score ?? 0;
  }
  return (results[0]?.score ?? 0) - (results[1]?.score ?? 0);
}

function buildConfusableRegex(mapping: Record<string, string>): RegExp {
  const characters = Object.keys(mapping);
  if (characters.length === 0) {
    return /[]/g;
  }

  const escaped = characters
    .map(char => char.replace(/[[\]\\^-]/g, '\\$&'))
    .join('');
  return new RegExp(`[${escaped}]`, 'g');
}

export function setFlags(flags: { enableFastSearch: boolean; enableShadowTest: boolean }): void {
  enableFastSearch = flags.enableFastSearch;
  enableShadowTest = flags.enableShadowTest;
}

async function handleCancel(message: CancelMessage): Promise<void> {
  if (activeSearchId !== message.id) {
    return;
  }

  activeSearchId = null;
}

function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.type === 'build-index') {
    return typeof candidate.id === 'string' && Array.isArray(candidate.documents);
  }

  if (candidate.type === 'search') {
    return typeof candidate.id === 'string' && typeof candidate.query === 'string';
  }

  if (candidate.type === 'cancel' || candidate.type === 'get-flags') {
    return typeof candidate.id === 'string';
  }

  return false;
}

export {};

