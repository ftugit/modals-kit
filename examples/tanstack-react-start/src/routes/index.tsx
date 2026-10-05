import { createFileRoute } from '@tanstack/react-router'
import type { HTMLAttributes } from 'react'
import type { Result } from '@modals-kit/form'
import { createReactForm, type ReactFieldView } from '@modals-kit/form/tanstack/react'
import { submitSignup } from '../lib-form/server'
import { FORM_INSTANCE, constraintRows, externalPreview, renderMessage, signupForm } from '../lib-form/shared'

export const Route = createFileRoute('/')({ component: ReactStartFormDemo })

const useSignupForm = createReactForm({
  instance: FORM_INSTANCE,
  render: renderMessage,
  invalidFrom: 'fact',
  onErrors(errors) {
    // Демо той же идеи, что в Svelte-странице: часть ошибок можно забрать из показа,
    // но поле останется невалидным, пока invalidFrom = 'fact'.
    return errors.filter((error) => error.code !== 'external.LUHN_FAILED')
  },
})

function ReactStartFormDemo() {
  const form = useSignupForm(signupForm, {
    submitOnServer: (data) => submitSignup({ data }) as Promise<Result<{ saved: true; received: Record<string, unknown> }>>,
  })

  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">TanStack Start · React</p>
        <h1>lib form без Svelte: свой адаптер и та же форма</h1>
        <p>
          Страница использует только ядро из <code>src/lib/form</code>: описание формы,
          HTML-атрибуты, локальную проверку и повторную серверную проверку через
          <code> createServerFn</code>. CSS и UI-примитивы из основного проекта не импортируются.
        </p>
      </header>

      <section className="grid">
        <form {...form.formProps} className="card form-card">
          {form.hidden().map((hidden) => <input key={hidden.name} {...hidden} />)}
          <h2>Регистрация</h2>
          {form.common.length > 0 && (
            <div className="alert" role="alert">
              {form.common.map((error) => <p key={error.id}>{error.message}</p>)}
            </div>
          )}

          <TextField view={form.field('email')} type="email" />
          <TextField view={form.field('password')} type="password" />
          <TextField view={form.field('confirm')} type="password" />
          <TextField view={form.field('age')} type="number" />
          <TextField view={form.field('rating')} type="range" />
          <TextField view={form.field('tax_id')} />
          <TextField view={form.field('card')} inputMode="numeric" />
          <CheckboxField view={form.field('agree')} />

          <div className="actions">
            <button {...form.intent('submit')} type="submit">
              {form.state.pending ? 'Отправляем…' : 'Создать аккаунт'}
            </button>
            <button {...form.intent('save-draft')} type="submit" className="secondary">
              Сохранить черновик
            </button>
          </div>
        </form>

        <aside className="card">
          <h2>Что демонстрируется</h2>
          <ul>
            <li>общий <code>signupForm</code> импортируется и в клиент, и в серверную функцию;</li>
            <li>свой тип <code>rating</code> добавляет <code>input[type=range]</code>;</li>
            <li>валидатор ИНН отдаёт <code>pattern</code>, Luhn работает без атрибута;</li>
            <li>пароль фильтруется из <code>values</code> как <code>secret</code>;</li>
            <li>внешняя служба нормализуется в ошибки <code>email</code>/<code>card</code>.</li>
          </ul>
          <h3>Последний результат</h3>
          <pre>{JSON.stringify(form.state.result ?? { values: form.state.values }, null, 2)}</pre>
        </aside>
      </section>

      <section className="card">
        <h2>Ограничения → HTML-атрибуты</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Поле</th><th>Ограничение</th><th>Атрибуты поля</th><th>Почему не атрибут</th></tr></thead>
            <tbody>
              {constraintRows().map((row, index) => (
                <tr key={`${row.field}-${row.constraint}-${index}`}>
                  <td>{row.field}</td><td>{row.constraint}</td><td>{row.attr}</td><td>{row.skipped || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card two-cols">
        <div>
          <h2>Неродные поля → родные</h2>
          <p>
            Внешняя служба возвращает <code>user_email</code> и <code>card_number</code>,
            а обработчик видит уже <code>email</code> и <code>card</code>.
          </p>
        </div>
        <pre>{JSON.stringify(externalPreview(true), null, 2)}</pre>
      </section>
    </main>
  )
}

function TextField({ view, type, inputMode }: { view: ReactFieldView; type?: string; inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'] }) {
  const attrs = view.inputProps
  return (
    <div className="field" data-invalid={view.hasError || undefined}>
      <label {...view.labelProps}>{view.descriptor.label ?? view.descriptor.name}</label>
      <input {...attrs} type={type ?? String(attrs.type ?? 'text')} inputMode={inputMode} />
      {view.descriptor.help && <small {...view.helpProps}>{view.descriptor.help}</small>}
      {view.errors.length > 0 && <p className="error" {...view.errorProps}>{view.errors.map((e) => e.message).join(' · ')}</p>}
    </div>
  )
}

function CheckboxField({ view }: { view: ReactFieldView }) {
  return (
    <div className="check" data-invalid={view.hasError || undefined}>
      <input {...view.inputProps} type="checkbox" />
      <label {...view.labelProps}>{view.descriptor.label}</label>
      {view.errors.length > 0 && <p className="error" {...view.errorProps}>{view.errors.map((e) => e.message).join(' · ')}</p>}
    </div>
  )
}
