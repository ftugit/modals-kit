// Точка входа библиотеки.
//
// Ядро лёгкое: статический импорт этого модуля НЕ тащит ни один кодек и ни
// квантование. Встроенные кодеки регистрируются здесь ленивыми обёртками —
// реальные модули (и их wasm) подгружаются динамическим импортом при первом
// использовании. Регистрация — тот же публичный registerEncoder, что и у
// потребителя: jpeg и png ничем не привилегированы, их можно заменить.

import { registerEncoder } from './registry.js';
import { AVIF_CHANNELS, AVIF_SUBSAMPLING, avifCapabilities } from './codecs/declarations.js';
import { lazyCodec, registerPhotoCodecs, markFullEntry } from './photo-builtins.js';
import type { PngOptimizeOptions, PngOptimizeResult } from './types.js';

export { image } from './pipeline.js';
export {
  createEncoderRegistry,
  defaultEncoderRegistry,
  registerEncoder,
  unregisterEncoder,
  getEncoder,
  findEncoder,
  registeredFormats,
} from './registry.js';
export {
  EnvironmentError,
  UnknownFormatError,
  UnsupportedChannelError,
  UnsupportedOptionError,
  InvalidOptionsError,
  FitBudgetExhaustedError,
  ResourceLimitError,
} from './errors.js';
export type { FitBudgetReason } from './errors.js';
// Чистые утилиты кадра: пригодятся потребительским кодекам и тестам.
export {
  analyzeFrame,
  applyFrameGeometry,
  resizeBilinear,
  resizeLanczos3,
  resizeArea,
  sharpenFrame,
  toGrayscale,
  probeSaturation,
  MONOCHROME_SATURATION_THRESHOLD,
  frameToImageData,
  imageDataToFrame,
  cloneFrame,
} from './frame.js';
// Объективные метрики искажения (цена сжатия в числах).
export {
  compareFrames,
  computeAlphaMAE,
  computeMAE,
  computePremultipliedMAE,
  computePSNR,
  computeSSIM,
} from './metrics.js';
export type { FrameMetrics, MetricOptions } from './metrics.js';
export type { FrameAnalysis, FrameAnalysisOptions } from './frame.js';
// Стартовые пресеты энкодеров по итогам исследования оптимизаторов.
export { PRESETS } from './presets.js';
export type { PresetName } from './presets.js';
export type {
  Frame,
  FrameOptions,
  ResizeMethod,
  SharpenOptions,
  QuantizeOptions,
  PaletteAlgorithm,
  ColorDistanceFormula,
  EncodeOptions,
  ChromaSubsampling,
  Codec,
  CodecCapabilities,
  CodecCapabilitiesResolver,
  CodecQualityRole,
  Decoder,
  EncoderRegistry,
  PngOptimizeOptions,
  PngOptimizeResult,
  PngOptimizerEngine,
  FitSpec,
  FitDimension,
  FitDimensionValue,
  FitOptions,
  FitPlaneContext,
  FitProbe,
  FitProbeOutcome,
  FitQualityStrategy,
  FitStrategy,
  FitStrategyContext,
  FitStrategyHit,
  FitStrategyObject,
  FitMonotonicity,
  FitWarning,
  FitWarningCode,
  FitParams,
  FitResult,
  FitStrategyName,
  ImageOptions,
  Pipeline,
  PipelineEvent,
  StateListener,
} from './types.js';

/**
 * Lossless-оптимизировать готовый PNG-Blob.
 *
 * По умолчанию используется oxipng/wasm. С `engine:'compression-stream'`
 * динамически грузится отдельный модуль без wasm, который пережимает
 * только IDAT и сохраняет остальные PNG-чанки байт-в-байт.
 *
 * @param blob - готовый PNG-Blob.
 * @param options - движок и параметры оптимизации (см. PngOptimizeOptions).
 * @returns результат: Blob (оптимизированный или оригинал), размеры, движок.
 * @throws InvalidOptionsError, если вход не PNG или опции несовместимы с движком.
 */
export async function optimizePngBlob(
  blob: Blob,
  options?: PngOptimizeOptions,
): Promise<PngOptimizeResult> {
  if (options?.engine === 'compression-stream') {
    const mod = await import('./optimizers/png-compression-stream.js');
    return mod.optimizePngBlobWithCompressionStream(blob, options);
  }
  const mod = await import('./codecs/png.js');
  return mod.optimizePngBlob(blob, options);
}

// Полный фасад сохраняет исходную регистрацию всех форматов.
registerPhotoCodecs();
registerEncoder('image/avif', lazyCodec(
  { channels: AVIF_CHANNELS, subsampling: AVIF_SUBSAMPLING, capabilities: avifCapabilities },
  async () => {
    const mod = await import('./codecs/avif.js');
    return { encode: mod.avifCodec.encode, decode: mod.decodeAvif };
  },
));
markFullEntry();
