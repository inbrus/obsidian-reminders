// Production clock: local calendar (no UTC drift near midnight).

import { IClock } from "../ports/clock";
import { localISODate } from "../core/date";

export class ObsidianClock implements IClock {
  now(): Date {
    return new Date();
  }

  todayIso(): string {
    return localISODate(this.now());
  }

  offsetDays(n: number): string {
    const d = this.now();
    d.setDate(d.getDate() + n);
    return localISODate(d);
  }
}
