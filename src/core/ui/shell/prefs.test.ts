// Настройки каркаса в cookie (B11): разбор не доверяет значению, запись читается сервером.
import { describe, expect, it } from 'vitest'
import { hasShellCookie, parseShellPrefs, SHELL_COOKIE, shellCookieString } from './prefs'

describe('настройки каркаса: cookie (B11)', () => {
  it('разбор берёт только допустимые поля', () => {
    expect(parseShellPrefs('{"dock":"bottom","side":"right","snap":false}'))
      .toEqual({ dock: 'bottom', side: 'right', snap: false })
    expect(parseShellPrefs('{"dock":"middle","side":"right","snap":"yes"}')).toEqual({ side: 'right' })
    expect(parseShellPrefs('{"dock":1}')).toBeUndefined()
    expect(parseShellPrefs('не json')).toBeUndefined()
    expect(parseShellPrefs('null')).toBeUndefined()
    expect(parseShellPrefs(undefined)).toBeUndefined()
  })

  it('записанная cookie раскодируется так же, как cookies.get на сервере', () => {
    const line = shellCookieString({ dock: 'bottom', side: 'right', snap: false })
    const [pair, ...attrs] = line.split('; ')
    expect(pair.startsWith(`${SHELL_COOKIE}=`)).toBe(true)
    expect(attrs).toEqual(expect.arrayContaining(['Path=/', 'SameSite=Lax']))
    const value = decodeURIComponent(pair.slice(SHELL_COOKIE.length + 1))   // правило cookie.parse
    expect(parseShellPrefs(value)).toEqual({ dock: 'bottom', side: 'right', snap: false })
    expect(/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/.test(pair.slice(SHELL_COOKIE.length + 1)))
      .toBe(true)                                                              // RFC 6265 cookie-octet
  })

  it('наличие cookie определяется по имени, а не по подстроке', () => {
    expect(hasShellCookie(`a=1; ${SHELL_COOKIE}=x`)).toBe(true)
    expect(hasShellCookie(`x${SHELL_COOKIE}=1; b=2`)).toBe(false)
    expect(hasShellCookie('')).toBe(false)
  })
})
