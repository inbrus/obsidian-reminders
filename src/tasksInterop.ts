// Loose coupling to the community "Tasks" plugin.
//
// ObsidianReminders has NO hard dependency on Tasks. When Tasks is installed and
// enabled, we read its configured global task format (emoji vs dataview) so the
// context menu writes metadata in whatever style the user already uses. Every
// access is feature-detected and wrapped in try/catch; if Tasks is absent or
// its data shape changes, we silently fall back to ObsidianReminders's own setting.

import { App } from "obsidian";
import { TaskFormat } from "./dataview";

const TASKS_PLUGIN_ID = "obsidian-tasks-plugin";

// Tasks stores `taskFormat` as one of these string values in its data.json.
type TasksFormatValue = "tasksPluginEmoji" | "dataview";

interface PluginsApi {
  enabledPlugins?: Set<string>;
  plugins?: Record<string, unknown>;
}

function getAppPlugins(app: App): PluginsApi | undefined {
  // `app.plugins` is not part of the public Obsidian typings.
  return (app as unknown as { plugins?: PluginsApi }).plugins;
}

/** True if the Tasks plugin is installed and currently enabled. */
export function isTasksPluginEnabled(app: App): boolean {
  try {
    const plugins = getAppPlugins(app);
    if (plugins?.enabledPlugins?.has(TASKS_PLUGIN_ID)) return true;
    return !!plugins?.plugins?.[TASKS_PLUGIN_ID];
  } catch {
    return false;
  }
}

let cache: { format: TaskFormat | null; at: number } | undefined;
const CACHE_MS = 15_000;

/**
 * Best-effort read of the Tasks plugin's configured format. Returns "emoji" or
 * "dataview" when it can be determined, otherwise null. Result is cached
 * briefly so context-menu actions don't re-read data.json on every click.
 * Call `clearTasksFormatCache()` to force a refresh.
 */
export async function getTasksPluginFormat(app: App): Promise<TaskFormat | null> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.format;

  let format: TaskFormat | null = null;
  try {
    if (isTasksPluginEnabled(app)) {
      const configDir = app.vault.configDir; // usually ".obsidian"
      const dataPath = `${configDir}/plugins/${TASKS_PLUGIN_ID}/data.json`;
      if (await app.vault.adapter.exists(dataPath)) {
        const raw = await app.vault.adapter.read(dataPath);
        const parsed = JSON.parse(raw) as { taskFormat?: TasksFormatValue };
        if (parsed?.taskFormat === "dataview") format = "dataview";
        else if (parsed?.taskFormat === "tasksPluginEmoji") format = "emoji";
      }
    }
  } catch {
    format = null; // Any failure => behave as if Tasks weren't there.
  }

  cache = { format, at: now };
  return format;
}

export function clearTasksFormatCache(): void {
  cache = undefined;
}
