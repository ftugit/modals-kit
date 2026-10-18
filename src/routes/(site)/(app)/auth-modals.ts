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

registerModal({
  name: 'user.auth',
  component: AuthModalLazy,
  route: '/user/auth',
  size: { width: 420, height: 480 },
  loader: async () => {
    // те же данные, что у роута: challenge, пределы конфига, текущий вход
    const response = await fetch('/user/auth', { headers: { accept: 'application/json' } })
    return response.json()
  },
})
registerModal({
  name: 'user.menu',
  component: MenuModalLazy,
  size: { width: 280, height: 200 },
})
