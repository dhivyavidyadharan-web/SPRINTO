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
  get fastModel() { return str("GEMINI_FAST_MODEL", "gemini-3.8-flash"); },
  get smartModel() { return str("GEMINI_SMART_MODEL", "gemini-4-hydrogen"); },
  get fastThinking() { return str("GEMINI_FAST_THINKING", "low"); },
  get smartThinking() { return str("GEMINI_SMART_THINKING", "low"); },
  get myEmail() { return str("MY_EMAIL").toLowerCase(); },
  /** Gmail account used for SMTP/IMAP (defaults to MY_EMAIL). */
  get gmailUser() { return str("GMAIL_USER") || str("MY_EMAIL"); },
  /** Google App Password (16 chars; spaces are ignored). */
  get gmailAppPassword() { return str("GMAIL_APP_PASSWORD").replace(/\s+/g, ""); },
  get calendlyUrl() { return str("CALENDLY_URL"); },
  get calendlyToken() { return str("CALENDLY_TOKEN"); },
  get senderName() { return str("SENDER_NAME", "Sprinto Growth"); },
  get senderTitle() { return str("SENDER_TITLE", "Growth, Sprinto"); },
  get dashboardPassword() { return str("DASHBOARD_PASSWORD"); },
  /** Key for encrypting secrets stored in the settings table. */
  get encryptionKey() { return str("ENCRYPTION_KEY") || str("DASHBOARD_PASSWORD") || str("GMAIL_APP_PASSWORD"); },
  get passwordGate() { return !!str("DASHBOARD_PASSWORD"); },
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
    DASHBOARD_PASSWORD_GATE: config.passwordGate ? "on" : "off (dashboard is open)",
    GMAIL_USER: config.gmailUser,
    GMAIL_APP_PASSWORD_SET: !!config.gmailAppPassword,
    CALENDLY_URL: config.calendlyUrl || "(not set)",
    CALENDLY_TOKEN_SET: !!config.calendlyToken,
    JINA_API_KEY_SET: !!config.jinaKey,
    HUNTER_API_KEY_SET: !!config.hunterKey,
  };
}
