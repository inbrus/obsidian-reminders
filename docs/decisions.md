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

## Фаза 1 — ядро `core/` (коммит `d5f99bd`)

Вынесена чистая, не зависящая от Obsidian логика в `src/core/`:

- `models.ts`, `parser.ts` (parseLine/deriveBucket/nodeKeyForFile), `line-transforms.ts`,
  `date.ts`, `metadata-codec.ts`, `status-registry.ts`, `query.ts`, `context.ts`, `identity.ts`.
- `src/`-файлы стали тонкими шайбами-реэкспортами; vault-bound I/O остался на месте.
- Критерий: `core/` тестируемо без Obsidian-стаба и без `DEFAULT_SETTINGS`
  (`tests/core.test.ts` импортирует только `src/core/`).
- 48 тестов, lint 0 ошибок, build зелёный, поведение byte-идентично.

## Фаза 2 — порты и DI

Введён гексагон `core/ports/infra/services`; composition root собран в `main.ts`.

**Порты (`ports/`, чистые интерфейсы):**
- `IVaultAdapter` — `scopedFiles/read/exists/process/create/createFolder/listFolder/openFile`.
- `IClock` — `now/todayIso/offsetDays` (локальный календарь, без UTC-дрейфа).
- `ILinkResolver` — `resolve(link, fromPath)`.

**Инфраструктура (`infra/`, единственный слой с `import "obsidian"`):**
- `ObsidianVaultAdapter` (implements `IVaultAdapter` + `ILinkResolver`) — здесь все
  `vault.*`, `metadataCache.*`, и каждый `instanceof TFile/TFolder`. Единственный
  `instanceof`-гейт в `src/` — метод `isMarkdownFile`.
- `ObsidianClock` (implements `IClock`).

**Сервисы (`services/`, зависят только от портов):**
- `SidecarService` — find/create sidecar; чистая сборка YAML/имени — в `core/sidecar.ts`.
- `TaskWriter` (тонкий) — применяет чистые `core/line-transforms` через `IVaultAdapter.process`.
- `VaultScanner` — scan vault → TaskItem[] через адаптер + `core/parser`.

**Изменения поведения:**
- `TaskStore`/`computeContext` больше не держат `App` — линковка через `ILinkResolver`.
- UTC-баг «сегодня» починен: `store.overdue/dueToday/dueTomorrow/dueSoon/aging` и
  `contextView.filterByDue` теперь считают по локальному календарю (`IClock`/`localISODate`).
- `saveSettings` больше не мутирует `store.settings`/`writer.settings` по ссылке —
  настройки передаются в конструктор.
- `instanceof TFile/TFolder` убран из `main.ts` (обработчик vault-событий → `adapter.isMarkdownFile`).

**Гейт:** 53 теста (добавлен `tests/ports.test.ts` — SidecarService/TaskWriter/TaskStore/
VaultScanner на фейковом адаптере+часах), lint 0 ошибок, build зелёный,
`core+ports+services` не импортируют `obsidian`.

**Отложено (осознанно):**
- `ViewDeps` (колбеки view↔main) выпиливается в Фазе 3 вместе с событийной шиной.
- Замороженный снапшот настроек (SettingsService) — Фаза 4.
- `display()` в settings.ts (1 warning) — удаляется при переходе настроек на declarative API.

## Фаза 3 — событийная шина и UiStateStore

Ручные колбеки (`refreshViews`/`rerenderAll`/`rerenderList`/`ViewDeps.rerender`) заменены
типизированной шиной событий.

**Шина (`services/event-bus.ts`, чистая, без `obsidian`):**
- `index:updated` (`{ full: boolean }`) — индекс пересобран (reindex/reindexFile).
- `settings:changed` — настройки сохранены.
- `selection:changed` / `search:changed` — UI-селекция/поиск.
- `file:changed` (`{ path: string | null }`) — смена активного файла.

**UiStateStore (`services/selection.ts`):**
- Заменяет `TaskgregatorState` (`src/state.ts` удалён). Держит `selection`, `searchQuery`,
  `sortBy`, `sortDir`, `sortExplicit`, `groupBy`, `collapsed`; сеттеры `selection`/`searchQuery`
  эмитят события в шину, поэтому view реагируют декларативно, без явных `render()`.

**View/context:** `TaskgregatorView`/`TaskgregatorNavView`/`TaskgregatorContextView` подписываются
на шину в `onOpen` и отписываются в `onClose`. `ViewDeps` больше не несёт `rerender`/`refresh`/
`rerenderAll`/`rerenderList` — остались только команды-контроллеры (`reindex`, `reindexFile`,
`openList`, `getNote`). Резолв активного файла вынесен в `adapter.getNote(path): TFile | null`,
так что `instanceof TFile/TFolder` по-прежнему живёт только в `infra/obsidian-vault-adapter.ts`.

**MenuBuilder (`editor/menu.ts`):** оба меню — editor context menu (`main.ts`) и task-row menu
(`ui.ts`) — собираются из одного реестра `ActionDescriptor[]` через `buildMenu` (submenu +
flat-fallback в одном месте). Дубль priority/due/tag/note-действий устранён; общий
`priorityActions()` для submenu приоритетов.

**Гейт:** 53 теста, lint 0 ошибок / 5 отложенных warnings, build зелёный,
`core+ports+services` не импортируют `obsidian`, `instanceof` только в адаптере.

## Фаза 4 — индекс и идентичность

**Двухчастная идентичность (`core/identity.ts`):** `id` больше не зависит от строки.
`stableIdFor` = `path#^blockId` при наличии blockId, иначе `path#<content-fingerprint>`
(FNV-1a от `path + status + нормализованного тела`). `line` — это location, не identity.
`TaskItem.contentHash` добавлен; `parseLine` вычисляет `stableId`/`contentHash`.

**Инкрементальный индекс (`TaskStore`):** инвертированные индексы
`byFile/byTag/byLink/byDue/byStatus/byBlockId`; `applyFile(path)`/`removeFile(path)`
обновляют один файл без полного перескана; `counts()` — один проход по
open∪inProgress. `IVaultAdapter.stat` + `VaultScanner.scanFile`/`listFiles`.

**События vault (`main.ts`):** modify/create → `applyFile`, delete → `removeFile`,
rename → `removeFile(old)+applyFile(new)`, батчинг с дебаунсом 600 мс.
`reindexFile` точечный; `activateView` без полного rebuild; `saveSettings`
переиндексирует только при смене scope-ключей (`bucketRoots/inboxRoots/ignorePaths`).

**IndexPersistence (`services/index-persistence.ts` + `ports/storage.ts`):** кеш
`IndexSnapshot {schemaVersion, files{path:{mtime,tasks}}, builtAt}` в отдельном файле
`<plugin-dir>/index.cache.json` (не `data.json`), через `IStorage`/`ObsidianStorage`.
На старте файлы с неизменившимся mtime восстанавливаются из кеша, остальные
перечитываются. Кеш не авторитетен — markdown остаётся источником истины.

**Стабильность связей:** `findLine` разрешает строку в порядке blockId → content-hash
→ rawText → text; жадный `ensureBlockId` ставит blockId при первом контакте со sidecar
(уже был в писателе). sidecar-связь переживает сдвиг строк и правку текста.

**Гейт:** 63 теста, lint 0 ошибок / 5 отложенных warnings, build зелёный,
`core+ports+services` без `obsidian`, `instanceof` только в адаптере.

**IdentityMigration (`services/identity-migration.ts`):** sidecar-frontmatter получает
`schemaVersion: 1`; `parseSidecarFrontmatter` читает `blockId`/`sourcePath`/`title`.
Команды «Repair identities (dry-run)» и «Repair identities» сверяют каждый sidecar с
исходной строкой: stamp schemaVersion, backfill `^blockId` (по title-совпадению),
помечают осиротевшие. Dry-run по умолчанию; запись идемпотентна (не трогает формат
markdown, кроме добавления `^blockId`). Форк уже на blockId-схеме — legacy line-id
данных нет, поэтому reconcile ограничен backfill + orphan-разметкой.

## Фаза 5 — иконки и финал

**IconRegistry (`core/icon-map.ts` + `setIcon`):** эмодзи остаются on-disk форматом
(Tasks-plugin interop); UI рендерит Lucide-иконки через единый `iconForEmoji`
(📅→calendar, 🛫→plane, ⏳→hourglass, ➕→plus, ✅→check-check, ❌→ban, 🔁→repeat,
🌱→sprout, 📝→sticky-note). Переведены чипы дат/возраста/заметки (`ui.ts`) и
inline-иконка заметки (`main.ts`, `livePreview.ts`). Приоритеты остаются цветными
кругами (не эмодзи). Данные не меняются — меняется только представление.

**Аудит lint:** 0 ошибок / 0 warnings. `sentence-case` получает `ignoreWords`
(`Taskgregator`/`Tasks` — собственные имена); legacy `display()` удалён — настройки
полностью рендерятся через `getSettingDefinitions()` (minAppVersion 1.13.0),
«Reindex now» переведён в `SettingDefinitionAction`.

**Byte-идентичность (`tests/line-transforms.test.ts`):** 10 тестов фиксируют точный
байтовый вывод записи (due/start/priority/tag/blockId) и идемпотентность — повторная
запись не дублирует и не переставляет signifier'ы; смена статуса чистит устаревшие
даты в обоих форматах.

**Гейт:** 73 теста, lint 0/0, build зелёный, `core/ports/services` без `obsidian`,
`instanceof` только в адаптере, UI-рендер без текстовых эмодзи.

**Ручной прогон (Johan):** desktop + mobile — собрать `main.js`, проверить
чипы/иконки и settings-вкладку.
