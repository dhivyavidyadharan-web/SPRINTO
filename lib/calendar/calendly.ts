/**
 * Calendly integration (replaces Google Calendar).
 *  - CALENDLY_URL (required for scheduling): your public event link, e.g. https://calendly.com/you/30min
 *  - CALENDLY_TOKEN (optional): Personal Access Token. Enables real availability
 *    (/event_type_available_times) and, if your plan allows it, direct booking (POST /invitees).
 * Without a token the agent proposes business-hours slots and sends your Calendly link to lock them in.
 */
import { config } from "../env";
import { computeOpenSlots, zonedParts } from "./slots";

const API = "https://api.calendly.com";

export class CalendlyError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!config.calendlyToken) throw new CalendlyError("CALENDLY_TOKEN not set", 401);
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${config.calendlyToken}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new CalendlyError(`Calendly ${init.method ?? "GET"} ${path.split("?")[0]} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
  return res.json() as Promise<T>;
}

const norm = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();

type Loc = { kind: string; location?: string | null };
let eventTypeCache: { uri: string; schedulingUrl: string; duration: number; locations: Loc[] } | null = null;

/** Resolve the Calendly event type matching CALENDLY_URL (or the first active one). */
export async function eventType() {
  if (eventTypeCache) return eventTypeCache;
  const me = await call<{ resource: { uri: string } }>("/users/me");
  const types = await call<{ collection: { uri: string; scheduling_url: string; active: boolean; duration: number; locations?: Loc[] | null }[] }>(`/event_types?user=${encodeURIComponent(me.resource.uri)}&count=100`);
  const active = types.collection.filter((t) => t.active);
  const match = (config.calendlyUrl && active.find((t) => norm(t.scheduling_url) === norm(config.calendlyUrl))) || active[0];
  if (!match) throw new CalendlyError("No active Calendly event type found", 404);
  eventTypeCache = { uri: match.uri, schedulingUrl: match.scheduling_url, duration: match.duration, locations: match.locations ?? [] };
  return eventTypeCache;
}

/** Real open start times from Calendly (≤ 7-day chunks, as the API requires). */
export async function availableTimes(startIso: string, endIso: string): Promise<{ start: string; schedulingUrl: string }[]> {
  const et = await eventType();
  const out: { start: string; schedulingUrl: string }[] = [];
  let from = new Date(Math.max(new Date(startIso).getTime(), Date.now() + 60_000));
  const end = new Date(endIso);
  while (from < end) {
    const to = new Date(Math.min(from.getTime() + 7 * 86_400_000 - 60_000, end.getTime()));
    const r = await call<{ collection: { status: string; start_time: string; scheduling_url: string }[] }>(
      `/event_type_available_times?event_type=${encodeURIComponent(et.uri)}&start_time=${from.toISOString()}&end_time=${to.toISOString()}`,
    );
    for (const s of r.collection) if (s.status === "available") out.push({ start: new Date(s.start_time).toISOString(), schedulingUrl: s.scheduling_url });
    from = new Date(to.getTime() + 60_000);
  }
  return out;
}

/**
 * Busy intervals for the agent's slot logic. With a token: every business-hours grid slot that
 * Calendly does NOT offer is "busy". Without a token: nothing is busy (business-hours grid only).
 */
export async function busyIntervals(startIso: string, endIso: string): Promise<{ start: string; end: string }[]> {
  if (!config.calendlyToken) return [];
  const avail = new Set((await availableTimes(startIso, endIso)).map((a) => a.start));
  const grid = computeOpenSlots({ startIso, endIso, busy: [], now: new Date(), windowDays: 30 });
  const mins = config.meetingMinutes * 60_000;
  return grid.filter((g) => !avail.has(g)).map((g) => ({ start: g, end: new Date(new Date(g).getTime() + mins).toISOString() }));
}

/** Link that opens Calendly on the slot's day (the invitee picks/locks the agreed time there). */
export function slotLink(slotIso: string) {
  const base = config.calendlyUrl.replace(/\/$/, "");
  if (!base) return null;
  const z = zonedParts(new Date(slotIso), config.timezone);
  const mm = String(z.m).padStart(2, "0"), dd = String(z.d).padStart(2, "0");
  return `${base}?month=${z.y}-${mm}&date=${z.y}-${mm}-${dd}`;
}

/**
 * Book the slot. Tries Calendly's Scheduling API (POST /invitees, invitee = MY_EMAIL in live test).
 * If there's no token or the plan/API refuses, returns mode "link": the agreed time is confirmed by
 * email and the confirmation carries the Calendly link to lock it in.
 */
export async function bookSlot(p: { slotIso: string; contactName: string; companyId: number }): Promise<{ eventId: string; mode: "api" | "link"; note?: string }> {
  if (config.calendlyToken) {
    try {
      const et = await eventType();
      const r = await call<{ resource: { uri: string; event?: string } }>("/invitees", {
        method: "POST",
        body: JSON.stringify({
          event_type: et.uri,
          start_time: new Date(p.slotIso).toISOString(),
          invitee: { name: `${p.contactName} (live test)`, email: config.myEmail, timezone: config.timezone },
          // Event types with a configured location (e.g. Google Meet) require it on API bookings.
          ...(et.locations[0] ? { location: { kind: et.locations[0].kind, ...(et.locations[0].location ? { location: et.locations[0].location } : {}) } } : {}),
        }),
      });
      return { eventId: r.resource.event ?? r.resource.uri, mode: "api" };
    } catch (e) {
      const st = (e as CalendlyError).status;
      if (st && st >= 500) throw e; // transient → retry table
      return { eventId: `calendly-link:${p.companyId}:${p.slotIso}`, mode: "link", note: `Calendly booking API unavailable (${String((e as Error).message).slice(0, 120)}); sent booking link instead` };
    }
  }
  return { eventId: `calendly-link:${p.companyId}:${p.slotIso}`, mode: "link", note: "no CALENDLY_TOKEN; sent booking link" };
}

export function classifyCalendarError(e: unknown): "auth" | "transient" | "other" {
  const st = (e as CalendlyError)?.status;
  const msg = String((e as Error)?.message ?? e);
  if (st === 401 || st === 403) return "auth";
  if ((typeof st === "number" && st >= 500) || /timeout|ETIMEDOUT|ECONNRESET|fetch failed|socket/i.test(msg)) return "transient";
  return "other";
}

export async function calendlyStatus(): Promise<{ url: string | null; token: boolean; eventType?: string; error?: string }> {
  const base = { url: config.calendlyUrl || null, token: !!config.calendlyToken };
  if (!config.calendlyToken) return base;
  try { const et = await eventType(); return { ...base, eventType: `${et.schedulingUrl} (${et.duration} min)` }; }
  catch (e) { return { ...base, error: String((e as Error).message).slice(0, 200) }; }
}
