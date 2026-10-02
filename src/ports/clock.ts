// Port: time source. Core and services never call `new Date()` or
// `Date.now()` directly; they ask the clock. infra/obsidian-clock.ts is the
// production implementation (local calendar, no UTC drift).

export interface IClock {
  now(): Date;
  /** Local-calendar ISO YYYY-MM-DD for today. */
  todayIso(): string;
  /** Local-calendar ISO YYYY-MM-DD for today + n days (n may be negative). */
  offsetDays(n: number): string;
}
