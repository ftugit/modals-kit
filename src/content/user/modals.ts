// Регистрация модалок пользователя в глобальной области. Импорт модуля —
// сайд-эффект: ES-модуль исполняется один раз на среду (SSR отдельно, браузер
// отдельно), поэтому повторного объявления реестр не увидит. Компоненты —
// ленивые обёртки (`*ModalLazy`): deep-link `?modal=user.auth` разрешается
// сразу (определение статическое), а тяжёлое содержимое (виджет, bind+Form,
// конвейер аватара) приезжает отдельным чанком — раскладка ветки за него
// не платит. Связка с маршрутами идёт через штатный `route: *.href` без
// перекрёстных импортов между ядрами `#lib/modals` и `#lib/address`.
import { registerModal } from '#lib/modals/index.js'
import { userAuthRoute, userMenuRoute } from './routes.js'
import AuthModalLazy from './ui/AuthModalLazy.svelte'
import MenuModalLazy from './ui/MenuModalLazy.svelte'

registerModal({
  name: 'user.auth',
  component: AuthModalLazy,
  route: userAuthRoute.href,
  size: { width: 420, height: 480 },
})
registerModal({
  name: 'user.menu',
  component: MenuModalLazy,
  route: userMenuRoute.href,
  size: { width: 280, height: 200 },
})
