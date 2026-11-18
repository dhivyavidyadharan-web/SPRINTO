import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { decrypt, encrypt } from "./crypto";

export async function getSetting(key: string, opts: { encrypted?: boolean } = {}): Promise<string | null> {
  const rows = await db().select().from(schema.settings).where(eq(schema.settings.key, key));
  if (!rows.length) return null;
  return opts.encrypted ? decrypt(rows[0].value) : rows[0].value;
}

export async function setSetting(key: string, value: string, opts: { encrypted?: boolean } = {}) {
  const v = opts.encrypted ? encrypt(value) : value;
  await db().insert(schema.settings).values({ key, value: v, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: v, updatedAt: new Date() } });
}

export async function deleteSetting(key: string) {
  await db().delete(schema.settings).where(eq(schema.settings.key, key));
}
