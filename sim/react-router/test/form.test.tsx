/**
 * Form core under React: fields and attributes from the description, the local
 * check is the server's `evaluate`, the real server handler answers in-process,
 * texts come from an app dictionary (no lib edits).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { defineForm, field, v, type FormError } from '#lib/form/index.js'
import { handlerTransport, SimForm } from '../src/form'
import { mount, settle } from './harness'

const signup = defineForm({
  id: 'sim-signup',
  fields: {
    email: field.email({ label: 'Email', validate: [v.required(), v.email('html5'), v.maxLength(40)] }),
    name: field.text({ label: 'Name', validate: [v.required(), v.minLength(2)] }),
  },
})

/** English texts from the app — the lib ships Russian defaults. */
const en = {
  required: 'Required',
  email: 'Not an email',
  minLength: (p: Record<string, unknown>) => `At least ${p['min']} characters`,
}

const executed = vi.fn()
const transport = handlerTransport(
  signup,
  ({ values, commit, fail }) => {
    executed(values)
    if (values['email'] === 'taken@example.com') {
      const taken: FormError = {
        id: 'email:taken:0',
        code: 'taken',
        path: 'email',
        message: 'Already registered',
        origin: 'external',
      }
      fail([taken])
    }
    commit()
    return {}
  },
  en,
)

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
  executed.mockClear()
})

async function setup() {
  const errors: string[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => void errors.push(args.join(' ')))
  const view = await mount(<SimForm description={signup} transport={transport} messages={en} submitLabel="Sign up" />)
  cleanups.push(async () => {
    await view.unmount()
    spy.mockRestore()
  })
  const input = (name: string) => view.el.querySelector<HTMLInputElement>(`input[name="${name}"]`)!
  const errorOf = (name: string) => view.el.querySelector(`[data-field="${name}"] [data-error]`)?.textContent ?? null
  async function fill(values: Record<string, string>) {
    for (const [k, val] of Object.entries(values)) input(k).value = val
  }
  async function submit() {
    const form = view.el.querySelector('form')!
    await act(async () => {
      form.requestSubmit()
    })
    await settle(8)
  }
  return { view, input, errorOf, fill, submit, reactErrors: errors }
}

describe('form under React', () => {
  it('draws fields with the projected attributes in React casing, without React warnings', async () => {
    const t = await setup()
    const email = t.input('email')
    expect(email.type).toBe('email')
    expect(email.getAttribute('maxlength')).toBe('40')
    expect(email.required).toBe(true)
    expect(t.input('name').getAttribute('minlength')).toBe('2')
    expect(t.view.el.querySelector('label[for="f-email"]')?.textContent).toBe('Email')
    expect(t.reactErrors).toEqual([])
  })

  it('an invalid submit is stopped locally with app texts; the server is not called', async () => {
    const t = await setup()
    await t.fill({ email: 'nope', name: 'a' })
    await t.submit()
    expect(t.errorOf('email')).toBe('Not an email')
    expect(t.errorOf('name')).toBe('At least 2 characters')
    expect(t.input('email').getAttribute('aria-invalid')).toBe('true')
    expect(executed).not.toHaveBeenCalled()
  })

  it('a valid submit reaches the server handler', async () => {
    const t = await setup()
    await t.fill({ email: 'new@example.com', name: 'Ann' })
    await t.submit()
    expect(executed).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@example.com', name: 'Ann' }))
    expect(t.view.el.querySelector('form')?.getAttribute('data-status')).toBe('success')
    expect(t.errorOf('email')).toBeNull()
  })

  it('a server error lands on its field', async () => {
    const t = await setup()
    await t.fill({ email: 'taken@example.com', name: 'Ann' })
    await t.submit()
    expect(executed).toHaveBeenCalledOnce()
    expect(t.errorOf('email')).toBe('Already registered')
    expect(t.view.el.querySelector('form')?.getAttribute('data-status')).toBe('error')
  })
})
