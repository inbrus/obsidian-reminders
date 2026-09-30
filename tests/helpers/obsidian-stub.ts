// Minimal runtime stub for the `obsidian` module so pure parser/date/writer
// functions can be unit-tested in Node without the Obsidian app runtime.
//
// Type-only imports (App, TFile, TFolder, ...) are erased at compile time, but
// some modules `extend` or instantiate these symbols at load time (settings.ts
// extends PluginSettingTab/SettingPage), and a few helpers are called at
// runtime (normalizePath, setIcon, requestUrl). Stub every symbol the codebase
// imports so any module can be loaded in a test.

export class App {}
export class TFile {}
export class TFolder {}
export class TAbstractFile {}
export class Plugin {}
export class WorkspaceLeaf {}
export class Menu {}
export class Editor {}
export class MarkdownView {}
export class MarkdownFileInfo {}
export class MarkdownPostProcessorContext {}
export class ItemView {}
export class Modal {}
export class Component {}
export class MarkdownRenderer {
  static async render(): Promise<void> {}
}
export class PluginSettingTab {}
export class Setting {}
export class SettingPage {}
export class SettingDefinitionItem {}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

export function setIcon(): void {}

export async function requestUrl(): Promise<{ status: number; text: string }> {
  return { status: 200, text: "" };
}
