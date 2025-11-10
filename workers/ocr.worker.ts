import { createWorker, type CreateWorkerOptions, type Worker as TesseractWorker } from 'tesseract.js';

declare const self: DedicatedWorkerGlobalScope;

type WorkerMessage = OcrRequestMessage | OcrCancelMessage | GetFlagsMessage;

interface OcrRequestMessage {
  readonly type: 'ocr';
  readonly id: string;
  readonly payload: ImagePayload;
  readonly config?: Partial<OcrConfig>;
}

interface OcrCancelMessage {
  readonly type: 'cancel';
  readonly id: string;
}

interface GetFlagsMessage {
  readonly type: 'get-flags';
  readonly id: string;
}

type ImagePayload = ImageBitmap | Blob | ImageData | OffscreenCanvas;

interface OcrConfig {
  readonly lang: string;
  readonly tesseditPagesegMode: number;
}

interface OcrResultMessage {
  readonly type: 'ocr-result';
  readonly id: string;
  readonly text: string;
  readonly confidence: number;
  readonly durationMs: number;
}

interface OcrErrorMessage {
  readonly type: 'ocr-error';
  readonly id: string;
  readonly error: string;
}

const DEFAULT_LANG = 'eng+kor';
const TESSERACT_WORKER_PATH = new URL('/tesseract/worker.min.js', self.location.origin).toString();
const TESSERACT_CORE_SIMD_PATH = new URL('/tesseract/tesseract-core-simd.wasm.js', self.location.origin).toString();
const TESSERACT_CORE_FALLBACK_PATH = new URL('/tesseract/tesseract-core.wasm.js', self.location.origin).toString();
const TESSDATA_BASE_PATH = new URL('/tessdata', self.location.origin).toString();

let workerPromise: Promise<TesseractWorker> | null = null;
let activeJobs = new Map<string, { readonly startTime: number }>();
let simdSupportCache: boolean | null = null;
let enablePool = false;
let maxConcurrent = 1;
let inFlightCount = 0;

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (!isWorkerMessage(data)) {
    return;
  }

  if (data.type === 'get-flags') {
    self.postMessage({ type: 'flags', id: data.id, enablePool, maxConcurrent });
    return;
  }

  if (data.type === 'cancel') {
    void cancelJob(data.id);
    return;
  }

  void handleOcrRequest(data);
});

async function handleOcrRequest(message: OcrRequestMessage): Promise<void> {
  const { id } = message;
  const startTime = performance.now();

  if (enablePool && inFlightCount >= maxConcurrent) {
    const oldestJob = Array.from(activeJobs.entries())
      .sort((a, b) => a[1].startTime - b[1].startTime)[0];
    if (oldestJob) {
      await cancelJob(oldestJob[0]);
    }
  }

  try {
    activeJobs.set(id, { startTime });
    inFlightCount += 1;

    const worker = enablePool
      ? await ensureWorker(message.config?.lang ?? DEFAULT_LANG)
      : await createNewWorker(message.config?.lang ?? DEFAULT_LANG);

    if (message.config?.tesseditPagesegMode !== undefined) {
      await worker.setParameters({ tessedit_pageseg_mode: String(message.config.tesseditPagesegMode) });
    }

    const inputBitmap = await toImageBitmap(message.payload);
    try {
      const result = await worker.recognize(inputBitmap);
      if (!activeJobs.has(id)) {
        return;
      }

      const normalizedConfidence = clamp(result.data.confidence / 100, 0, 1);
      const elapsed = performance.now() - startTime;
      const response: OcrResultMessage = {
        type: 'ocr-result',
        id,
        text: result.data.text ?? '',
        confidence: normalizedConfidence,
        durationMs: elapsed
      };
      self.postMessage(response);
    } finally {
      inputBitmap.close();
    }

    if (!enablePool) {
      await worker.terminate();
    }
  } catch (error) {
    const response: OcrErrorMessage = {
      type: 'ocr-error',
      id,
      error: error instanceof Error ? error.message : '알 수 없는 OCR 오류가 발생했습니다.'
    };
    self.postMessage(response);
  } finally {
    activeJobs.delete(id);
    inFlightCount = Math.max(0, inFlightCount - 1);
  }
}

async function createNewWorker(lang: string): Promise<TesseractWorker> {
  const useSimd = await detectSimdSupport();
  const options: CreateWorkerOptions = {
    workerPath: TESSERACT_WORKER_PATH,
    corePath: useSimd ? TESSERACT_CORE_SIMD_PATH : TESSERACT_CORE_FALLBACK_PATH,
    langPath: TESSDATA_BASE_PATH,
    gzip: true
  };
  const worker = await createWorker(options);
  await worker.loadLanguage(lang);
  await worker.initialize(lang);
  return worker;
}

async function ensureWorker(lang: string): Promise<TesseractWorker> {
  if (workerPromise !== null) {
    return workerPromise;
  }

  workerPromise = (async () => {
    const worker = await createNewWorker(lang);
    return worker;
  })().catch(error => {
    workerPromise = null;
    throw error;
  });

  return workerPromise;
}

async function cancelJob(id: string): Promise<void> {
  if (!activeJobs.has(id)) {
    return;
  }

  activeJobs.delete(id);
  inFlightCount = Math.max(0, inFlightCount - 1);

  if (!enablePool || workerPromise === null) {
    return;
  }

  try {
    const worker = await workerPromise;
    try {
      await worker.reset();
    } catch {
      await worker.terminate();
      workerPromise = null;
    }
  } catch {
    workerPromise = null;
  }
}

export function setFlags(flags: { enablePool: boolean; maxConcurrent: number }): void {
  enablePool = flags.enablePool;
  maxConcurrent = flags.maxConcurrent;
}

async function detectSimdSupport(): Promise<boolean> {
  if (simdSupportCache !== null) {
    return simdSupportCache;
  }

  if (typeof WebAssembly === 'undefined') {
    simdSupportCache = false;
    return simdSupportCache;
  }

  const simdModule = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 0, 0, 3, 2, 1, 0, 10, 11, 1, 9, 0, 65, 0, 65, 0, 253, 1, 11
  ]);

  try {
    new WebAssembly.Module(simdModule);
    simdSupportCache = true;
  } catch {
    simdSupportCache = false;
  }
  return simdSupportCache;
}

async function toImageBitmap(payload: ImagePayload): Promise<ImageBitmap> {
  if (payload instanceof ImageBitmap) {
    return payload;
  }

  if (payload instanceof Blob) {
    return createImageBitmap(payload);
  }

  if (payload instanceof ImageData) {
    return createImageBitmap(payload);
  }

  if (payload instanceof OffscreenCanvas) {
    return payload.transferToImageBitmap();
  }

  throw new Error('지원하지 않는 이미지 형식입니다.');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const type = candidate.type;
  if (type === 'cancel' || type === 'get-flags') {
    return typeof candidate.id === 'string';
  }

  if (type === 'ocr') {
    return typeof candidate.id === 'string' && candidate.payload instanceof Object;
  }

  return false;
}

export {};

