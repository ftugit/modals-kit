import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestEvent } from '@sveltejs/kit'

let mockEnvBudget: number | undefined = 1_200

vi.mock('$app/env/private', () => ({
  get FORM_BODY_LIMIT() {
    return mockEnvBudget
  },
  E2B_SANDBOX_ID: undefined,
  KIT_TRUSTED_ORIGINS: 'http://localhost:5173',
  PREVIEW_PORTS: '5173',
}))

import { buildEnvelope, defineForm, field, v, type Result } from '#lib/form/index.js'
import { componentFormRegistry, registerComponentForm } from './registry.js'
import { createComponentFormsHandle } from './server.server.js'
import { FORM_ID_HEADER } from './transport.js'

function makeEvent(request: Request): RequestEvent {
  return {
    request,
    url: new URL(request.url),
    locals: {},
    params: {},
    route: { id: '/budget-probe' },
    isDataRequest: false,
    isSubRequest: false,
    isRemoteRequest: false,
    getClientAddress: () => '127.0.0.1',
    cookies: {
      get: () => undefined,
      getAll: () => [],
      set: () => {},
      delete: () => {},
      serialize: (k: string, val: string) => `${k}=${val}`,
    },
  } as unknown as RequestEvent
}

describe('сквозной бюджет тела и лимиты приёма в createComponentFormsHandle', () => {
  const probeForm = defineForm({
    id: 'budget_probe',
    revision: 1,
    limits: {
      maxKeys: 8,
      maxValuesPerKey: 2,
    },
    actions: [{ id: 'submit', label: 'Отправить', validate: 'full' }],
    fields: {
      note: field.text({ label: 'Заметка', validate: [v.required()] }),
      tags: field.text({ label: 'Теги', multiple: true }),
    },
  })

  beforeEach(() => {
    mockEnvBudget = 1_200
    componentFormRegistry().clear()
    registerComponentForm({
      description: probeForm,
      async execute({ values, commit }) {
        commit()
        return {
          queued:
            values.note === 'queue-me'
              ? { pollUrl: '/budget-probe?__form_id=budget_probe&__form_task=j1', statusUrl: '/budget-probe?job=j1' }
              : undefined,
          data: { note: values.note },
        }
      },
    })
  })

  it('413 от FORM_BODY_LIMIT из env приходит штатным Result (body.too-large, not-applied) и с JS, и без JS с отменой потока', async () => {
    const handle = createComponentFormsHandle()
    const env = buildEnvelope(
      {
        formId: probeForm.id,
        revision: probeForm.revision,
        instance: 'budget_probe:main',
        submissionId: '11111111-1111-4111-8111-111111111111',
        intent: 'submit',
      },
      probeForm.policy,
    )

    // 1. JS-запрос с заголовком x-form-id и потоком без Content-Length свыше FORM_BODY_LIMIT (1200 Б)
    const bigNote = 'x'.repeat(2_400)
    const params = new URLSearchParams({ ...env, intent: 'submit', note: bigNote })
    const rawBytes = new TextEncoder().encode(params.toString())
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(rawBytes)
        c.close()
      },
    })
    const jsReq = new Request('http://localhost:5173/budget-probe', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        [FORM_ID_HEADER]: probeForm.id,
      },
      body: stream,
      // @ts-expect-error duplex required by Node Request with stream body
      duplex: 'half',
    })

    const jsRes = await handle({
      event: makeEvent(jsReq),
      resolve: async () => new Response('unexpected resolve'),
    })
    expect(jsRes.status).toBe(413)
    const payload = (await jsRes.json()) as { data?: { result?: Result } }
    expect(payload.data?.result?.ok).toBe(false)
    expect(payload.data?.result?.status).toBe(413)
    expect(payload.data?.result?.outcome).toBe('not-applied')
    expect(payload.data?.result?.formId).toBe(probeForm.id)
    expect(payload.data?.result?.errors[0]?.code).toBe('body.too-large')

    // 2. Нативный HTML POST без JS и без x-form-id: огромный поток отменяется после префикса,
    //    а маршрут рендерится inline со статусом 413 и заполненным locals.formResult
    let chunksPulled = 0
    let cancelled = false
    const boundary = '----ModalsKitTestBoundary'
    const prefixPart =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="__form_id"\r\n\r\n${probeForm.id}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="note"\r\n\r\n`
    const prefixBytes = new TextEncoder().encode(prefixPart)
    const chunk64k = new Uint8Array(64 * 1024).fill(65)

    const hugeMultipartStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksPulled++
        if (chunksPulled === 1) {
          controller.enqueue(prefixBytes)
          return
        }
        if (chunksPulled <= 20) {
          controller.enqueue(chunk64k)
          return
        }
        controller.close()
      },
      cancel() {
        cancelled = true
      },
    })

    const htmlReq = new Request('http://localhost:5173/budget-probe', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        accept: 'text/html',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body: hugeMultipartStream,
      // @ts-expect-error duplex required by Node Request with stream body
      duplex: 'half',
    })
    const htmlEvent = makeEvent(htmlReq)
    let resolvedFormResult: Result | undefined
    const htmlRes = await handle({
      event: htmlEvent,
      resolve: async (ev) => {
        resolvedFormResult = (ev.locals as { formResult?: Result }).formResult
        return new Response('<html>rendered-inline</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      },
    })

    expect(cancelled).toBe(true)
    expect(chunksPulled).toBeLessThanOrEqual(3)
    expect(htmlRes.status).toBe(413)
    expect(resolvedFormResult?.formId).toBe(probeForm.id)
    expect(resolvedFormResult?.status).toBe(413)
    expect(resolvedFormResult?.errors[0]?.code).toBe('body.too-large')
  })

  it('413 от меньшего budget формы и от maxValuesPerKey / maxKeys, плюс 303 на statusUrl для queued без JS', async () => {
    mockEnvBudget = 64 * 1024
    const smallBudgetForm = defineForm({
      id: 'tiny_budget',
      revision: 1,
      budget: 320,
      limits: { maxKeys: 7, maxValuesPerKey: 2 },
      actions: [{ id: 'submit', label: 'Отправить', validate: 'full' }],
      fields: {
        note: field.text({ label: 'Заметка', validate: [v.required()] }),
        tags: field.text({ label: 'Теги', multiple: true }),
      },
    })
    registerComponentForm({
      description: smallBudgetForm,
      async execute({ commit }) {
        commit()
        return {}
      },
    })

    const handle = createComponentFormsHandle()
    const envTiny = buildEnvelope(
      {
        formId: smallBudgetForm.id,
        revision: smallBudgetForm.revision,
        instance: 'tiny_budget:main',
        submissionId: '22222222-2222-4222-8222-222222222222',
        intent: 'submit',
      },
      smallBudgetForm.policy,
    )

    // Превышение собственного `budget: 320` при большем `FORM_BODY_LIMIT: 65536`
    const overFormBudget = new URLSearchParams({ ...envTiny, intent: 'submit', note: 'a'.repeat(400) })
    const resBudget = await handle({
      event: makeEvent(
        new Request('http://localhost:5173/budget-probe', {
          method: 'POST',
          headers: {
            origin: 'http://localhost:5173',
            accept: 'application/json',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: overFormBudget.toString(),
        }),
      ),
      resolve: async () => new Response('unexpected'),
    })
    expect(resBudget.status).toBe(413)
    const bodyBudgetJson = (await resBudget.json()) as { data: { result: Result } }
    expect(bodyBudgetJson.data.result.errors[0]?.code).toBe('body.too-large')

    // Превышение `maxValuesPerKey: 2` (3 значения `tags`)
    const overValues = new URLSearchParams(envTiny)
    overValues.set('intent', 'submit')
    overValues.set('note', 'ok')
    overValues.append('tags', 't1')
    overValues.append('tags', 't2')
    overValues.append('tags', 't3')
    const resTooMany = await handle({
      event: makeEvent(
        new Request('http://localhost:5173/budget-probe', {
          method: 'POST',
          headers: {
            origin: 'http://localhost:5173',
            accept: 'application/json',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: overValues.toString(),
        }),
      ),
      resolve: async () => new Response('unexpected'),
    })
    expect(resTooMany.status).toBe(413)
    const tooManyJson = (await resTooMany.json()) as { data: { result: Result } }
    expect(tooManyJson.data.result.errors[0]?.code).toBe('request.too-many')
    expect(tooManyJson.data.result.errors[0]?.params).toEqual({ name: 'tags' })

    // Без JS `outcome: 'queued'` по умолчанию уводит `303 See Other` на `statusUrl`
    const envProbe = buildEnvelope(
      {
        formId: probeForm.id,
        revision: probeForm.revision,
        instance: 'budget_probe:main',
        submissionId: '33333333-3333-4333-8333-333333333333',
        intent: 'submit',
      },
      probeForm.policy,
    )
    const queuedParams = new URLSearchParams({ ...envProbe, intent: 'submit', note: 'queue-me' })
    await expect(
      handle({
        event: makeEvent(
          new Request('http://localhost:5173/budget-probe', {
            method: 'POST',
            headers: {
              origin: 'http://localhost:5173',
              accept: 'text/html',
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: queuedParams.toString(),
          }),
        ),
        resolve: async () => new Response('unexpected'),
      }),
    ).rejects.toMatchObject({ status: 303, location: '/budget-probe?job=j1' })

    // Чужой POST (например, нативный SvelteKit action `/schema`) проходит в `resolve` с нетронутым телом
    let forwardedBody = ''
    const passRes = await handle({
      event: makeEvent(
        new Request('http://localhost:5173/schema', {
          method: 'POST',
          headers: {
            origin: 'http://localhost:5173',
            accept: 'text/html',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: 'secret=my-db-secret',
        }),
      ),
      resolve: async (ev) => {
        forwardedBody = await ev.request.text()
        return new Response('schema-ok', { status: 200 })
      },
    })
    expect(passRes.status).toBe(200)
    expect(forwardedBody).toBe('secret=my-db-secret')
  })
})
