# Sprinto Autonomous Outbound Agent

An autonomous outbound agent with a hosted dashboard. It scrapes prospect sites, extracts evidence-backed facts, qualifies companies against Sprinto's rubric, picks the decision-maker and two pain points, then drafts and sends a personalised cold email. A LangGraph agent handles the reply conversation (scheduling, follow-ups, declines, unsubscribes), and the drafter learns from your feedback.

> **LIVE TEST MODE.** Every email the system sends goes **only to `MY_EMAIL`**. `lib/google/gmail.ts` sets the recipient itself and throws for any other address. `tests/sendSafety.test.ts` covers this.

## Stack

Next.js 15 (App Router, TypeScript), Tailwind · Neon Postgres + Drizzle · Gemini (`@google/genai`, structured JSON output validated by Zod) · cheerio + robots-parser, with Jina Reader as the fallback for JS-rendered pages · LangGraph.js + Postgres checkpointer · Gmail via App Password (nodemailer SMTP + imapflow IMAP) · Calendly · Vitest · Vercel Hobby.

## Where things live

| Path | What |
|---|---|
| `lib/rubric.ts` | **All judgement**: gates, signals, points, thresholds, sufficiency, page priority, title ranking, banned titles and phrases, pain library, SPRINTO_FACTS. Pure functions. |
| `lib/facts.ts` | Fact model (`{value, evidence, sourceUrl}`), grounding (drops any value whose quote isn't on the page), and cross-page merge. |
| `lib/scrape/*` | Single-page fetcher (robots.txt, UA, 1–2 s delay, 10 s timeout, request cap, wall detection, Jina fallback), cleaning, link discovery. |
| `lib/pipeline/*` | Steps 1–7: the qualify loop, extract, explain, contacts, pain points, draft + quality gate, `run.ts` orchestrator, decision log. |
| `lib/agent/*` | LangGraph reply/scheduling agent: state, tools + retry table, graph, runtime (checkpointer, reply detection, daily jobs). |
| `lib/feedback/*` | Rule distillation, dedupe, the 10-rule cap, hook-outcome summary. |
| `lib/mail/*` | Gmail via App Password: SMTP send (MY_EMAIL lock), IMAP reply detection. |
| `lib/calendar/*` | Slot maths (business hours, timezone) + Calendly availability/booking. |
| `app/*` | Dashboard pages and API routes. |

## Local setup

```bash
npm install
cp .env.example .env.local      # fill it in (see below)
npm run db:push                 # creates tables on Neon (or: run drizzle/0000_init.sql)
npm run models                  # lists Gemini models for your key; set GEMINI_FAST_MODEL / GEMINI_SMART_MODEL
npm test                        # 67 tests
npm run dev                     # http://localhost:3000 (login only if DASHBOARD_PASSWORD is set)
```

To try Steps 1–3 without a database (prints the decision trail):

```bash
npm run try -- --scrape-only linear.app     # no keys needed
npm run try -- linear.app posthog.com       # needs GEMINI_API_KEY
```

### Neon

1. Create a project at neon.tech, or add Neon from the Vercel Marketplace.
2. Copy the **pooled** connection string into `DATABASE_URL`.
3. Run `npm run db:push`. The LangGraph checkpointer creates its own tables on first use.

### Gmail (App Password) — no Google Cloud project needed

1. Your Google account needs **2-Step Verification** on (myaccount.google.com → Security).
2. Go to **myaccount.google.com/apppasswords**, create one named `sprinto-agent`, and copy the 16-character password.
   (On a Google Workspace / school account the admin may have disabled App Passwords; use a personal Gmail as `MY_EMAIL` in that case.)
3. In Gmail → Settings → **Forwarding and POP/IMAP** → make sure **IMAP is enabled**.
4. Set `GMAIL_APP_PASSWORD` (spaces are fine). `GMAIL_USER` defaults to `MY_EMAIL`.

The agent **sends** over SMTP (`smtp.gmail.com:465`) and **reads replies** over IMAP: any message from you whose `In-Reply-To`/`References` points at one of the agent's emails is treated as the prospect's reply. Settings shows a live SMTP + IMAP check.

### Calendly (scheduling)

- `CALENDLY_URL` — your event link (e.g. `https://calendly.com/you/30min`). Proposals and confirmations include it.
- `CALENDLY_TOKEN` (optional) — Calendly → Integrations → **API & Webhooks** → Personal Access Token. With it, proposed times come from your **real Calendly availability**, and on confirmation the agent tries Calendly's booking API (invitee = `MY_EMAIL`). If your plan doesn't allow API booking, the confirmation email carries the slot's Calendly link so the invite can be locked in.

### Gemini

Create a key at aistudio.google.com and set `GEMINI_API_KEY`. The defaults are `gemini-2.5-flash` (fast) and `gemini-2.5-pro` (smart). Run `npm run models` and switch to newer Flash/Pro names if your key has them.

## Deploy (GitHub → Vercel Hobby)

```bash
git remote add origin git@github.com:<you>/sprinto-outbound-agent.git
git push -u origin main
```

1. In Vercel, use **Add New → Project → Import** the repo. Framework: Next.js.
2. Add every variable from `.env.example` under **Settings → Environment Variables**.
3. Set `CRON_SECRET` (Vercel sends it as `Authorization: Bearer …` to `/api/cron/daily`). `vercel.json` schedules it daily at 03:30 UTC (09:00 IST).
4. Deploy and open the app; **Settings** should show SMTP ok / IMAP ok.

Hobby crons run only once a day, so replies are also checked:
- by **Check replies now** on the Overview,
- every 60 s while **Conversations** is open,
- by **Run daily jobs now**, which runs the same code as the cron.

## Running the demo

1. Set `FOLLOWUP_1_AFTER=5m` and `FOLLOWUP_2_AFTER=5m` (and optionally `BACKUP_REVISIT_*=10m`) and redeploy or restart.
2. **Run** → paste domains or upload `domains.csv`. Upload contacts (`contacts.example.csv` shows the format) for the domains you expect to qualify. Click **Queue & run**. Each company is one request; the page loops until the queue is empty.
3. Open a company to see its decision log: gates, signals with quotes and links, fetch trail, contact choice and rejections, pain points, email, quality gate and rules applied.
4. The cold email lands in `MY_EMAIL`. **Reply to it from your inbox** as the prospect (for example "Sounds good — what times work?"), then click **Check replies now**. You can also use **Simulate prospect reply** on the Conversations page.
5. To test follow-ups, wait 5 minutes and click **Run daily jobs now** → follow-up #1. Repeat for #2, then Backup.
6. Give 👍/👎 feedback under an email. Rules show up on **Feedback & rules** and are injected into the next drafts.

## Safety

- Only `MY_EMAIL` ever receives email (enforced in `sendEmail`, unit-tested). Every email ends with a footer naming the intended recipient.
- With `DRY_RUN=true` (env, or the per-run checkbox), emails are drafted and stored but Gmail is never called.
- Bot walls, logins and CAPTCHAs are detected and never bypassed. robots.txt is checked before every URL.
- The dashboard is password-gated when `DASHBOARD_PASSWORD` is set (signed httpOnly cookie); set it before sharing a public URL. Cron uses `CRON_SECRET`. All keys stay server-side.
