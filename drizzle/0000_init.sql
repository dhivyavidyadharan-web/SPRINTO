CREATE TYPE "public"."company_status" AS ENUM('QUEUED', 'PROCESSING', 'DISQUALIFIED', 'NURTURE', 'UNREACHABLE', 'QUALIFIED', 'EMAILED', 'FOLLOWUP_1_SENT', 'FOLLOWUP_2_SENT', 'IN_CONVERSATION', 'MEETING_BOOKED', 'BACKUP', 'DO_NOT_CONTACT', 'INPUT_NEEDED');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"name" text,
	"status" "company_status" DEFAULT 'QUEUED' NOT NULL,
	"verdict" text,
	"score" integer,
	"flags" text[] DEFAULT '{}' NOT NULL,
	"facts" jsonb,
	"decision_log" jsonb,
	"input_needed_reason" text,
	"resume_from" text,
	"dry_run" boolean DEFAULT false NOT NULL,
	"revisit_after" timestamp with time zone,
	"backup_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"title" text,
	"email" text,
	"linkedin_url" text,
	"source" text DEFAULT 'apollo_manual' NOT NULL,
	"confidence" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"gmail_thread_id" text,
	"langgraph_thread_id" text NOT NULL,
	"state" jsonb,
	"stage" text DEFAULT 'waiting' NOT NULL,
	"input_needed_reason" text,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"hook_signal_id" text,
	"hook_quote" text,
	"pain_point_ids" text[] DEFAULT '{}' NOT NULL,
	"rules_applied" text[] DEFAULT '{}' NOT NULL,
	"quality_gate" jsonb,
	"send_status" text DEFAULT 'draft' NOT NULL,
	"gmail_message_id" text,
	"rfc_message_id" text,
	"gmail_thread_id" text,
	"sent_at" timestamp with time zone,
	"dry_run" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_id" integer NOT NULL,
	"verdict" text NOT NULL,
	"working" text,
	"not_working" text,
	"edited_body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hook_outcomes" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_id" integer,
	"company_id" integer,
	"hook_signal_id" text,
	"pain_point_ids" text[] DEFAULT '{}' NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hunter_cache" (
	"domain" text PRIMARY KEY NOT NULL,
	"response" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"calendar_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"url" text NOT NULL,
	"page_type" text NOT NULL,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"cleaned_text" text,
	"footer_text" text,
	"badge_hints" text[] DEFAULT '{}' NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"source_feedback_id" integer,
	"times_applied" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hook_outcomes" ADD CONSTRAINT "hook_outcomes_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hook_outcomes" ADD CONSTRAINT "hook_outcomes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_source_feedback_id_feedback_id_fk" FOREIGN KEY ("source_feedback_id") REFERENCES "public"."feedback"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_domain_idx" ON "companies" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "contacts_domain_idx" ON "contacts" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_company_idx" ON "conversations" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "events_company_idx" ON "events" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "pages_url_idx" ON "pages" USING btree ("url");