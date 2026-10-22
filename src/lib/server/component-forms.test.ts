import { describe, expect, it } from 'vitest'
import type { Cookies, RequestEvent } from '@sveltejs/kit'
import { buildEnvelope, defineForm, field, v } from '#lib/form/index.js'
import { componentFormsHandle, registerComponentForm } from './component-forms.js'

const embeddedWidgetForm = defineForm({
  id: 'embedded-widget-test',
  revision: 1,
  actions: [{ id: 'save', label: 'Сохранить', validate: 'full' }],
  fields: {
    title: field.text({ label: 'Название', validate: [v.required(), v.minLength(3)] }),
  },
})

registerComponentForm({
  description: embeddedWidgetForm,
  execute: async ({ values, commit }, ev) => {
    ev.cookies.set('session_renewed', String(values.title), { path: '/' })
    commit()
    return { data: { savedTitle: values.title } }
  },
})

function makeCookies(): Cookies {
  const jar = new Map<string, string>()
  return {
    get: (name: string) => jar.get(name),
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      jar.set(name, value)
    },
    delete: (name: string) => {
      jar.delete(name)
    },
    serialize: (name: string, value: string) => `${name}=${encodeURIComponent(value)}`,
  } as unknown as Cookies
}

function makeEvent(url: string, request: Request, cookies: Cookies): RequestEvent {
  return {
    url: new URL(url),
    request,
    cookies,
    locals: {} as App.Locals,
  } as unknown as RequestEvent
}

function makePostRequest(url: string, values: Record<string, string>, accept = 'text/html'): Request {
  const params = new URLSearchParams()
  const env = buildEnvelope({
    formId: embeddedWidgetForm.id,
    revision: embeddedWidgetForm.revision,
    instance: `${embeddedWidgetForm.id}:new`,
    submissionId: crypto.randomUUID(),
  })
  for (const [k, val] of Object.entries(env)) params.set(k, val)
  params.set(embeddedWidgetForm.policy.envelopeKeys.intent, 'save')
  for (const [k, val] of Object.entries(values)) params.set(k, val)

  const u = new URL(url)
  return new Request(url, {
    method: 'POST',
    headers: {
      origin: u.origin,
      accept,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
}

async function catchRedirect(
  fn: () => Response | Promise<Response>,
): Promise<{ status: number; location: string }> {
  try {
    await fn()
    throw new Error('expected redirect')
  } catch (err) {
    const r = err as { status?: number; location?: string }
    if (!r.status || !r.location) throw err
    return { status: r.status, location: r.location }
  }
}

describe('componentFormsHandle — встраиваемая форма возвращает на страницу подключения', () => {
  it('при нативном POST (без JS) с успехом возвращает 303 ровно на страницу, где подключён компонент', async () => {
    const cookies = makeCookies()
    const pageUrl = 'http://localhost:5173/catalog/items?page=3&sort=new'
    const event = makeEvent(pageUrl, makePostRequest(pageUrl, { title: 'Новый ник' }), cookies)

    const redir = await catchRedirect(() =>
      componentFormsHandle({ event, resolve: async () => new Response('unused') }),
    )
    expect(redir).toEqual({
      status: 303,
      location: '/catalog/items?page=3&sort=new',
    })
  })

  it('при нативном POST с ошибкой валидации возвращает 303 на ту же страницу и одноразово поднимает locals.formResult только на ней', async () => {
    const cookies = makeCookies()
    const pageUrl = 'http://localhost:5173/user/profile?tab=avatar'
    const postEvent = makeEvent(pageUrl, makePostRequest(pageUrl, { title: 'а' }), cookies)

    const redir = await catchRedirect(() =>
      componentFormsHandle({ event: postEvent, resolve: async () => new Response('unused') }),
    )
    expect(redir).toEqual({
      status: 303,
      location: '/user/profile?tab=avatar',
    })

    // Следующий GET по той же странице получает сохранённый Result в locals.formResult
    const getEvent = makeEvent(pageUrl, new Request(pageUrl), cookies)
    await componentFormsHandle({ event: getEvent, resolve: async () => new Response('ok') })
    expect(getEvent.locals.formResult?.ok).toBe(false)
    expect(getEvent.locals.formResult?.formId).toBe(embeddedWidgetForm.id)

    // Повторный GET (F5) уже чист — flash строго одноразовый
    const refreshEvent = makeEvent(pageUrl, new Request(pageUrl), cookies)
    await componentFormsHandle({ event: refreshEvent, resolve: async () => new Response('ok') })
    expect(refreshEvent.locals.formResult).toBeNull()
  })

  it('при JS POST (Accept: application/json) возвращает JSON { data: { result } } на любом маршруте', async () => {
    const cookies = makeCookies()
    const pageUrl = 'http://localhost:5173/any/custom/route'
    const event = makeEvent(
      pageUrl,
      makePostRequest(pageUrl, { title: 'Готово' }, 'application/json'),
      cookies,
    )

    const res = await componentFormsHandle({ event, resolve: async () => new Response('unused') })
    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie()).toContain(`session_renewed=${encodeURIComponent('Готово')}`)
    const body = (await res.json()) as { data: { result: { ok: boolean; data: { savedTitle: string } } } }
    expect(body.data.result.ok).toBe(true)
    expect(body.data.result.data.savedTitle).toBe('Готово')
  })
})
