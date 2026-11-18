// Centralised, typed access to env-driven configuration. Server-side only.

export function parseDuration(input: string | undefined, fallback: string): number {
  const raw = (input && input.trim()) || fallback;
  const m = /^(\d+(?:\.\d+)?)\s*(m|h|d)$/i.exec(raw);
  if (!m) throw new Error(`Invalid duration "${raw}" (use e.g. 5m, 12h, 7d)`);
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const mult = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return Math.round(n * mult);
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v.trim();
}

export const config = {
  get databaseUrl() { return str("DATABASE_URL"); },
  get geminiKey() { return str("GEMINI_API_KEY"); },
  get fastModel() { return str("GEMINI_FAST_MODEL", "gemini-2.5-flash"); },
  get smartModel() { return str("GEMINI_SMART_MODEL", "gemini-2.5-pro"); },
  get googleClientId() { return str("GOOGLE_CLIENT_ID"); },
  get googleClientSecret() { return str("GOOGLE_CLIENT_SECRET"); },
  get googleRedirectUri() { return str("GOOGLE_REDIRECT_URI", "http://localhost:3000/api/google/callback"); },
  get myEmail() { return str("MY_EMAIL").toLowerCase(); },
  get senderName() { return str("SENDER_NAME", "Sprinto Growth"); },
  get senderTitle() { return str("SENDER_TITLE", "Growth, Sprinto"); },
  get dashboardPassword() { return str("DASHBOARD_PASSWORD"); },
  get encryptionKey() { return str("ENCRYPTION_KEY") || str("DASHBOARD_PASSWORD"); },
  get cronSecret() { return str("CRON_SECRET"); },
  get jinaKey() { return str("JINA_API_KEY"); },
  get contactSource() { return str("CONTACT_SOURCE", "db") as "db" | "hunter"; },
  get hunterKey() { return str("HUNTER_API_KEY"); },
  get timezone() { return str("TIMEZONE", "Asia/Kolkata"); },
  get businessStart() { return str("BUSINESS_HOURS_START", "10:00"); },
  get businessEnd() { return str("BUSINESS_HOURS_END", "18:00"); },
  get meetingMinutes() { return int("MEETING_MINUTES", 30); },
  get bookingWindowDays() { return Math.min(int("BOOKING_WINDOW_DAYS", 14), 30); },
  get maxExtraFetches() { return int("MAX_EXTRA_FETCHES", 4); },
  get maxHttpRequests() { return int("MAX_HTTP_REQUESTS_PER_COMPANY", 12); },
  get maxNegotiationRounds() { return int("MAX_NEGOTIATION_ROUNDS", 3); },
  get followup1AfterMs() { return parseDuration(process.env.FOLLOWUP_1_AFTER, "7d"); },
  get followup2AfterMs() { return parseDuration(process.env.FOLLOWUP_2_AFTER, "7d"); },
  get backupRevisitNegativeMs() { return parseDuration(process.env.BACKUP_REVISIT_NEGATIVE, "90d"); },
  get backupRevisitNoReplyMs() { return parseDuration(process.env.BACKUP_REVISIT_NO_REPLY, "60d"); },
  get nurtureRevisitMs() { return parseDuration(process.env.NURTURE_REVISIT, "60d"); },
  get maxActiveRules() { return int("MAX_ACTIVE_RULES", 10); },
  get dryRunEnv() { return str("DRY_RUN", "false").toLowerCase() === "true"; },
};

/** Non-secret config for display on the Settings page. */
export function publicConfig() {
  return {
    GEMINI_FAST_MODEL: config.fastModel,
    GEMINI_SMART_MODEL: config.smartModel,
    MY_EMAIL: config.myEmail,
    SENDER_NAME: config.senderName,
    SENDER_TITLE: config.senderTitle,
    CONTACT_SOURCE: config.contactSource,
    TIMEZONE: config.timezone,
    BUSINESS_HOURS: `${config.businessStart}–${config.businessEnd}`,
    MEETING_MINUTES: config.meetingMinutes,
    BOOKING_WINDOW_DAYS: config.bookingWindowDays,
    MAX_EXTRA_FETCHES: config.maxExtraFetches,
    MAX_HTTP_REQUESTS_PER_COMPANY: config.maxHttpRequests,
    MAX_NEGOTIATION_ROUNDS: config.maxNegotiationRounds,
    FOLLOWUP_1_AFTER: process.env.FOLLOWUP_1_AFTER || "7d",
    FOLLOWUP_2_AFTER: process.env.FOLLOWUP_2_AFTER || "7d",
    BACKUP_REVISIT_NEGATIVE: process.env.BACKUP_REVISIT_NEGATIVE || "90d",
    BACKUP_REVISIT_NO_REPLY: process.env.BACKUP_REVISIT_NO_REPLY || "60d",
    MAX_ACTIVE_RULES: config.maxActiveRules,
    DRY_RUN_ENV: config.dryRunEnv,
    JINA_API_KEY_SET: !!config.jinaKey,
    HUNTER_API_KEY_SET: !!config.hunterKey,
  };
}
