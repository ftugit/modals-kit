<script lang="ts">
  /**
   * Прототип админки на хосте шагов: выбор пользователей списком между
   * этапами (сценарий вида «удаление пользователя»). Доказывает модель
   * механики списка: карточку снаружи не рисует никто, список получает
   * механику строки фабрикой атрибутов — здесь это параметрный выбор:
   * нажатие на строку переключает id юзера в параметре адреса
   * `?picked=id,id` (ссылка `asLink`, без JS — обычная навигация с тем
   * же адресом). Выбор читается из адреса, поэтому переживает шаги,
   * переходы страниц и «назад» без состояния в компонентах. Шаг
   * подтверждения — тот же список со срезом адреса `users.ids`; снятие
   * выбора там — та же механика. ACL по отказу списка рисует носитель.
   */
  import { Steps, stepLink, useSteps } from '#components/steps/index.js'
  import { asLink, type LinkAttrs } from '#hooks/links/index.js'
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import Acl from './Acl.svelte'
  import SeedUsersList from './SeedUsersList.svelte'
  import type { AuthErrorCode } from '../error.js'
  import type { SeedUserView } from '../types.js'

  let acl = $state<AuthErrorCode | null>(null)

  // Видимый адрес читается на каждое использование: это снимок на момент
  // вызова (с учётом мелких записей), а не живой объект.
  // Выбор — параметр адреса: единственный источник правды обоих шагов.
  const picked = $derived(
    new Set((visibleAddress().url.searchParams.get('picked') ?? '').split(',').filter(Boolean)),
  )

  // Механика строки: тот же адрес, но id добавлен в `?picked` или убран.
  // Прочие параметры (шаг, срез списка `users.*`) адрес сохраняет целиком;
  // на шаге подтверждения тот же набор дублируется в срез `users.ids`.
  const toggleAttrs = (user: SeedUserView): LinkAttrs => {
    const url = visibleAddress().url
    const next = new Set(picked)
    if (next.has(user.id)) next.delete(user.id)
    else next.add(user.id)
    const sp = new URLSearchParams(url.searchParams.toString())
    if (next.size) sp.set('picked', [...next].join(','))
    else sp.delete('picked')
    if (sp.has('users.ids')) {
      if (next.size) sp.set('users.ids', [...next].join(','))
      else sp.delete('users.ids')
    }
    return { ...asLink(`${url.pathname}?${sp.toString()}`, { replace: true }), title: 'Выбрать пользователя' }
  }

  // Адрес шага: подтверждение несёт срез `users.ids` (тот же список
  // покажет только выбранных), возврат срез снимает.
  const stepHref = (step: string, withSlice: boolean): string => {
    const url = visibleAddress().url
    const sp = new URLSearchParams(url.searchParams.toString())
    sp.set('upick', step)
    if (withSlice && picked.size) sp.set('users.ids', [...picked].join(','))
    else sp.delete('users.ids')
    return `${url.pathname}?${sp.toString()}`
  }

  const host = useSteps({
    owner: 'user-picker',
    mode: 'url',
    key: 'upick',
    steps: () => [
      { key: 'pick', label: 'Выбор пользователей' },
      { key: 'chosen', label: 'Выбранные' },
    ],
    current: () => visibleAddress().url.searchParams.get('upick') ?? 'pick',
  })
</script>

<section data-testid="user-picker-steps">
  {#if acl}
    <Acl status={acl} backHref="/" />
  {:else}
    <Steps {host} label="Выбор пользователей" nav>
      {#snippet pick()}
        <div class="flex flex-col gap-3">
          <SeedUsersList
            rowAttrs={toggleAttrs}
            isSelected={(id) => picked.has(id)}
            onAcl={(fact) => (acl = fact)}
          />
          <p class="text-sm">
            Выбрано: <span data-testid="user-picker-count">{picked.size}</span>
            <a {...stepLink(host, 'chosen')} href={stepHref('chosen', true)} class="ml-3 font-medium underline underline-offset-4">К выбранным →</a>
          </p>
        </div>
      {/snippet}
      {#snippet chosen()}
        <div class="flex flex-col gap-3">
          {#if picked.size}
            <SeedUsersList
              rowAttrs={toggleAttrs}
              isSelected={() => true}
              onAcl={(fact) => (acl = fact)}
            />
          {:else}
            <p class="text-sm text-muted-foreground">Сначала выберите пользователей на шаге «Выбор пользователей».</p>
          {/if}
          <p class="text-sm">
            <a {...stepLink(host, 'pick')} href={stepHref('pick', false)} class="font-medium underline underline-offset-4">← К выбору</a>
          </p>
        </div>
      {/snippet}
    </Steps>
  {/if}
</section>
