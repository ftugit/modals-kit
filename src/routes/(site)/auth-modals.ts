// Регистрация модалок пользователя в глобальной области. Импорт модуля —
// сайд-эффект: ES-модуль исполняется один раз на среду (SSR отдельно, браузер
// отдельно), поэтому повторного объявления реестр не увидит. Компоненты —
// ленивые обёртки (`*ModalLazy`): deep-link `?modal=user.auth` разрешается
// сразу (определение статическое), а тяжёлое содержимое (виджет, bind+Form,
// конвейер аватара) приезжает отдельным чанком — раскладка ветки за него
// не платит.
import { registerModal } from '#lib/modals/index.js'
import AuthModalLazy from '#content/user/ui/AuthModalLazy.svelte'
import MenuModalLazy from '#content/user/ui/MenuModalLazy.svelte'
import ProfileModalLazy from '#content/user/ui/ProfileModalLazy.svelte'

registerModal({
  name: 'user.auth',
  component: AuthModalLazy,
  route: '/user/auth',
  size: { width: 420, height: 480 },
  // loader НЕ нужен: данные (challenge, пределы, вход) берёт загрузчик самой
  // страницы — силами ядра через preload маршрута (`loader.ts` §deps.preload);
  // свой fetch дублировал бы его и падал на HTML (page-роут не отвечает json).
})
registerModal({
  name: 'user.profile',
  component: ProfileModalLazy,
  route: '/user/profile',
  size: { width: 420, height: 420 },
})
registerModal({
  name: 'user.menu',
  component: MenuModalLazy,
  size: { width: 280, height: 200 },
})
