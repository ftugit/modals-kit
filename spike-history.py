"""
Спайк модели истории — автопроверка браузером.

Отвечает на 4 вопроса, от которых зависит весь порт:
  1. Уживаются ли URL-цепочка (?modal=) и transient (page.state)?
  2. Переживает ли page.state перезагрузку (F5)?
  3. Работает ли history.go(-n) при n > 1?
  4. Что SvelteKit кладёт в сырой history.state?
"""

from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173/"
results = []


def check(name, actual, expected, note=""):
    ok = actual == expected
    results.append((ok, name, actual, expected, note))
    mark = "OK  " if ok else "FAIL"
    print(f"[{mark}] {name}")
    if not ok:
        print(f"         получено: {actual!r}")
        print(f"         ожидалось: {expected!r}")
    elif note:
        print(f"         {note}")


def state(page):
    return page.evaluate("() => history.state")


def chain_text(page):
    return page.locator("dd.strong").inner_text().strip()


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    pg.goto(BASE, wait_until="networkidle")

    print("\n=== 1. URL-цепочка: зарегистрированные записи ===")
    pg.get_by_role("button", name="+ registered «card»").click()
    pg.wait_for_timeout(120)
    check("одна запись попала в URL", "modal=card" in pg.url, True, pg.url)

    pg.get_by_role("button", name="+ registered «user»").click()
    pg.wait_for_timeout(120)
    check("две записи в URL через запятую", "modal=card%2Cuser" in pg.url or "modal=card,user" in pg.url, True, pg.url)
    check("полная цепочка на экране", chain_text(pg), "card → user")

    print("\n=== 2. transient: история есть, URL не меняется ===")
    url_before = pg.url
    pg.get_by_role("button", name="+ transient (без URL)").click()
    pg.wait_for_timeout(120)
    check("URL НЕ изменился", pg.url, url_before, "transient не сериализуется в адрес")
    check("transient виден в цепочке", chain_text(pg), "card → user → t1*")

    print("\n=== 3. Назад закрывает верхний слой (и transient тоже) ===")
    pg.go_back()
    pg.wait_for_timeout(200)
    check("Назад снял transient", chain_text(pg), "card → user")
    pg.go_forward()
    pg.wait_for_timeout(200)
    check("Вперёд вернул transient", chain_text(pg), "card → user → t1*")

    print("\n=== 4. history.go(-2) через две записи ===")
    pg.get_by_role("button", name="go(-2)").click()
    pg.wait_for_timeout(300)
    check("go(-2) снял два слоя", chain_text(pg), "card")

    print("\n=== 5. ГЛАВНОЕ: переживает ли page.state перезагрузку ===")
    pg.get_by_role("button", name="+ registered «user»").click()
    pg.wait_for_timeout(120)
    pg.get_by_role("button", name="+ transient (без URL)").click()
    pg.wait_for_timeout(150)
    before_chain = chain_text(pg)
    before_raw = state(pg)
    print(f"         до F5: цепочка={before_chain!r}")
    print(f"         до F5: history.state={before_raw}")

    pg.reload(wait_until="networkidle")
    pg.wait_for_timeout(300)
    after_chain = chain_text(pg)
    after_raw = state(pg)
    print(f"         после F5: цепочка={after_chain!r}")
    print(f"         после F5: history.state={after_raw}")

    check(
        "URL-часть цепочки пережила F5",
        after_chain.startswith("card") and "user" in after_chain,
        True,
        "записи из адреса восстановились",
    )
    check(
        "transient НЕ пережил F5 (ожидаемо по докам)",
        "*" in after_chain,
        False,
        "page.state после перезагрузки пуст — это документированное поведение",
    )

    print("\n=== 6. Что SvelteKit кладёт в history.state ===")
    print(f"         {after_raw}")
    keys = list(after_raw.keys()) if isinstance(after_raw, dict) else []
    check("history.state — объект с ключами SvelteKit", any("sveltekit" in k for k in keys), True, str(keys))

    pg.screenshot(path="spike-result.png", full_page=True)
    b.close()

print("\n" + "=" * 62)
ok = sum(1 for r in results if r[0])
print(f"ИТОГО: {ok}/{len(results)} проверок прошло")
print("=" * 62)
for good, name, *_ in results:
    if not good:
        print(f"  ПРОВАЛ: {name}")
