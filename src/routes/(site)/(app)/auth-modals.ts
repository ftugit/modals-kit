// Регистрация модалок пользователя — ОТДЕЛЬНЫМ модулем и ЛЕНИВО: layout ветки
// импортирует его динамически (только в браузере), иначе виджет авторизации и
// его форма ехали бы в чанк раскладки и платили бы все страницы ветки.
// Реестр глобальный; до регистрации ссылка на модалку честно заблокирована
// (`data-pending` у useModalLink) — окно в момент гидратации.
import { registerModal } from '#lib/modals/index.js'
import AuthModal from '#content/user/ui/AuthModal.svelte'
import MenuModal from '#content/user/ui/MenuModal.svelte'

registerModal({
  name: 'user.auth',
  component: AuthModal,
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
  component: MenuModal,
  size: { width: 280, height: 200 },
})
