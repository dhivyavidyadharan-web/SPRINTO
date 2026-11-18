import {
  pgTable, pgEnum, serial, text, integer, boolean, jsonb, timestamp, real, uniqueIndex, index,
} from "drizzle-orm/pg-core";

export const companyStatus = pgEnum("company_status", [
  "QUEUED", "PROCESSING", "DISQUALIFIED", "NURTURE", "UNREACHABLE", "QUALIFIED", "EMAILED",
  "FOLLOWUP_1_SENT", "FOLLOWUP_2_SENT", "IN_CONVERSATION", "MEETING_BOOKED", "BACKUP",
  "DO_NOT_CONTACT", "INPUT_NEEDED",
]);
export type CompanyStatus = (typeof companyStatus.enumValues)[number];

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull(),
  name: text("name"),
  status: companyStatus("status").notNull().default("QUEUED"),
  verdict: text("verdict"),
  score: integer("score"),
  flags: text("flags").array().notNull().default([]),
  facts: jsonb("facts"),
  decisionLog: jsonb("decision_log"),
  inputNeededReason: text("input_needed_reason"),
  resumeFrom: text("resume_from"), // e.g. "contacts" | "send" when re-queued after human input
  dryRun: boolean("dry_run").notNull().default(false),
  revisitAfter: timestamp("revisit_after", { withTimezone: true }),
  backupReason: text("backup_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("companies_domain_idx").on(t.domain)]);

export const pages = pgTable("pages", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  pageType: text("page_type").notNull(),
  method: text("method").notNull(), // fetch | jina
  status: text("status").notNull(), // ok | blocked_by_robots | timeout | http_4xx | ...
  cleanedText: text("cleaned_text"),
  footerText: text("footer_text"),
  badgeHints: text("badge_hints").array().notNull().default([]),
  wordCount: integer("word_count").notNull().default(0),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("pages_url_idx").on(t.url)]);

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  title: text("title"),
  email: text("email"),
  linkedinUrl: text("linkedin_url"),
  source: text("source").notNull().default("apollo_manual"),
  confidence: integer("confidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("contacts_domain_idx").on(t.domain)]);

export const hunterCache = pgTable("hunter_cache", {
  domain: text("domain").primaryKey(),
  response: jsonb("response").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emails = pgTable("emails", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // cold|followup_1|followup_2|scheduling|confirmation|decline_ack|clarify|manual
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  hookSignalId: text("hook_signal_id"),
  hookQuote: text("hook_quote"),
  painPointIds: text("pain_point_ids").array().notNull().default([]),
  rulesApplied: text("rules_applied").array().notNull().default([]),
  qualityGate: jsonb("quality_gate"),
  sendStatus: text("send_status").notNull().default("draft"), // draft|sent|dry_run|send_failed|blocked
  gmailMessageId: text("gmail_message_id"),
  rfcMessageId: text("rfc_message_id"),
  gmailThreadId: text("gmail_thread_id"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  dryRun: boolean("dry_run").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  gmailThreadId: text("gmail_thread_id"),
  langgraphThreadId: text("langgraph_thread_id").notNull(),
  state: jsonb("state"),
  stage: text("stage").notNull().default("waiting"),
  inputNeededReason: text("input_needed_reason"),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("conversations_company_idx").on(t.companyId)]);

export const meetings = pgTable("meetings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  calendarEventId: text("calendar_event_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const feedback = pgTable("feedback", {
  id: serial("id").primaryKey(),
  emailId: integer("email_id").notNull().references(() => emails.id, { onDelete: "cascade" }),
  verdict: text("verdict").notNull(), // good|bad
  working: text("working"),
  notWorking: text("not_working"),
  editedBody: text("edited_body"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rules = pgTable("rules", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // do|dont
  text: text("text").notNull(),
  sourceFeedbackId: integer("source_feedback_id").references(() => feedback.id, { onDelete: "set null" }),
  timesApplied: integer("times_applied").notNull().default(0),
  status: text("status").notNull().default("active"), // active|retired
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hookOutcomes = pgTable("hook_outcomes", {
  id: serial("id").primaryKey(),
  emailId: integer("email_id").references(() => emails.id, { onDelete: "cascade" }),
  companyId: integer("company_id").references(() => companies.id, { onDelete: "cascade" }),
  hookSignalId: text("hook_signal_id"),
  painPointIds: text("pain_point_ids").array().notNull().default([]),
  outcome: text("outcome").notNull(), // booked|positive|negative|no_reply
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id, { onDelete: "cascade" }),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  actor: text("actor").notNull(), // pipeline|agent|cron|human
  type: text("type").notNull(),
  payload: jsonb("payload"),
}, (t) => [index("events_company_idx").on(t.companyId)]);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const llmCalls = pgTable("llm_calls", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  purpose: text("purpose").notNull(),
  model: text("model").notNull(),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
});

export type Company = typeof companies.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Email = typeof emails.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Rule = typeof rules.$inferSelect;
