# Changelog

## 2.3.1

Feature release. Taskgregator now speaks both task metadata dialects, so it fits whichever one you (and the Tasks plugin) already use. Requested in [#1](https://github.com/philpalmieri/obsidian-taskgregator/issues/1).

### Added
- **Dataview inline-field format support.** Taskgregator reads task metadata written as Dataview inline fields (`[due:: 2026-07-29]`, `[priority:: high]`, `[start:: ]`, `[scheduled:: ]`, `[completion:: ]`, `[cancelled:: ]`, `[repeat:: ]`) in addition to the Tasks-plugin emoji signifiers (📅 ⏳ 🛫 🔺 ⏫ 🔼 ✅ ❌ 🔁). Dates, priority, recurrence, and done/cancelled state now populate from either dialect, so every smart list, filter, sort, and grouping works the same regardless of how a task was written.
- **"Task metadata format" setting** `[Auto, Emoji, Dataview]` (default **Auto**). Controls the format Taskgregator *writes* when you set a date or priority from the right-click menus. **Auto** follows the Tasks plugin's own configured format (loosely coupled by reading its saved setting), falling back to emoji when Tasks isn't installed.

### Changed
- **Writing preserves each line's existing format.** An emoji task stays emoji and a Dataview task stays Dataview when you edit it; only a task with no metadata yet uses your chosen format. You never get a line with the two dialects mixed together.

### Notes
- Non-breaking. Reading is purely additive, and existing emoji users on the default Auto setting get byte-identical output. Tasks remain plain markdown checkboxes; nothing about existing lines changes until you edit them.

## 2.2.1

Compliance fix for the community-plugin review. No functional changes.

### Fixed
- **iOS compatibility.** The inline tag renderer no longer uses a regex lookbehind (unsupported on iOS before 16.4). It now consumes the leading boundary and re-emits it, matching the parser's tag pattern; behavior is unchanged on desktop.
- **No direct style assignment.** The navigator's tree rows now set indentation via `setCssStyles` instead of assigning to `el.style`, satisfying `obsidianmd/no-static-styles-assignment`.

## 2.2.0

Feature release. Tags become first-class navigation, and you can jump straight into Taskgregator on startup.

### Added
- **All Tags folder in the navigator.** Under Lists there's a collapsible **All Tags** folder that rolls up every task carrying a `#tag`, treated just like a context folder. It shows a total badge, and each tag below it has its own count. Click a tag to open a list scoped to that tag; click the folder header for the combined view. Collapse it like any other node.
- **Load Taskgregator on startup.** A new setting, **Load Taskgregator on startup** `[Disabled, Today, All, Flagged]`, opens the task list to the chosen view when the vault loads, so you land in your tasks instead of the last note.

### Changed
- **Inline `#tags` in task rows render as real tag pills.** A tag written in a task now shows with the same styling as tags everywhere else in Obsidian, and it's clickable. Clicking it opens that tag's list inside Taskgregator (in both the main view and the context sidebar). The small tag chip on the meta row stays.
- **Markdown links render in task rows.** `[text](url)` in a task now renders as a clickable link instead of raw markdown. Thanks @maxbeizer ([#3](https://github.com/philpalmieri/taskgregator/pull/3)).

### Notes
- No data migration. Tasks remain plain markdown checkboxes; nothing about how tags or links are written changes.

## 2.1.0

Feature release. Faster to find things, quicker to act on them in place, and cleaner on the page.

### Added
- **Search box in the navigator.** A search field under the title filters tasks as you type. It scopes to the current selection (a project, Today, a tag list, etc.) and shows a *Searching 'foo' in <scope>* callout on the list, with a **clear** action. The filter sticks when you switch to another smart list or context node, so you can search the same term across different scopes. Clear with the **×** in the field or **Esc**.
- **Tomorrow and Soon smart lists** under Today. **Tomorrow** shows tasks due tomorrow; **Soon** shows tasks due within the next *N* days. The window is configurable via **Soon window (days)** (default 7).
- **Right-click context menu on task rows** in the task list and context sidebar (previously only on task lines in the editor). Set priority (submenu), due/start dates, toggle `#today`, open the detail note, jump to source, or cancel, without leaving the panel.

### Changed
- **Detail-note block ids are hidden on the page.** A task's lazily-added `^id` no longer shows as raw text. In both Reading view and Live Preview it renders as a small **📝** note icon (click to open the note; right-click the task for the menu). Put your cursor on the line in Live Preview to reveal the raw id when you need it. The id stays in the file, so identity and backlinks are unchanged.

### Notes
- No data migration. Tasks remain plain markdown checkboxes; existing block ids and detail notes keep working.

## 2.0.2

### Changed
- Documentation only. Rewrote the README around the "works the way you already work" positioning (no separate database, no special task files, no syntax or rules to adopt) and replaced the wireframes with real screenshots. Released to refresh the README shown on directory and mirror sites. No functional changes.

## 2.0.1

### Fixed
- Context sidebar **Section** and **Reference** tabs no longer leak sibling files' tasks when viewing a regular page. Subtree expansion now applies only on a folder note (`Folder/Folder.md`). On a regular page like `Folder/File1.md`, Section is empty and Reference lists only tasks that link to that exact file.

## 2.0.0

Major reorganization of the plugin's UI into three surfaces that share one index.

### Added
- **Navigator** view in the left sidebar: smart lists and the context roll-up tree, docked next to Files and Search (replaces the ribbon icon). Selecting an item drives the task list.
- **Context sidebar** (right): follows the active note and shows its tasks, with **Page / Section / Reference / All** filter tabs. Defaults to Page.
- Shared view state so a selection made in the navigator is reflected by the list, and sort/group/collapse survive re-renders.

### Changed
- Split the old two-pane panel into a left-dock navigator plus a center task list. The list now uses the full main area.
- Removed the left ribbon icon; the navigator auto-docks in the left sidebar on load.
- Context sidebar clears when a Taskgregator view is focused (a plugin view isn't a note, so it no longer strands the previous page's tasks), including when the page has no tasks.
- README trimmed: core ideas moved up, install/BRAT/roadmap/development sections removed for the Community Plugins listing.

### Notes
- Tasks remain plain markdown checkboxes in your notes; no data migration is needed when upgrading from 1.x.
