import { db, schema } from "./index";

export type Actor = "pipeline" | "agent" | "cron" | "human" | "learning";

/** Append-only activity log. Never throws (logging must not break the pipeline). */
export async function logEvent(companyId: number | null, actor: Actor, type: string, payload: unknown = {}) {
  try {
    await db().insert(schema.events).values({ companyId, actor, type, payload: payload as object });
  } catch (e) {
    console.error("[events] failed to log", type, e);
  }
}
