/**
 * `#lib/image/state.js` — телеметрия конвейера поверх `options.state`.
 *
 * Коллектор не управляет сжатием: он только складывает синхронные события
 * ядра в замороженный снапшот (`subscribe`/`getSnapshot`/`reset`). Проверки
 * держат три вещи, ради которых модуль и существует: попытки кодека с
 * байтами и миллисекундами, диагноз `fit` и изоляцию потребителя от сбоев.
 */
import { describe, expect, it, vi } from 'vitest';
import { createStateCollector } from './state.js';
import type { PipelineEvent } from './types.js';

/** Слушатель с управляемыми часами: тайминги проверяются без ожиданий. */
function clocked() {
  let now = 0;
  const collector = createStateCollector({ now: () => now });
  return {
    collector,
    advance(ms: number) {
      now += ms;
    },
    send(event: PipelineEvent) {
      collector.listener(event);
    },
  };
}

describe('createStateCollector', () => {
  it('проходит конвейер: стадии, размеры кадра, насыщенность и итог', () => {
    const { collector, advance, send } = clocked();
    expect(collector.getSnapshot()).toMatchObject({ status: 'idle', stage: 'idle', attempts: [] });

    send({ type: 'decode-start' });
    advance(5);
    send({ type: 'decode-done', width: 800, height: 600 });
    advance(5);
    send({ type: 'frame', width: 256, height: 256, fit: 'cover', method: 'lanczos3' });
    advance(5);
    send({ type: 'probe', saturation: 0.1, monochrome: true });
    advance(10);
    send({ type: 'done' });

    const snap = collector.getSnapshot();
    expect(snap).toMatchObject({
      status: 'done',
      stage: 'done',
      width: 256,
      height: 256,
      saturation: 0.1,
      monochrome: true,
      timings: { elapsedMs: 25 },
    });
    // Время по стадиям: 5 + 5 + 5 + 10 между событиями.
    expect(snap.timings.stages).toMatchObject({
      'decode-start': 5,
      'decode-done': 5,
      'frame': 5,
      probe: 10,
    });
  });

  it('складывает попытки кодека: размер, качество, длительность, вердикт предиката', () => {
    const { collector, advance, send } = clocked();
    send({ type: 'fit-start', formats: ['image/jpeg'], planes: 1, gridSize: 8, ownerLoopUpperBound: 8 });
    send({ type: 'encode', format: 'image/jpeg', quality: 0.8, attempt: 1 });
    advance(7);
    send({ type: 'encode-done', format: 'image/jpeg', size: 900, quality: 0.8, attempt: 1, fits: false });
    send({ type: 'encode', format: 'image/jpeg', quality: 0.6, attempt: 2 });
    advance(3);
    send({ type: 'encode-done', format: 'image/jpeg', size: 400, quality: 0.6, attempt: 2, fits: true });
    send({ type: 'fit-done', hit: true, attempts: 2 });
    advance(1);
    send({ type: 'done' });

    const snap = collector.getSnapshot();
    expect(snap.attempts).toHaveLength(2);
    expect(snap.attempts[0]).toMatchObject({
      format: 'image/jpeg',
      quality: 0.8,
      size: 900,
      fits: false,
      attempt: 1,
      durationMs: 7,
    });
    expect(snap.attempts[1]).toMatchObject({ quality: 0.6, size: 400, fits: true, durationMs: 3 });
    expect(snap.fit).toMatchObject({ formats: ['image/jpeg'], gridSize: 8, hit: true, attempts: 2 });
  });

  it('исчерпание бюджета fit и предупреждения попадают в снапшот', () => {
    const { collector, send } = clocked();
    send({ type: 'fit-start', formats: ['image/webp'], planes: 2, gridSize: 4, ownerLoopUpperBound: 8, maxAttempts: 3 });
    send({ type: 'warning', warning: { code: 'unsupported-subsampling', message: 'нет', values: ['420'] } });
    send({ type: 'encode', format: 'image/webp', attempt: 1 });
    send({ type: 'encode-done', format: 'image/webp', size: 1, attempt: 1 });
    send({ type: 'fit-exhausted', reason: 'max-attempts', attempts: 3, elapsedMs: 120 });
    send({ type: 'done' });

    const snap = collector.getSnapshot();
    expect(snap.fit).toMatchObject({ exhaustedReason: 'max-attempts', exhaustedElapsedMs: 120, maxAttempts: 3 });
    expect(snap.warnings).toEqual([{ code: 'unsupported-subsampling', message: 'нет', values: ['420'] }]);
  });

  it('ошибка конвейера не теряется и не глушится', () => {
    const { collector, send } = clocked();
    const boom = new Error('boom');
    send({ type: 'decode-start' });
    send({ type: 'error', error: boom });
    expect(collector.getSnapshot()).toMatchObject({ status: 'error', stage: 'error', error: boom });
  });

  it('подписчики получают снапшот после каждого события; их сбой не рвёт конвейер', () => {
    const { collector, send } = clocked();
    const seen: string[] = [];
    const off = collector.subscribe((snap) => {
      seen.push(snap.stage);
      throw new Error('подписчик упал');
    });
    send({ type: 'decode-start' });
    send({ type: 'done' });
    off();
    send({ type: 'decode-start' });
    expect(seen).toEqual(['decode-start', 'done']);
  });

  it('снапшот иммутабелен снаружи: мутация не меняет следующий', () => {
    const { collector, send } = clocked();
    send({ type: 'fit-start', formats: ['image/jpeg'], planes: 1, gridSize: 2, ownerLoopUpperBound: 2 });
    send({ type: 'encode', format: 'image/jpeg', attempt: 1 });
    const first = collector.getSnapshot();
    expect(() => (first.attempts as unknown as unknown[]).push({})).toThrow(TypeError);
    expect(collector.getSnapshot().attempts).toHaveLength(1);
  });

  it('reset возвращает idle, сохраняя подписки; новый запуск начинает новый снимок', () => {
    const { collector, send } = clocked();
    const spy = vi.fn();
    collector.subscribe(spy);
    send({ type: 'decode-start' });
    send({ type: 'done' });
    collector.reset();
    expect(collector.getSnapshot()).toMatchObject({ status: 'idle', stage: 'idle', attempts: [] });
    expect(spy).toHaveBeenCalled();

    send({ type: 'decode-start' });
    expect(collector.getSnapshot().status).toBe('running');
  });

  it('повторный запуск после done начинается с чистого снимка', () => {
    const { collector, send } = clocked();
    send({ type: 'encode', format: 'image/jpeg', attempt: 1 });
    send({ type: 'done' });
    expect(collector.getSnapshot().attempts).toHaveLength(1);
    send({ type: 'decode-start' });
    expect(collector.getSnapshot().attempts).toHaveLength(0);
  });
});
