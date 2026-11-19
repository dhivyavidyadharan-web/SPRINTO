# Decisions & assumptions

These are the choices made where the brief left room. Each one is easy to change. Thresholds live in `lib/rubric.ts` or in env.

## Stack / platform
- **Next.js 15**, not 16: v16 renames `middleware.ts` to `proxy.ts`. 15 keeps the brief's `middleware.ts` password gate as-is. **TypeScript 5** is pinned because Next's type-check doesn't support TS 7 yet.
- **Tailwind 3 with hand-written shadcn-style primitives** (`components/ui.tsx`) instead of the interactive shadcn CLI. Same look, no generator step.
- **Drizzle over Neon HTTP** (`drizzle-orm/neon-http`) for app queries. The LangGraph checkpointer uses `pg` against the same `DATABASE_URL`, as `PostgresSaver` requires.
- **Gemini defaults** are `gemini-2.5-flash` and `gemini-2.5-pro`. Search results disagreed on the newest model names, so both are env-driven and `npm run models` lists what your key can use. Structured output uses `responseJsonSchema`, generated from the Zod schemas (`z.toJSONSchema`), and every response is Zod-validated with one retry. Temperatures: 0 for extraction/classification, 0.7 for drafting, 0.2–0.3 for explanations and pain points.
- **Cost estimate** uses approximate list prices (Flash about $0.30/$2.50 per M tokens, Pro about $1.25/$10). It's only an indicator.

## Scraping
- **Grounding:** a fact is kept only if its evidence quote appears (after normalisation) in the page text, footer or badge hints. This turns "never infer" into a code guarantee. Values the model can't quote are dropped to `null`.
- **Hard stops:** a bot wall, login or CAPTCHA on the **homepage** makes the company `UNREACHABLE`. On a **sub-page**, the loop stops fetching (no bypass) and decides with what it has. Jina is never used to get past a wall; it's only for thin, JS-rendered pages under 200 words.
- **CAPTCHA detection** needs a CAPTCHA widget **plus** an HTTP error or a tiny page. Many healthy sites embed reCAPTCHA in contact forms, and those shouldn't be marked unreachable.
- **Page availability:** every page type counts as available, either as a discovered link or via up to 2 common fallback paths. A type that 404s still counts as visited, so the loop moves on. Discovery prefers section roots (`/changelog` over `/changelog/2026-…`) and, for security, trust subdomains or `/trust` over `/privacy`.
- **Cache:** non-homepage pages are reused if fetched successfully in the last 7 days. The homepage is always refetched because its links drive discovery.
- **robots.txt** fetches count toward `MAX_HTTP_REQUESTS_PER_COMPANY`.

## Qualification
- **"Timing decided"** in the sufficiency check means at least one T-signal **fired**, or every T-source page (careers, security, news, pricing, customers) has been visited.
- **G3 status:** `pass` when the security page was visited, or certifications were found anywhere, and none is SOC 2 / ISO 27001. Otherwise `unknown` plus the `cert_status_unverified` flag. Any SOC 2 type, or ISO 27001, fails G3. HIPAA alone does not.
- **G4 unknown** (security page not visited) is treated as "no tool" with no flag, as the brief says.
- **Low score:** `QUALIFIED` with total < 5 gets the flag `score_below_threshold`, so it's visible on the dashboard.
- **T6 undated events** count only if their evidence appears in the first ~2,000 characters of the news page (the "first screen").
- **NURTURE** companies get `revisit_after = now + NURTURE_REVISIT` (60d default) and are re-queued by the daily job.
- **Verdict explanation:** Gemini (smart) writes it **after** the code decides, citing signal and gate ids. If the call fails, the code rationale is used.

## Contacts
- **Stage unknown** (no funding stage, no headcount) uses a merged order: Security lead → CTO → Founder/CEO → VP Eng → COO.
- C-level and founder titles are exempt from the banned-function list (e.g. "Co-founder & CEO"). Every other title containing sales, marketing, growth, HR, people, talent, recruiting, support, customer success, intern, BD, partnerships and so on is rejected. Contacts also need an email and a first name, and generic inboxes are rejected.
- With `CONTACT_SOURCE=hunter`, uploaded CSV contacts are **also** considered (manual data wins on ties). Hunter responses are cached permanently in `hunter_cache`.

## Pain points & drafting
- If Gemini returns fewer than 2 valid pain points (each cited signal must have fired, and library pains must cite one of their own signals), code fills the gap from the library in a fixed order. The decision log marks these `source: "fallback"`.
- The cold email uses pain #1. Follow-up #1 uses pain #2 or a different fired signal as the new angle.
- **Quality gate, invented names check:** capitalised words in the body (excluding the greeting line and sentence starts) must appear in the company's facts or evidence, the contact, the sender or an allow-list. This is a deliberately strict heuristic. A false positive costs one rewrite, then Input needed.
- **Allowed numbers:** numbers must appear in the facts, except `2`, `27001` (SOC 2 / ISO 27001) and `15`, `20`, `30` (CTA durations).
- **Scheduling, confirmation, decline and clarify replies are deterministic templates**, not LLM text. They contain no claims and can't hallucinate a time or a fact. Follow-ups and "type an instruction" replies use Gemini.

## Agent (LangGraph)
- The graph is deterministic code. Gemini is used only to **classify** replies and to **draft** follow-ups and instruction replies. Tools (`lib/agent/tools.ts`) carry the 4-golden-rule descriptions and are called by nodes, not chosen by an LLM. That keeps every decision explicit and testable.
- The `waitForReply` node uses `interrupt()`. Resume events: `reply`, `no_reply_check` (daily job), and human actions (`human_instruction`, `mark_booked`, `move_backup`, `do_not_contact`, `retry`).
- **Thread id** is `companyId`. A company re-approached after Backup gets a fresh `"<id>-r<ts>"` thread so old state doesn't leak in.
- **Prospect goes silent mid-negotiation** (after showing interest): no "new angle" follow-ups. The thread moves to Backup after `FOLLOWUP_1_AFTER + FOLLOWUP_2_AFTER` of silence, with outcome `positive`.
- **"confirmed" with no matching offered slot:** if they named a time, it's checked like a proposal. Otherwise it counts as unclear (one clarification, then Input needed).
- **Prospect-proposed times** must be free, on a weekday, inside business hours and inside the booking window. Otherwise the agent offers 2 alternatives on different days.
- At least 2 hours' notice. Preferred slots are around 11:00, then 15:00.
- **While a thread is in Input needed**, new replies are not auto-processed. They're picked up after a human action resumes the thread.
- **Calendar event** attendee is only `MY_EMAIL`, with `sendUpdates: "none"`. It's tagged with the private extended property `sprintoCompanyId` for double-booking checks.
- **Send failures** are recorded in history, and the daily job retries them (`pendingAction`).

## Feedback
- **Duplicate detection:** the model's `duplicateOfRuleId` hint, or Jaccard similarity ≥ 0.5 of content words, same kind only. On a merge, the existing rule is kept and its text is replaced if the new phrasing is longer.
- **Cap:** above `MAX_ACTIVE_RULES`, the least-applied and then oldest rules are retired.
- **Hook outcomes** are written at terminal states (booked, positive, negative, no_reply), keyed by the cold email's `hookSignalId`. The drafter gets the top 3 hook lines.

## Dashboard / ops
- `/api/pipeline/step` claims one company with `UPDATE … FOR UPDATE SKIP LOCKED`, so double clicks can't process the same company twice.
- A pipeline exception puts the company in `INPUT_NEEDED` with reason `pipeline_error: …`, so the queue never stalls. **Retry** re-queues it.
- The Run page has a per-run DRY_RUN checkbox, stored on `companies.dry_run`. `DRY_RUN=true` in env forces it on everywhere.
- Git commits use a repo-local identity (`user.name DHIVU-PC`). Change it with `git config user.name` before pushing if you want.

## Live-run findings (2026-11-18, first runs with a real Gemini key)
- **Models:** the key cannot use `gemini-2.5-*` (retired for new users) or any 3.x Pro. Defaults are now `gemini-3.8-flash` (fast) and `gemini-4-hydrogen` (smart: largest output limit, uses thinking). Change them in env.
- **Thinking:** with default thinking, Flash spent up to 34 s on one careers page. `GEMINI_FAST_THINKING=low` brings extraction calls to 4–9 s. The smart slot keeps the model default (`GEMINI_SMART_THINKING` empty).
- **Two requests per qualified company:** Steps 1–3 run in one `/api/pipeline/step` call. A QUALIFIED company is re-queued with `resume_from = contacts`, so Steps 4–7 run in the next call (resumed companies are claimed first). Each request stays well under 60 s.
- **Security page choice:** the first Rippling run fetched the privacy policy as the "security" page, missed SOC 2 and wrongly QUALIFIED a certified company. Candidates are now real security/trust links, then `/security`, `/trust`, then `trust.<domain>`, and privacy links only last. Re-run: DISQUALIFIED (G3, "SOC 2 Type 2" on /trust/security).
- **Extraction prompt:** startups and small businesses don't count as enterprise customers (T4), and a bare "Enterprise" nav link isn't an enterprise plan (T3).
- **Loop time budget:** the qualification loop stops fetching extra pages after 35 s (`SCRAPE.LOOP_TIME_BUDGET_MS`) and decides with what it knows. The trail records "time budget reached". rize.io's 5-page run had taken 50 s.
- **G3 / certs requirement fix:** a homepage list like `["GDPR compliant"]` used to count as "certs checked" and skipped the security page (idukki.io). Now only a visited security page, an in-progress audit, a disqualifying cert or a detected tool settles it. Regression tests were added.
- **Smart-model thinking = low** by default: drafting took 7 s instead of 18 s with comparable copy, which leaves room for the one quality-gate rewrite inside 60 s.
- **First end-to-end dry run (rize.io, placeholder contact, since deleted):** the CTO was chosen and a "Head of Sales" decoy rejected. Pains were `audit_prep_eats_engineering_time` (T2) and `deals_blocked_by_security_reviews` (T3). The hook quoted "SOC 2 Type II engagement started…" from /security, the quality gate passed on attempt 1, the dry-run send worked, and the conversation is waiting for a reply.

## Gmail App Password + Calendly instead of Google OAuth (user decision, 2026-11-18)
- Google Cloud asked for billing when the user tried to set up OAuth, so the user chose a **Gmail App Password** and **Calendly**. `googleapis` and the OAuth routes are removed.
- **Sending:** nodemailer over SMTP (`smtp.gmail.com:465`). The `MY_EMAIL`-only lock is unchanged in `lib/mail/sendEmail`. We set our own `Message-ID`, and the **first email's Message-ID is the thread key** (stored in `conversations.gmail_thread_id`). Replies carry `In-Reply-To`/`References`, so Gmail keeps one thread.
- **Reply detection:** IMAP on "All Mail" (one copy of self-sent mail). It looks only at messages **from MY_EMAIL** since the conversation started, and matches `In-Reply-To`/`References` against the agent's Message-IDs. Agent-sent and already-processed IDs are skipped.
- **Calendar:** Calendly's available times (with `CALENDLY_TOKEN`) are turned into "busy" intervals on the business-hours grid, so the existing slot logic and tests are unchanged. Without a token the grid alone is used.
- **Booking:** Calendly `POST /invitees` (invitee = `MY_EMAIL`, live test). If the plan or API refuses, the agreed time is confirmed by email with the slot's Calendly link. The meeting is recorded with `calendar_event_id = calendly-link:…` and the event `calendly_booking {mode: link}` is logged. The double-booking guard checks the `meetings` table for the company.
- **Dashboard password** is optional (user request): with `DASHBOARD_PASSWORD` empty the dashboard is open. Set it before sharing a public Vercel URL.
- **First real sends (2026-11-18):** Hunter found contacts. idukki.io → Sahil Mittal (Co-Founder); rejected were the Sales Director, a co-founder at 67 confidence, and generic inboxes. rize.io → Macgill Davis (Co-Founder); rejected were the Chairman, a front-end engineer, and generic inboxes. Both hooked on T2 and passed the quality gate on the first attempt.
- **Email layout is now deterministic** (`formatEmailBody`): the Idukki draft came back as one line, so code now puts the greeting, paragraphs (hook+pain / value / CTA) and signature on separate lines. Hunter `limit=10` matches the free-plan cap.
- **First live reply (rize.io, 2026-11-19):** "I am free on 20 nov, 2pm" → classified as a proposed time, the slot was free in Calendly, the meeting was recorded and a confirmation sent in-thread, status MEETING_BOOKED. Two fixes followed:
  - Calendly `POST /invitees` returned 400 because the event type uses Google Meet. Bookings now send the event type's first `location.kind`.
  - A time proposed before any slots were offered was counted as negotiation round 1. It's now treated as interest, so no round is used. A regression test was added.
- **Email layout owned by code (2026-11-19, user feedback "everything is clammed together"):** the drafter now returns `hook / pain / value / cta` as separate fields. `lib/mail/layout.ts` assembles them as: greeting, a blank line, one paragraph per part, then "Best," with name and title. Every agent reply (scheduling, confirmation, decline, clarify, human-instruction) goes through the same `normalizeBody`. Each email also carries a minimal HTML version (one `<p>` per paragraph, the live-test footer set apart under a thin rule) so spacing renders reliably in Gmail. Plain text is still sent alongside.
- **Second live reply (idukki.io):** "Hi, not needed" → not_interested (no_need, 0.99). One acknowledgement was sent and the company moved to BACKUP with a 90-day revisit.

## News-headline check (Google News RSS), plain-English rubric page, company search (2026-11-19)
- **What:** during qualification, a news check runs **in parallel** with the page loop (`lib/scrape/news.ts`, `extractNewsFacts`). It makes two searches: `"<name>" (startup OR software OR raises OR funding OR "SOC 2" …)` and `"<domain>"`. Search engines return **zero** results for nested OR-groups, so these can't be one query.
  - Domain matches rank first. Name-only headlines must contain a business word.
  - Results are limited to the last 365 days, at most 10 headlines.
- **Grounding:** a fact from news must quote a headline verbatim, and its `sourceUrl` is the article link.
  - The model gets the homepage description and is told to ignore namesakes. Tested live: the rice-farming "Rize" Series B is rejected for rize.io; Linear's $2.5B valuation headlines are used, while linear parks and linear TV are not.
  - Company identity fields (name, product, buyer) never come from news.
  - News can fill: certifications (a "X achieves SOC 2" headline fails G3), audits in progress, funding stage, and T6 events.
- **Never blocks a decision:** the news wait is capped at deadline + 8 s. On error or timeout, the trail records it and the verdict uses the website alone. Linear end-to-end: 42 s.
- **Terms caveat (flagged to the user):**
  - news.google.com's robots.txt disallows `/rss`.
  - Both Google's and Bing's feeds say they are for personal, non-commercial feed readers.
  - This is acceptable for a live-test prototype, but a production deployment should use a licensed news API (e.g. a paid news-search API). `NEWS_SOURCE=google|bing|off` switches the source, and Bing is the automatic fallback.
- **Rubric page** is rewritten in plain English: a 5-step flow, why each gate and signal matters, live counts (gates knocked out, signals seen) and a **"try it" simulator**. The simulator calls the same pure `decideVerdict()` the pipeline uses (`computeVerdict` now delegates to it), so the two can't drift apart.
- **Company search bar** (top of every page, press `/`): finds existing companies by name or domain. Typing a website that isn't in the system offers **"Research <domain> now"**, which queues it and runs the steps inline, then opens its decision log.

## Self-learning loop: A outcome rules, B A/B tests, C self-review (2026-11-19)
- **Unit of learning:** one sent cold email.
  - Success means a positive reply or a booked meeting (`hook_outcomes`).
  - No outcome after 21 days counts as no reply. Emails still inside that window are "pending" and not used.
  - Pure statistics are in `lib/learning/stats.ts` (unit-tested); DB and LLM code is in `lib/learning/index.ts`. A separate daily cron (`/api/cron/learning`, 04:00 UTC) keeps the reply job fast. There is also a "Run learning now" button.
- **A. Outcome rules:**
  - **Finding patterns:** reply rates are compared by opening hook, pain point and length, overall and within each role and company stage.
  - **Trial:** a pattern needs ≥8 emails in its group, ≥5 in the rest, a one-sided z ≥ 1.64 and a lift ≥ 1.5×. It then becomes a **trial rule**, shown to about 50% of new cold emails (deterministic per company). At most 3 trials run at once, and one new trial starts per run.
  - **Decision:** once each arm has ≥6 outcomes, the rule is kept (goes live) only if emails with it did at least as well; otherwise it's dropped.
  - **Rollback:** a live auto rule is rolled back if results since it went live are clearly worse (z ≤ −1.64).
  - **No repeats:** a pattern already tried is never retried, and duplicates of human rules are skipped.
- **B. A/B tests:**
  - One experiment at a time, in order: CTA → subject → length → opener. Each cold email gets arm A or B (deterministic 50/50) as a "style experiment" instruction. Hard rules and the quality gate still win.
  - A winner needs ≥15 outcomes per arm and |z| ≥ 1.64, and then becomes a live rule (origin `experiment`).
  - "No winner" is declared after 40 outcomes per arm. The arm is stored on `emails.variant`.
- **C. Self-review:**
  - **Rubric points:** compares emailed leads with and without each signal and proposes ±1 point, bounded 0..4.
  - **Verdicts:** 7+ days after a Disqualified or Nurture verdict, up to 3 companies per run get an LLM second opinion on whether the *evidence* supports it. Weak cert sources, early stops and misread headcount are flagged for re-research.
  - **Approval:** both kinds are **suggestions that need a human yes**. Approved point changes are stored in `settings.rubric_overrides` and applied through `signalPoints()`; the coded defaults stay the source of truth, and there's a one-click reset. Approving a re-research re-queues the company.
- **Live state at launch:** only 2 emails have outcomes (Rize booked, Idukki declined). That's not enough for A or C yet, and the page shows progress toward each threshold. Experiment #1 (CTA style) started, so every new cold email now feeds it. Live checks:
  - verdict review on linear.app → "keep" (ISO 27001 on its security page);
  - the arm-B (soft CTA) draft for Rize passed the quality gate.

## Full button test (2026-11-19)
Every button on every page was clicked against dry-run test companies (`*.test`), which were then deleted. All buttons work. Fixes from the test:
- **Dry run could still book a real Calendly event.** `createEvent` now skips Calendly when the company or env is dry run, and logs `calendly_booking {mode: dry_run}`.
- **A referral counted as a decline.** "Not the right person, talk to Priya" sent the company to Backup for 90 days. The new reply class `needs_human` covers referrals and questions a scheduler must not answer (pricing, contracts, specific framework or feature support). It goes to Input needed with a one-line note, e.g. "Referred to Priya, Head of Security". A regression test was added.
- **Do not contact kept a revisit countdown.** The revisit date is now cleared, and the Cold deals table never shows one for DNC.
- **Trial rules showed "Re-activate"** on the Feedback page. They now show "Make live now" and "Drop".
- **Search briefly said "No company called X yet"** while the results were loading. It now shows "Searching…", and the "Research now" option waits for the search to finish.
