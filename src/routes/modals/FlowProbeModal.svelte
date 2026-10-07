<script lang="ts">
  import type { MobileAnchor } from '$lib/modals'
  import { useModal, useModals } from '$lib/modals/svelte'
  import { modalTriggerVariants } from '$lib/ui/modals'

  const m = useModals()
  const me = useModal()
  const ANCHORS: readonly MobileAnchor[] = ['top', 'bottom', 'left', 'right']

  let lastRandom = $state<MobileAnchor | null>(null)
  let plainTransientResult = $state('не проверено')

  /** Выбирает одно из четырёх явных мобильных направлений для probe-сценария. */
  function randomAnchor(): MobileAnchor {
    return ANCHORS[Math.floor(Math.random() * ANCHORS.length)]
  }

  /** Открывает зарегистрированную probe-модалку с собственным случайным направлением. */
  function openRandomModal() {
    const mobile = randomAnchor()
    lastRandom = mobile
    m.modals.open('flow-probe', { mobile })
  }

  /** Открывает зарегистрированную probe-модалку без override, чтобы она унаследовала якорь. */
  function openInheritedModal() {
    m.modals.open('flow-probe')
  }

  /** Открывает transient-слой без mobile override, чтобы проверить наследование активной записи. */
  function openPlainTransient() {
    m.modals.openLayer({ content: plainTransient })
  }

  /** Открывает transient-слой с собственным случайным направлением. */
  function openRandomTransient() {
    const mobile = randomAnchor()
    lastRandom = mobile
    m.modals.openLayer({ content: randomTransient, mobile })
  }

  /**
   * Проверяет попытку положить зарегистрированную модалку над transient без
   * stack:'new' и сохраняет наблюдаемый результат прямо в transient-слое.
   */
  function openRegisteredFromPlainTransient() {
    try {
      m.modals.open('flow-probe')
      plainTransientResult = 'open() завершился без исключения'
    } catch (error) {
      plainTransientResult = error instanceof Error ? error.message : String(error)
    }
  }
</script>

<div class="flex flex-col gap-3.5 p-5 [&_h2]:m-0 [&_p]:m-0" data-flow-probe="" data-probe-index={me.index}>
  <h2>Проверка наследования потока</h2>
  <p class="text-[0.85rem] text-muted-foreground">
    Запись {me.index + 1} из {me.depth}; собственное направление:
    <b>{me.resolved.mobile ?? 'нет'}</b>.
  </p>

  <div class="flex flex-wrap gap-2.5">
    <button type="button" class={modalTriggerVariants()} data-probe-action="random-modal" onclick={openRandomModal}>
      Открыть с случайным направлением
    </button>
    <button type="button" class={modalTriggerVariants()} data-probe-action="inherited-modal" onclick={openInheritedModal}>
      Открыть без направления
    </button>
    <button type="button" class={modalTriggerVariants()} data-probe-action="plain-transient" onclick={openPlainTransient}>
      Без хранилища
    </button>
    <button type="button" class={modalTriggerVariants()} data-probe-action="random-transient" onclick={openRandomTransient}>
      Без хранилища со случайным направлением
    </button>
  </div>

  {#if lastRandom}
    <p class="text-[0.85rem] text-muted-foreground" data-probe-random={lastRandom}>Последнее случайное направление: {lastRandom}</p>
  {/if}
</div>

{#snippet plainTransient()}
  <div class="flex flex-col gap-3.5 p-5 [&_h2]:m-0 [&_p]:m-0" data-flow-probe-transient="plain">
    <h2>Модалка без хранилища</h2>
    <p class="text-[0.85rem] text-muted-foreground">У этой записи нет собственного направления.</p>
    <button
      type="button"
      class={modalTriggerVariants()}
      data-probe-action="registered-from-transient"
      onclick={openRegisteredFromPlainTransient}
    >
      Открыть обычную модалку без параметров
    </button>
    <p class="text-[0.85rem] text-muted-foreground" data-probe-registered-result>{plainTransientResult}</p>
  </div>
{/snippet}

{#snippet randomTransient()}
  <div class="flex flex-col gap-3.5 p-5 [&_h2]:m-0 [&_p]:m-0" data-flow-probe-transient="random">
    <h2>Модалка без хранилища со случайным направлением</h2>
    <p class="text-[0.85rem] text-muted-foreground" data-probe-random={lastRandom ?? undefined}>
      Собственное направление: {lastRandom ?? 'нет'}.
    </p>
  </div>
{/snippet}

