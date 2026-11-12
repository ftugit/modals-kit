// Общий журнал устройств (`/sessions`) — все сессии, которые зритель вправе
// читать (право `session.read`). Свой список и устройства одного аккаунта
// живут рядом: `/user/sessions` и `/user/<uuid>/sessions`.
import type { PageServerLoad } from './$types'
import { loadSessionsRouteData } from '#content/user/ui/sessions-list/load.server.js'

export const load: PageServerLoad = async (event) => loadSessionsRouteData(event, null, true)
