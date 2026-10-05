import { createFileRoute } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import type { Result } from '@modals-kit/form'
import { createSolidForm, type SolidFieldView } from '@modals-kit/form/tanstack/solid'
import { submitSignup } from '../lib-form/server'
import { FORM_INSTANCE, constraintRows, externalPreview, renderMessage, signupForm } from '../lib-form/shared'

export const Route = createFileRoute('/')({ component: SolidStartFormDemo })

const useSignupForm = createSolidForm({
  instance: FORM_INSTANCE,
  render: renderMessage,
  invalidFrom: 'fact',
  onErrors(errors) {
    // Как и в React/Svelte демо: внешний Luhn уводим из показа, но факт остаётся.
    return errors.filter((error) => error.code !== 'external.LUHN_FAILED')
  },
})

function SolidStartFormDemo() {
  const form = useSignupForm(signupForm, {
    submitOnServer: (data) => submitSignup({ data }) as Promise<Result<{ saved: true; received: Record<string, unknown> }>>,
  })

  return (
    <main class="page">
      <header class="hero">
        <p class="eyebrow">TanStack Start · Solid</p>
        <h1>lib form без Svelte: Solid-адаптер и та же форма</h1>
        <p>
          Страница использует только ядро из <code>src/lib/form</code>: описание формы,
          HTML-атрибуты, локальную проверку и повторную серверную проверку через
          <code> createServerFn</code>. CSS и UI-примитивы из основного проекта не импортируются.
        </p>
      </header>

      <section class="grid">
        <form {...form.formProps()} class="card form-card">
          <For each={form.hidden()}>{(hidden) => <input {...hidden} />}</For>
          <h2>Регистрация</h2>
          <Show when={form.common().length > 0}>
            <div class="alert" role="alert">
              <For each={form.common()}>{(error) => <p>{error.message}</p>}</For>
            </div>
          </Show>

          <TextField view={form.field('email')} type="email" />
          <TextField view={form.field('password')} type="password" />
          <TextField view={form.field('confirm')} type="password" />
          <TextField view={form.field('age')} type="number" />
          <TextField view={form.field('rating')} type="range" />
          <TextField view={form.field('tax_id')} />
          <TextField view={form.field('card')} inputMode="numeric" />
          <CheckboxField view={form.field('agree')} />

          <div class="actions">
            <button {...form.intent('submit')} type="submit">
              <Show when={form.state.pending()} fallback="Создать аккаунт">Отправляем…</Show>
            </button>
            <button {...form.intent('save-draft')} type="submit" class="secondary">
              Сохранить черновик
            </button>
          </div>
        </form>

        <aside class="card">
          <h2>Что демонстрируется</h2>
          <ul>
            <li>общий <code>signupForm</code> импортируется и в клиент, и в серверную функцию;</li>
            <li>свой тип <code>rating</code> добавляет <code>input[type=range]</code>;</li>
            <li>валидатор ИНН отдаёт <code>pattern</code>, Luhn работает без атрибута;</li>
            <li>пароль фильтруется из <code>values</code> как <code>secret</code>;</li>
            <li>внешняя служба нормализуется в ошибки <code>email</code>/<code>card</code>.</li>
          </ul>
          <h3>Последний результат</h3>
          <pre>{JSON.stringify(form.state.result() ?? { values: form.state.values() }, null, 2)}</pre>
        </aside>
      </section>

      <section class="card">
        <h2>Ограничения → HTML-атрибуты</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Поле</th><th>Ограничение</th><th>Атрибуты поля</th><th>Почему не атрибут</th></tr></thead>
            <tbody>
              <For each={constraintRows()}>{(row) => (
                <tr>
                  <td>{row.field}</td><td>{row.constraint}</td><td>{row.attr}</td><td>{row.skipped || '—'}</td>
                </tr>
              )}</For>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card two-cols">
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

function TextField(props: { view: SolidFieldView; type?: string; inputMode?: 'text' | 'search' | 'email' | 'tel' | 'url' | 'numeric' | 'none' | 'decimal' }) {
  const attrs = () => props.view.inputProps()
  return (
    <div class="field" data-invalid={props.view.hasError() || undefined}>
      <label {...props.view.labelProps()}>{props.view.descriptor.label ?? props.view.descriptor.name}</label>
      <input {...attrs()} type={props.type ?? String(attrs().type ?? 'text')} inputMode={props.inputMode} />
      <Show when={props.view.descriptor.help}><small {...props.view.helpProps()}>{props.view.descriptor.help}</small></Show>
      <Show when={props.view.errors().length > 0}>
        <p class="error" {...props.view.errorProps()}>{props.view.errors().map((e) => e.message).join(' · ')}</p>
      </Show>
    </div>
  )
}

function CheckboxField(props: { view: SolidFieldView }) {
  return (
    <div class="check" data-invalid={props.view.hasError() || undefined}>
      <input {...props.view.inputProps()} type="checkbox" />
      <label {...props.view.labelProps()}>{props.view.descriptor.label}</label>
      <Show when={props.view.errors().length > 0}>
        <p class="error" {...props.view.errorProps()}>{props.view.errors().map((e) => e.message).join(' · ')}</p>
      </Show>
    </div>
  )
}
