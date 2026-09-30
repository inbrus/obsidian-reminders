# obsidian-reminders — решения проекта (decisions)

Канонические решения, зафиксированные Johan 30-09-2026. Этот файл — traceability для Orca и community-ревью: rationale живет здесь, а не только во внутреннем vault.

## Цель и идентичность

1. Цель — публикация в community-реестр Obsidian.
2. Репозиторий: `inbrus/obsidian-reminders` (public).
3. Финальное имя и id плагина — `obsidian-reminders`.
4. Версия — `1.0.0`.
5. `minAppVersion` — `1.13.0`.
6. `isDesktopOnly: false`.

## Шкала приоритетов

🔺=1 · ⏫=2 · 🔼=3 · ↔️=4 · 🔽=5 · ⏬=6 (эмодзи остаются on-disk форматом, в UI — Lucide-иконки).

## Целевая архитектура (консенсус ресерча)

- TypeScript strict (ES2020) + esbuild, без рантайм-фреймворка.
- Гексагон `core/ports/infra/app/ui`, ноль рантайм-зависимостей.
- Типизированная событийная шина вместо ручных refreshViews.
- Инкрементальный персистентный индекс (отдельный файл, не `data.json`).
- Двухчастная идентичность: `stableId` (blockId) + `location` (path+line).
- `core/` не импортирует `obsidian`; единственный слой с `import "obsidian"` — инфраструктура.

## Процесс рефакторинга

- 6 фаз (0–5), каждая — отдельная ветка + PR, merge после гейта.
- Баг-фиксы сразу в новой архитектуре, без отдельного этапа.
- APPROVE/REWORK/STOP по фазам ставит агент автономно; Johan — только эскалация (когда агент не знает правильного ответа) + ручной прогон desktop+mobile.
- Тесты: Vitest + eslint-plugin-obsidianmd (CI-gate).

См. также `docs/spec.md` (полная спецификация) после прохождения босс-теста.

## Фаза 0 — отложенное (не в scope, зафиксировано 30-09-2026)

Фаза 0 закрыта коммитом `6e0de4f`: tooling + golden-тесты + канонические фиксы.
35 тестов зелёные, сборка зелёная, lint 0 ошибок. Остались 5 warnings — осознанно
отложены, это не Фаза 0:

1. `obsidianmd/ui/sentence-case` ×4 (settings.ts:472,473,496,497) — строки UI ещё
   говорят `Taskgregator` / `Tasks`; требуют переименования бренда в
   `Obsidian Reminders` (отдельный трек, не tooling-фаза).
2. `obsidianmd/settings-tab/no-deprecated-display` (settings.ts:344) — метод
   `display()` устарел при `minAppVersion 1.13.0` + `getSettingDefinitions()`,
   но удалять его сейчас нельзя: он несёт кнопку Reindex. Удаляется в Фазе 2
   (перенос настроек на declarative API).

Незакоммиченного в ветке `refactor/phase-0-tooling` не осталось.
