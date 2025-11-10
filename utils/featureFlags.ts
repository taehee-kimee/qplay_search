export interface FeatureFlags {
  readonly enableOcrPool: boolean;
  readonly enableFastSearch: boolean;
  readonly enableShadowTest: boolean;
  readonly enableTelemetry: boolean;
  readonly maxConcurrentOcr: number;
}

const DEFAULT_FLAGS: FeatureFlags = {
  enableOcrPool: false,
  enableFastSearch: false,
  enableShadowTest: false,
  enableTelemetry: false,
  maxConcurrentOcr: 1
};

function getMaxConcurrent(): number {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
  return isMobile ? 1 : 2;
}

export function getFeatureFlags(): FeatureFlags {
  const params = new URLSearchParams(location.search);
  const storage = typeof localStorage !== 'undefined' ? localStorage : null;

  const enableOcrPool =
    params.get('ocr_pool') === '1' ||
    storage?.getItem('qplay:ocr_pool') === '1' ||
    false;

  const enableFastSearch =
    params.get('fast') === '1' ||
    storage?.getItem('qplay:fastsearch') === '1' ||
    false;

  const enableShadowTest =
    params.get('shadow') === '1' ||
    storage?.getItem('qplay:shadow_test') === '1' ||
    false;

  const enableTelemetry =
    params.get('telemetry') === '1' ||
    storage?.getItem('qplay:telemetry') === '1' ||
    false;

  return {
    enableOcrPool,
    enableFastSearch,
    enableShadowTest,
    enableTelemetry,
    maxConcurrentOcr: getMaxConcurrent()
  };
}

