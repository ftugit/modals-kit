// Composition root: единственное место, которому разрешено собирать фасад
// `auth(event)` из базового слоя и доменных фабрик субмодулей. База о доменах
// не знает; субмодули не знают друг о друге — их связывает этот файл.
import {
  registerProfilesPort,
  registerUserDomain,
} from '#modules/user/base/service/gateway.server.js'
import { createProfilesAdapter } from '#modules/user/profile/service/port.server.js'
import { profileDomain } from '#modules/user/profile/service/gateway.server.js'
import { sessionsDomain } from '#modules/user/sessions/service/gateway.server.js'
import { blocksDomain } from '#modules/user/blocks/service/gateway.server.js'
import { accountsDomain } from '#modules/user/accounts/service/gateway.server.js'

// Порт профиля: без субмодуля база работает с `profiles: undefined`.
registerProfilesPort(() => createProfilesAdapter())

// Доменные методы фасада. Порядок не важен: имена методов не пересекаются.
registerUserDomain(sessionsDomain)
registerUserDomain(profileDomain)
registerUserDomain(blocksDomain)
registerUserDomain(accountsDomain)
