/** Pure time-slot helpers (timezone math, business-hours grid, slot picking). */
import { config } from "../env";

// ───────────── Timezone helpers (no external deps) ─────────────
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const off = tzOffsetMs(guess, tz);
  return new Date(guess.getTime() - off);
}

export function zonedParts(date: Date, tz: string) {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, weekday: p.weekday as string };
}

export function formatSlot(iso: string, tz = config.timezone) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" }).format(new Date(iso));
}

const hm = (s: string) => s.split(":").map(Number) as [number, number];

/** Pure: candidate slots (weekdays, business hours, within window, not in the past) minus busy intervals. */
export function computeOpenSlots(args: {
  startIso: string; endIso: string; busy: { start: string; end: string }[]; now: Date;
  tz?: string; minutes?: number; businessStart?: string; businessEnd?: string; windowDays?: number;
}): string[] {
  const tz = args.tz ?? config.timezone;
  const minutes = args.minutes ?? config.meetingMinutes;
  const [sh, sm] = hm(args.businessStart ?? config.businessStart);
  const [eh, em] = hm(args.businessEnd ?? config.businessEnd);
  const windowEnd = new Date(args.now.getTime() + Math.min(args.windowDays ?? config.bookingWindowDays, 30) * 86_400_000);
  const start = new Date(Math.max(new Date(args.startIso).getTime(), args.now.getTime() + 2 * 3_600_000)); // ≥2h notice
  const end = new Date(Math.min(new Date(args.endIso).getTime(), windowEnd.getTime()));
  const busy = args.busy.map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()] as const);
  const out: string[] = [];
  for (let day = new Date(start.getTime() - 86_400_000); day <= end; day = new Date(day.getTime() + 86_400_000)) {
    const z = zonedParts(day, tz);
    const dayStart = zonedToUtc(z.y, z.m, z.d, sh, sm, tz);
    const wd = zonedParts(dayStart, tz).weekday;
    if (wd === "Sat" || wd === "Sun") continue;
    const dayEnd = zonedToUtc(z.y, z.m, z.d, eh, em, tz);
    for (let t = dayStart.getTime(); t + minutes * 60_000 <= dayEnd.getTime(); t += minutes * 60_000) {
      const s = t, e = t + minutes * 60_000;
      if (s < start.getTime() || e > end.getTime()) continue;
      if (busy.some(([bs, be]) => s < be && e > bs)) continue;
      const iso = new Date(s).toISOString();
      if (!out.includes(iso)) out.push(iso);
    }
  }
  return out.sort();
}

/** Pure: pick 2 open slots on different days, not previously rejected. Prefers late-morning / mid-afternoon. */
export function pickTwoSlots(slots: string[], rejected: string[], tz = config.timezone): string[] {
  const rej = new Set(rejected.map((r) => new Date(r).toISOString()));
  const usable = slots.filter((s) => !rej.has(s));
  const byDay = new Map<string, string[]>();
  for (const s of usable) {
    const z = zonedParts(new Date(s), tz);
    const k = `${z.y}-${z.m}-${z.d}`;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(s);
  }
  const pref = (s: string) => { const h = zonedParts(new Date(s), tz).hh; return h === 11 ? 0 : h === 15 ? 1 : h === 12 ? 2 : h === 14 ? 3 : 4 + Math.abs(13 - h); };
  const days = [...byDay.keys()];
  const picks: string[] = [];
  for (const d of days) {
    if (picks.length >= 2) break;
    const best = [...byDay.get(d)!].sort((a, b) => pref(a) - pref(b))[0];
    picks.push(best);
  }
  return picks;
}

