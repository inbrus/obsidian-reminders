// Typed event bus. Replaces the manual refreshViews/rerenderAll/rerenderList
// callbacks: views subscribe to these events and re-render themselves, so the
// controller (main.ts) no longer needs to know about every view. Pure — no
// Obsidian runtime; unit-testable.

export interface EventMap {
  /** The task index was rebuilt (full=true always for now; per-file arrives with the incremental indexer). */
  "index:updated": { full: boolean };
  /** The shared selection changed (nav clicked a list/tree item, revealTask, startup). */
  "selection:changed": void;
  /** The free-text search query changed. */
  "search:changed": void;
  /** Settings changed (saveSettings). Views re-read settings-derived state. */
  "settings:changed": void;
  /** The active file changed (context sidebar follows it). */
  "file:changed": { path: string | null };
}

type EventName = keyof EventMap;
type Handler<K extends EventName> = (payload: EventMap[K]) => void;

export class EventBus {
  private handlers = new Map<EventName, Set<Handler<EventName>>>();

  /** Subscribe; returns an unsubscribe function. */
  on<K extends EventName>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<EventName>);
    return () => this.off(event, handler);
  }

  off<K extends EventName>(event: K, handler: Handler<K>): void {
    this.handlers.get(event)?.delete(handler as Handler<EventName>);
  }

  emit<K extends EventName>(event: K, payload: EventMap[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // Snapshot so handlers that unsubscribe mid-emit don't break iteration.
    for (const h of Array.from(set)) (h as Handler<K>)(payload);
  }
}
