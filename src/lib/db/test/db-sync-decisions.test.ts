/**
 * Формат решений по шагам переноса (`#lib/db/sync/decisions.js`): `<choice>|<key>`
 * и путь нативной формы `step:<key>`.
 *
 * Обе дороги обязаны давать ОДИН `Resolution`, а всё, что не является решением,
 * обязано отвергаться здесь — до БД. Иначе битое значение уезжает в `sync`
 * мусорным ключом (так и было с разбором через `indexOf("|")` без проверок).
 */
import assert from "node:assert/strict";
import { it } from "vitest";
import {
  KEEP,
  decisionValue,
  decisionsFrom,
  decisionsFromForm,
  parseDecision,
} from "../sync/index";

const KEY = 'rename_or_replace:"public"."post":label';

it("значение поля: сборка и разбор — взаимно обратны, ключ с : \" . едет целиком", () => {
  for (const choice of ["apply", "rename", "replace", KEEP] as const) {
    const raw = decisionValue(choice, KEY);
    assert.deepEqual(parseDecision(raw), { choice, key: KEY });
  }
  // ключ не режется по разделителям внутри себя
  assert.equal(decisionValue("rename", KEY), `rename|${KEY}`);
});

it("значение поля: всё, что не решение, — отказ, а не мусор в БД", () => {
  for (const bad of ["apply", "|" + KEY, "apply|", "", "drop table|" + KEY, "APPLY|" + KEY])
    assert.equal(parseDecision(bad), null, bad);
  for (const bad of [undefined, null, 42, ["apply"], new File([], "f")])
    assert.equal(parseDecision(bad), null, String(bad));
});

it("сборка отвергает пустой ключ и неизвестное решение", () => {
  assert.throws(() => decisionValue("apply", ""), TypeError);
  assert.throws(() => decisionValue("drop table" as never, KEY), TypeError);
});

it("решения из значений формы: ключ берётся из карты сервера, а не из значения", () => {
  const fieldToKey = { s0: KEY, s1: 'extra_column:"public"."post":legacy' };
  const { decisions, problems } = decisionsFrom(
    {
      s0: decisionValue("rename", KEY),
      s1: "apply", // без разделителя — битое значение
      token: "секрет", // не поле шага
    },
    fieldToKey,
  );
  assert.deepEqual(decisions, { [KEY]: "rename" });
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /s1/);
});

it("решения из значений формы: keep пропускается, чужой ключ — в problems", () => {
  const fieldToKey = { s0: KEY };
  const kept = decisionsFrom({ s0: decisionValue(KEEP, KEY) }, fieldToKey);
  assert.deepEqual(kept.decisions, {});
  assert.deepEqual(kept.problems, []);

  // Экран устарел: в значении шаг, которого в свежем отчёте уже нет.
  const stale = decisionsFrom({ s0: decisionValue("rename", 'extra_column:"public"."post":old') }, fieldToKey);
  assert.deepEqual(stale.decisions, {});
  assert.equal(stale.problems.length, 1);
  assert.match(stale.problems[0]!, /old/);
});

it("решения из значений формы: принимает пары и Map, а пустое значение — «не трогать»", () => {
  const fieldToKey = { s0: KEY };
  assert.deepEqual(decisionsFrom([[ "s0", "" ]], fieldToKey).decisions, {});
  assert.deepEqual(decisionsFrom(new Map([["s0", undefined]]), fieldToKey).decisions, {});
  assert.deepEqual(decisionsFrom([["s0", decisionValue("apply", KEY)]], fieldToKey).decisions, {
    [KEY]: "apply",
  });
});

it("нативная форма без lib/form: только поля step:* с известным решением", () => {
  const data = new FormData();
  data.append("token", "x");
  data.append("step:" + KEY, "rename");
  data.append('step:extra_column:"public"."post":legacy', "");
  data.append('step:change_type:"public"."post":n', "drop table");
  data.append("step:", "apply");
  assert.deepEqual(decisionsFromForm(data), { [KEY]: "rename" });
});
