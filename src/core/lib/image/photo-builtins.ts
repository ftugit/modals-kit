// Общие ленивые кодеки для полного и облегчённого входов; без AVIF.
import { registerEncoder } from './registry.js';
import {
  JPEG_CAPABILITIES, JPEG_CHANNELS, JPEG_SUBSAMPLING,
  PNG_CAPABILITIES, PNG_CHANNELS,
  WEBP_CHANNELS, WEBP_SUBSAMPLING, webpCapabilities,
} from './codecs/declarations.js';
import type { Codec, EncodeOptions, Frame } from './types.js';

type LoadedCodec = Required<Pick<Codec, 'encode' | 'decode'>>;
export function lazyCodec(
  meta: Pick<Codec, 'capabilities' | 'channels' | 'subsampling'>,
  load: () => Promise<LoadedCodec>,
): Codec {
  return {
    ...meta,
    async encode(frame: Frame, options?: EncodeOptions): Promise<Blob> {
      return (await load()).encode(frame, options);
    },
    async decode(blob: Blob): Promise<Frame> {
      return (await load()).decode(blob);
    },
  };
}

export function registerPhotoCodecs(): void {
  registerEncoder('image/jpeg', lazyCodec(
    { channels: JPEG_CHANNELS, subsampling: JPEG_SUBSAMPLING, capabilities: JPEG_CAPABILITIES },
    async () => {
      const mod = await import('./codecs/jpeg.js');
      return { encode: mod.jpegCodec.encode, decode: mod.decodeJpeg };
    },
  ));
  registerEncoder('image/png', lazyCodec(
    { channels: PNG_CHANNELS, capabilities: PNG_CAPABILITIES },
    async () => {
      const mod = await import('./codecs/png.js');
      return { encode: mod.pngCodec.encode, decode: mod.decodePng };
    },
  ));
  registerEncoder('image/webp', lazyCodec(
    { channels: WEBP_CHANNELS, subsampling: WEBP_SUBSAMPLING, capabilities: webpCapabilities },
    async () => {
      const mod = await import('./codecs/webp.js');
      return { encode: mod.webpCodec.encode, decode: mod.decodeWebp };
    },
  ));
}

let fullEntryLoaded = false;
export function markFullEntry(): void { fullEntryLoaded = true; }
export function hasFullEntry(): boolean { return fullEntryLoaded; }
