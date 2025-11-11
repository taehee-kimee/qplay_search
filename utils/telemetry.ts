import { getFeatureFlags } from './featureFlags';

interface TelemetryEvent {
  readonly event: string;
  readonly ocr_ms?: number;
  readonly search_ms?: number;
  readonly candidates?: number;
  readonly score_top1?: number;
  readonly margin?: number;
  readonly used?: 'fast' | 'legacy';
  readonly fallback_reason?: string;
  readonly userAgent?: string;
  readonly timestamp: number;
}

const TELEMETRY_BUFFER: TelemetryEvent[] = [];
const MAX_BUFFER_SIZE = 100;
const FLUSH_INTERVAL_MS = 30000;

let flushTimer: number | null = null;

export function logTelemetry(event: Partial<TelemetryEvent>): void {
  const flags = getFeatureFlags();
  if (!flags.enableTelemetry) {
    return;
  }

  const fullEvent: TelemetryEvent = {
    event: event.event ?? 'unknown',
    timestamp: Date.now(),
    userAgent: navigator.userAgent,
    ...event
  };

  TELEMETRY_BUFFER.push(fullEvent);
  if (TELEMETRY_BUFFER.length > MAX_BUFFER_SIZE) {
    TELEMETRY_BUFFER.shift();
  }

  if (flushTimer === null) {
    flushTimer = window.setTimeout(flushTelemetry, FLUSH_INTERVAL_MS);
  }
}

function flushTelemetry(): void {
  if (TELEMETRY_BUFFER.length === 0) {
    flushTimer = null;
    return;
  }

  const events = [...TELEMETRY_BUFFER];
  TELEMETRY_BUFFER.length = 0;

  try {
    fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events })
    }).catch(() => {
      TELEMETRY_BUFFER.unshift(...events);
    });
  } catch {
    TELEMETRY_BUFFER.unshift(...events);
  }

  flushTimer = null;
}

export function getTelemetryBuffer(): readonly TelemetryEvent[] {
  return TELEMETRY_BUFFER;
}


