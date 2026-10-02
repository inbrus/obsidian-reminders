// Declarative menu building (QuickAdd-style ActionDescriptor). Both the editor
// context menu (main.ts) and the task-row menu (ui.ts) assemble from the same
// descriptor shape, so submenu/fallback logic lives in exactly one place.

import { Menu } from "obsidian";

export interface ActionDescriptor {
  title?: string;
  icon?: string;
  checked?: boolean;
  /** Insert a visual separator before this item (or standalone when title omitted). */
  separator?: boolean;
  submenu?: ActionDescriptor[];
  onClick?: () => void | Promise<void>;
}

export function buildMenu(menu: Menu, actions: ActionDescriptor[]): void {
  for (const a of actions) {
    if (a.separator) {
      menu.addSeparator();
      continue;
    }

    menu.addItem((item) => {
      if (a.title) item.setTitle(a.title);
      if (a.icon) item.setIcon(a.icon);
      if (a.checked !== undefined) item.setChecked(a.checked);

      if (a.submenu) {
        const sub = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
        if (sub) {
          buildMenu(sub, a.submenu);
          return;
        }
        // Fallback (no submenu support): append children as flat items.
        for (const child of a.submenu) {
          menu.addItem((ci) => {
            if (child.title) ci.setTitle(child.title);
            if (child.icon) ci.setIcon(child.icon);
            if (child.checked !== undefined) ci.setChecked(child.checked);
            if (child.onClick) ci.onClick(() => void child.onClick!());
          });
        }
        return;
      }

      if (a.onClick) item.onClick(() => void a.onClick!());
    });
  }
}

/** Priority submenu: None / P1 / P2 / P3. Shared by both menus. */
export function priorityActions(
  current: number,
  set: (lvl: number) => void | Promise<void>
): ActionDescriptor[] {
  const levels: Array<[string, number]> = [
    ["None", 0],
    ["P1 (high)", 1],
    ["P2 (medium)", 2],
    ["P3 (low)", 3],
  ];
  return levels.map(([label, lvl]) => ({
    title: label,
    checked: current === lvl,
    onClick: () => set(lvl),
  }));
}
