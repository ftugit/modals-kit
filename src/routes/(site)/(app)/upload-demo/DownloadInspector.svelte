<script lang="ts">
  import { Button } from '#components/ui/index.js'
  import type { UploadDemoValues } from './demo-schema.js'
  import type { UploadedDemoRecord } from './forms.js'

  let {
    item,
    demo,
  }: {
    item: UploadedDemoRecord
    demo: UploadDemoValues
  } = $props()

  interface RangeCheckSummary {
    readonly ok: boolean
    readonly headStatus: number
    readonly acceptRanges: string
    readonly csp: string
    readonly rangeHeader: string
    readonly rangeStatus: number
    readonly contentRange: string
    readonly receivedBytes: number
    readonly expectedBytes: number
    readonly notModifiedStatus: number | null
    readonly disposition: string
    readonly elapsedMs: number
    readonly acrossSplitSeam: boolean
    readonly error?: string
  }

  interface ConcurrencyCheckSummary {
    readonly mode: string
    readonly stream1: string
    readonly stream2: string
    readonly elapsedMs: number
  }

  let checkingRange = $state(false)
  let rangeSummary = $state<RangeCheckSummary | null>(null)

  let checkingConcurrency = $state(false)
  let concurrencySummary = $state<ConcurrencyCheckSummary | null>(null)

  function buildInspectUrl(extra: Record<string, string>): string {
    const base = item.url.split('?')[0] ?? `/api/files/${item.path}`
    const params = new URLSearchParams()
    if (demo.dl_mode === 'attachment') {
      params.set('download', '1')
      params.set('name', item.filename)
    }
    if (demo.dl_rate !== 'default') {
      params.set('rate', demo.dl_rate)
    }
    if (demo.dl_concurrency !== 'default') {
      params.set('concurrency', demo.dl_concurrency)
    }
    for (const [k, v] of Object.entries(extra)) {
      params.set(k, v)
    }
    const qs = params.toString()
    return qs ? `${base}?${qs}` : base
  }

  async function runRangeAndHeadersCheck(): Promise<void> {
    if (checkingRange) return
    checkingRange = true
    rangeSummary = null
    const t0 = performance.now()
    try {
      const targetUrl = buildInspectUrl({})
      const headRes = await fetch(targetUrl, { method: 'HEAD' })
      const etag = headRes.headers.get('etag')

      // Для нарезанного файла (> 512 КБ на shard_a + shard_b) берём срез прямо поперёк стыка первой и второй части!
      const isSplit = (item.partsCount ?? 1) > 1
      const splitSeam = item.firstPartBytes ?? 512 * 1024
      let start = 0
      let end = Math.max(0, Math.min(item.size - 1, 63))
      let acrossSeam = false
      if (isSplit && item.size > splitSeam + 32) {
        start = splitSeam - 32
        end = Math.min(item.size - 1, splitSeam + 31)
        acrossSeam = true
      }

      const rangeHeader = item.size > 0 ? `bytes=${start}-${end}` : 'bytes=0-0'
      const rangeRes =
        item.size > 0
          ? await fetch(targetUrl, { headers: { Range: rangeHeader } })
          : await fetch(targetUrl)
      const sliceBuf = new Uint8Array(await rangeRes.arrayBuffer())
      const expectedBytes = item.size > 0 ? end - start + 1 : 0

      let notModifiedStatus: number | null = null
      if (etag) {
        const condRes = await fetch(targetUrl, {
          headers: { 'If-None-Match': etag },
        })
        notModifiedStatus = condRes.status
      }

      const ok =
        headRes.status === 200 &&
        (item.size > 0 ? rangeRes.status === 206 : rangeRes.status === 200) &&
        sliceBuf.byteLength === expectedBytes &&
        (notModifiedStatus === null || notModifiedStatus === 304)

      rangeSummary = {
        ok,
        headStatus: headRes.status,
        acceptRanges: headRes.headers.get('accept-ranges') ?? '—',
        csp: headRes.headers.get('content-security-policy') ?? '—',
        rangeHeader,
        rangeStatus: rangeRes.status,
        contentRange: rangeRes.headers.get('content-range') ?? '—',
        receivedBytes: sliceBuf.byteLength,
        expectedBytes,
        notModifiedStatus,
        disposition: rangeRes.headers.get('content-disposition') ?? 'inline',
        elapsedMs: Math.round(performance.now() - t0),
        acrossSplitSeam: acrossSeam,
      }
    } catch (err) {
      rangeSummary = {
        ok: false,
        headStatus: 0,
        acceptRanges: '—',
        csp: '—',
        rangeHeader: '—',
        rangeStatus: 0,
        contentRange: '—',
        receivedBytes: 0,
        expectedBytes: 0,
        notModifiedStatus: null,
        disposition: '—',
        elapsedMs: Math.round(performance.now() - t0),
        acrossSplitSeam: false,
        error: err instanceof Error ? err.message : String(err),
      }
    } finally {
      checkingRange = false
    }
  }

  async function runConcurrencyCheck(): Promise<void> {
    if (checkingConcurrency) return
    checkingConcurrency = true
    concurrencySummary = null
    const t0 = performance.now()
    const mode = demo.dl_concurrency === 'default' ? 'reject_1' : demo.dl_concurrency
    const urlA = buildInspectUrl({ rate: '65536', concurrency: mode, _s: '1' })
    const urlB = buildInspectUrl({ rate: '65536', concurrency: mode, _s: '2' })
    const probeSliceEnd = Math.max(0, Math.min(item.size - 1, 65535))
    const probeHeaders = item.size > 0 ? { Range: `bytes=0-${probeSliceEnd}` } : undefined

    async function drainOne(u: string): Promise<string> {
      try {
        const res = await fetch(u, probeHeaders ? { headers: probeHeaders } : undefined)
        if (!res.ok) {
          return `HTTP ${res.status}`
        }
        const buf = await res.arrayBuffer()
        return `HTTP ${res.status} (${buf.byteLength} Б)`
      } catch {
        return 'прерван (preempt / abort)'
      }
    }

    try {
      const p1 = drainOne(urlA)
      await new Promise((r) => setTimeout(r, 25))
      const p2 = drainOne(urlB)
      const [s1, s2] = await Promise.all([p1, p2])
      concurrencySummary = {
        mode,
        stream1: s1,
        stream2: s2,
        elapsedMs: Math.round(performance.now() - t0),
      }
    } finally {
      checkingConcurrency = false
    }
  }
</script>

<div class="flex w-full flex-col gap-2 border-t border-border/60 pt-2">
  <div class="flex flex-wrap items-center gap-2">
    <Button
      type="button"
      variant="outline"
      size="sm"
      onclick={runRangeAndHeadersCheck}
      disabled={checkingRange}
      data-testid="verify-download-btn"
    >
      {checkingRange
        ? 'Проверка…'
        : (item.partsCount ?? 1) > 1
          ? 'Проверить склейку (HEAD + Range 206 по шву + 304)'
          : 'Проверить скачивание (HEAD + Range 206 + 304)'}
    </Button>

    <Button
      type="button"
      variant="ghost"
      size="sm"
      onclick={runConcurrencyCheck}
      disabled={checkingConcurrency}
      data-testid="verify-concurrency-btn"
    >
      {checkingConcurrency
        ? 'Запуск 2 потоков…'
        : `Тест 2 потоков (${demo.dl_concurrency === 'default' ? 'reject_1 → 429' : demo.dl_concurrency})`}
    </Button>
  </div>

  {#if rangeSummary}
    <div
      class={`flex flex-col gap-0.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] ${
        rangeSummary.ok
          ? 'border-border bg-card text-success'
          : 'border-border bg-card text-destructive'
      }`}
      data-testid="download-check-result"
      data-check-ok={rangeSummary.ok ? 'true' : 'false'}
    >
      <div>
        HEAD:{rangeSummary.headStatus} ·
        Range({rangeSummary.rangeHeader}){rangeSummary.acrossSplitSeam ? ' [поперёк стыка серверов]' : ''}:
        HTTP {rangeSummary.rangeStatus} ({rangeSummary.receivedBytes}/{rangeSummary.expectedBytes} Б, {rangeSummary.contentRange}) ·
        ETag 304:{rangeSummary.notModifiedStatus ?? '—'} ·
        {rangeSummary.elapsedMs} мс
      </div>
      <div class="truncate opacity-85">
        Disposition: {rangeSummary.disposition} · CSP: {rangeSummary.csp}
      </div>
      {#if rangeSummary.error}
        <div>{rangeSummary.error}</div>
      {/if}
    </div>
  {/if}

  {#if concurrencySummary}
    <div
      class="rounded border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-[11px]"
      data-testid="concurrency-check-result"
    >
      Режим <strong>{concurrencySummary.mode}</strong> ({concurrencySummary.elapsedMs} мс) —
      поток #1: <strong>{concurrencySummary.stream1}</strong> ·
      поток #2: <strong>{concurrencySummary.stream2}</strong>
    </div>
  {/if}
</div>
