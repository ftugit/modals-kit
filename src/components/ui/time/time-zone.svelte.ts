/**
 * ТОЧКА ДОСТУПА к часовому поясу всего сайта.
 *
 * Сейчас управления поясом нет (владелец: «пока не делай») — значение по
 * умолчанию `undefined`, то есть системный пояс браузера/сервера, как было
 * у всех `toLocaleString()` до этого модуля. Когда понадобится «играть с
 * поясом во всём сайте сразу», это единственное место, куда пишется
 * значение: `setSiteTimeZone('Europe/Moscow')` — и каждый `TimeAgo` на
 * сайте перерисуется (состояние реактивно). Выставлять значение на старте
 * должен каркас (`AppShell`/корневой layout) до гидратации — тогда SSR и
 * клиент начнут с одного пояса; источник значения (кука, как у
 * `ShellPrefs`, настройка профиля и т.п.) — решение той будущей задачи.
 */
class SiteTimeZoneState {
  /** IANA-имя пояса (`Europe/Moscow`, `UTC`); `undefined` — системный. */
  timeZone = $state<string | undefined>(undefined)

  setTimeZone(timeZone: string | undefined): void {
    this.timeZone = timeZone || undefined
  }
}

/** Единое состояние пояса на весь сайт. */
export const siteTimeZone = new SiteTimeZoneState()

/** Задать пояс всему сайту (`undefined` — вернуть системный). */
export function setSiteTimeZone(timeZone: string | undefined): void {
  siteTimeZone.setTimeZone(timeZone)
}

/** Текущий пояс сайта; `undefined` — системный. */
export function getSiteTimeZone(): string | undefined {
  return siteTimeZone.timeZone
}
