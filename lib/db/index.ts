import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import { config } from "../env";

let _db: NeonHttpDatabase<typeof schema> | null = null;

/** Lazily-created Drizzle client over Neon HTTP (serverless-friendly). */
export function db(): NeonHttpDatabase<typeof schema> {
  if (!_db) {
    if (!config.databaseUrl) throw new Error("DATABASE_URL is not set");
    _db = drizzle(neon(config.databaseUrl), { schema });
  }
  return _db;
}

export { schema };
