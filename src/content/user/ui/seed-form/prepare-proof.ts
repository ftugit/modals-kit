// Клиентская подготовка криптографического доказательства владения `seed` перед отправкой формы.
//
// В браузере с включённым JS приватный 32-байтный `secret` НИКОГДА не уходит по сети:
// из него локально выводятся публичный ключ `seedOf(secret)` и одноразовая подпись
// `sign(challengeToken, secret)`, после чего поле `seed` в отправляемой `FormData`
// перезаписывается публичным ключом (состояние поля в памяти формы при этом не меняется).
import { seedOf, sign } from '../../keys.js'

export async function prepareSeedProof(fd: FormData, challengeToken: string): Promise<void> {
  const typed = String(fd.get('seed') ?? '').trim()
  fd.set('seed', typed)
  fd.set('public_seed', '')
  if (typed.length >= 43 && typed.length <= 44 && challengeToken !== '') {
    try {
      const pub = await seedOf(typed)
      const sig = await sign(challengeToken, typed)
      fd.set('seed', pub)
      fd.set('public_seed', pub)
      fd.set('signature', sig)
    } catch {
      /* некорректный формат ключа — сервер отклонит с auth.signature */
    }
  }
}
