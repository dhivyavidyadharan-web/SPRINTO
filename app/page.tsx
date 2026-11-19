import Link from "next/link";
import { desc, eq, gte, sql } from "drizzle-orm";
import { Building2, BadgeCheck, Send, CalendarCheck2, AlertTriangle, Coins, Snowflake, Sparkles, Bot, User, Clock, ArrowRight, CalendarDays } from "lucide-react";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/env";
import { coldDeals, COLD_LABELS, feedbackQueue } from "@/lib/dashboard";
import { hookSummary } from "@/lib/feedback";
import { Card, Stat, StatusBadge, fmtDate, timeAgo } from "@/components/ui";
import { ActionButtons } from "@/components/actions";
import { ColdTable } from "@/components/ColdTable";
import { Greeting } from "@/components/motion";

export const dynamic = "force-dynamic";

const sum = (by: Record<string, number>, keys: string[]) => keys.reduce((n, k) => n + (by[k] ?? 0), 0);
const EMAILED = ["EMAILED", "FOLLOWUP_1_SENT", "FOLLOWUP_2_SENT", "IN_CONVERSATION", "MEETING_BOOKED", "BACKUP", "DO_NOT_CONTACT"];

const ACTOR_ICON: Record<string, React.ReactNode> = {
  agent: <Bot size={13} />, pipeline: <Sparkles size={13} />, human: <User size={13} />, cron: <Clock size={13} />,
};
const EVENT_LABELS: Record<string, string> = {
  enqueued: "added to the queue", processing_started: "research started", qualified_verdict: "verdict decided",
  qualified_continue_outreach: "qualified — moving to outreach", contact_chosen: "decision-maker chosen", cold_email_sent: "cold email sent",
  conversation_started: "conversation started", resume_reply: "reply received", resume_no_reply_check: "checked for silence",
  positive_reply: "positive reply", email_scheduling: "times proposed", email_confirmation: "meeting confirmed by email",
  calendly_booking: "booked in Calendly", stage_booked: "meeting booked", email_decline_ack: "decline acknowledged",
  stage_declined: "moved to Backup (declined)", stage_backup: "moved to Backup", stage_unsubscribed: "unsubscribed",
  email_clarify: "asked a clarifying question", followup_1_sent: "follow-up 1 sent", followup_2_sent: "follow-up 2 sent",
  input_needed: "needs your input", daily_jobs_ran: "daily jobs ran", feedback_submitted: "feedback given",
  feedback_distilled: "rules learned from feedback", reengage_requested: "re-engaged", unreachable: "site unreachable",
  requeued_after_revisit: "revisit date reached — re-queued", pipeline_error: "pipeline error", send_failed: "send failed",
};
const label = (t: string) => EVENT_LABELS[t] ?? t.replace(/_/g, " ");

const ACTOR_STYLE: Record<string, string> = {
  agent: "bg-blush-100 text-blush-700", pipeline: "bg-lavender-200 text-brand-800", human: "bg-zest-200 text-brand-900", cron: "bg-sky-100 text-sky-800",
};

export default async function Overview() {
  const counts = await db().execute(sql`SELECT status, count(*)::int AS n FROM companies GROUP BY status`);
  const by = Object.fromEntries((counts.rows as { status: string; n: number }[]).map((r) => [r.status, r.n])) as Record<string, number>;
  const replied = ((await db().execute(sql`SELECT count(DISTINCT company_id)::int AS n FROM events WHERE type = 'resume_reply'`)).rows[0] as { n: number }).n;
  const tokens = (await db().execute(sql`SELECT coalesce(sum((decision_log->'tokens'->>'in')::int + (decision_log->'tokens'->>'out')::int),0)::int AS t, coalesce(sum((decision_log->>'estCostUsd')::float),0)::float AS c FROM companies WHERE decision_log IS NOT NULL`)).rows[0] as { t: number; c: number };
  const events = await db().select({ e: schema.events, domain: schema.companies.domain, name: schema.companies.name }).from(schema.events).leftJoin(schema.companies, eq(schema.events.companyId, schema.companies.id)).orderBy(desc(schema.events.id)).limit(14);
  const meetings = await db().select({ m: schema.meetings, c: schema.companies }).from(schema.meetings).innerJoin(schema.companies, eq(schema.meetings.companyId, schema.companies.id)).where(gte(schema.meetings.startAt, new Date(Date.now() - 3_600_000))).orderBy(schema.meetings.startAt).limit(4);
  const cold = await coldDeals();
  const fq = await feedbackQueue(50);
  const activeRules = ((await db().execute(sql`SELECT count(*)::int AS n FROM rules WHERE status = 'active'`)).rows[0] as { n: number }).n;
  const hooks = await hookSummary();

  const total = Object.values(by).reduce((a, b) => a + b, 0);
  const scraped = total - sum(by, ["QUEUED", "PROCESSING"]);
  const qualified = sum(by, ["QUALIFIED", ...EMAILED]);
  const emailed = sum(by, EMAILED);
  const booked = by.MEETING_BOOKED ?? 0;
  const funnel = [
    { label: "Scraped", n: scraped }, { label: "Qualified", n: qualified }, { label: "Emailed", n: emailed },
    { label: "Replied", n: replied }, { label: "Booked", n: booked },
  ];
  const max = Math.max(1, ...funnel.map((f) => f.n));
  const firstName = config.senderName.split(" ")[0];

  const coldRows = cold.filter((c) => c.kind !== "unsubscribed").map((c) => ({
    ...c, kindLabel: COLD_LABELS[c.kind].label, lastActivity: c.lastActivity.toISOString(), revisitAfter: c.revisitAfter?.toISOString() ?? null,
  }));

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="grad-hero reveal relative overflow-hidden rounded-3xl px-6 py-7 text-white shadow-lift md:px-8">
        <div className="pointer-events-none absolute -right-10 -top-16 h-64 w-64 animate-floaty rounded-full bg-blush-400/30 blur-3xl" />
        <div className="pointer-events-none absolute bottom-[-60px] left-1/3 h-48 w-48 animate-floaty rounded-full bg-zest-300/15 blur-3xl [animation-delay:-5s]" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80 backdrop-blur">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping2 rounded-full bg-zest-300" /><span className="relative inline-flex h-2 w-2 rounded-full bg-zest-300" /></span>
              Live test · all email goes to {config.myEmail}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight md:text-[34px]"><Greeting name={firstName} /> <span className="text-zest-300">✦</span></h1>
            <p className="mt-1 max-w-xl text-white/75">
              {booked ? <>You have <b className="text-zest-300">{booked} meeting{booked > 1 ? "s" : ""}</b> booked. </> : null}
              {fq.pending.length ? <><b className="text-blush-200">{fq.pending.length}</b> email{fq.pending.length > 1 ? "s are" : " is"} waiting for your feedback. </> : null}
              {by.INPUT_NEEDED ? <><b className="text-amber-300">{by.INPUT_NEEDED}</b> need{by.INPUT_NEEDED === 1 ? "s" : ""} your input.</> : "Nothing needs your input right now."}
            </p>
          </div>
          <ActionButtons hero />
        </div>
      </section>

      {/* Metric tiles — append to this list to add more metrics later */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Companies" value={total} icon={<Building2 size={16} />} tone="lavender" delay={60} href="/board" hint={`${scraped} researched`} />
        <Stat label="Qualified" value={qualified} icon={<BadgeCheck size={16} />} tone="zest" delay={110} hint={scraped ? `${Math.round((qualified / scraped) * 100)}% of researched` : undefined} />
        <Stat label="Emails out" value={emailed} icon={<Send size={16} />} tone="pink" delay={160} hint={`${replied} replied`} href="/conversations" />
        <Stat label="Meetings" value={booked} icon={<CalendarCheck2 size={16} />} tone="plum" delay={210} hint={emailed ? `${Math.round((booked / emailed) * 100)}% of emailed` : undefined} />
        <Stat label="Input needed" value={by.INPUT_NEEDED ?? 0} icon={<AlertTriangle size={16} />} tone="amber" delay={260} href="/input-needed" />
        <Stat label="LLM cost" value={tokens.c ?? 0} prefix="$" decimals={3} icon={<Coins size={16} />} tone="sky" delay={310} hint={`${(tokens.t ?? 0).toLocaleString()} tokens`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Funnel */}
        <Card title="Funnel" className="lg:col-span-2" delay={200}>
          <div className="space-y-3.5">
            {funnel.map((f, i) => {
              const prev = i > 0 ? funnel[i - 1].n : null;
              const conv = prev ? Math.round((f.n / prev) * 100) : null;
              return (
                <div key={f.label} className="group">
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-medium text-ink-700">{f.label}</span>
                    <span className="flex items-baseline gap-2"><span className="text-xs text-ink-500">{conv !== null ? `${conv}%` : ""}</span><b className="text-brand-900">{f.n}</b></span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-cream-200">
                    <div className="h-full origin-left animate-grow-x rounded-full bg-gradient-to-r from-brand-700 via-blush-500 to-blush-400 transition-all group-hover:brightness-110" style={{ width: `${Math.max(4, (f.n / max) * 100)}%`, animationDelay: `${300 + i * 120}ms` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-5 flex flex-wrap gap-1.5">{Object.entries(by).map(([s, n]) => <span key={s} className="flex items-center gap-1"><StatusBadge status={s} /><span className="text-xs font-semibold text-ink-700">{n}</span></span>)}</div>
        </Card>

        {/* Feedback loop */}
        <Card title="Feedback loop" icon={<Sparkles size={15} className="text-blush-500" />} className="lg:col-span-3" delay={260}
          right={<Link href="/feedback" className="text-xs font-semibold text-blush-600 hover:text-brand-700">Open →</Link>}>
          <div className="grid gap-4 md:grid-cols-3">
            <Link href="/feedback" className="group rounded-2xl bg-gradient-to-br from-blush-50 to-white p-4 ring-1 ring-blush-100 transition hover:-translate-y-0.5 hover:shadow-soft">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-blush-700">Waiting for you</div>
              <div className="mt-1 text-3xl font-semibold text-brand-900">{fq.pending.length}</div>
              <div className="mt-1 flex items-center gap-1 text-xs text-ink-500">emails to rate <ArrowRight size={12} className="transition-transform group-hover:translate-x-1" /></div>
            </Link>
            <div className="rounded-2xl bg-gradient-to-br from-lavender-100 to-white p-4 ring-1 ring-lavender-200">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-700">Rules learned</div>
              <div className="mt-1 text-3xl font-semibold text-brand-900">{activeRules}</div>
              <div className="mt-1 text-xs text-ink-500">applied to every new draft</div>
            </div>
            <div className="rounded-2xl bg-gradient-to-br from-zest-100 to-white p-4 ring-1 ring-zest-200">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-800">Reviewed</div>
              <div className="mt-1 text-3xl font-semibold text-brand-900">{fq.reviewed}</div>
              <div className="mt-1 text-xs text-ink-500">emails rated so far</div>
            </div>
          </div>
          <div className="mt-4 rounded-xl bg-cream-50 px-3 py-2.5 text-xs text-ink-700 ring-1 ring-brand-50">
            <div className="mb-1 font-semibold text-brand-800">What's landing (by opening line)</div>
            <pre className="whitespace-pre-wrap font-sans">{hooks}</pre>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Cold deals */}
        <Card title="Gone cold" icon={<Snowflake size={15} className="text-sky-500" />} className="lg:col-span-3" delay={300}
          right={<Link href="/cold" className="text-xs font-semibold text-blush-600 hover:text-brand-700">All cold deals →</Link>}>
          <ColdTable rows={coldRows} compact />
        </Card>

        {/* Upcoming meetings */}
        <Card title="Upcoming meetings" icon={<CalendarDays size={15} className="text-brand-600" />} className="lg:col-span-2" delay={340}>
          {meetings.length === 0 ? <p className="muted py-4 text-center">No meetings yet. They appear here as soon as a prospect agrees a time.</p> : (
            <ul className="space-y-2.5">
              {meetings.map(({ m, c }, i) => (
                <li key={m.id} className="reveal flex items-center gap-3 rounded-2xl bg-gradient-to-r from-brand-700 to-blush-600 p-3 text-white shadow-soft" style={{ animationDelay: `${400 + i * 80}ms` }}>
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/15 text-center leading-none">
                    <div><div className="text-[10px] uppercase text-white/70">{new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: config.timezone }).format(m.startAt)}</div><div className="text-lg font-bold">{new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: config.timezone }).format(m.startAt)}</div></div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link href={`/companies/${c.domain}`} className="font-semibold hover:underline">{c.name ?? c.domain}</Link>
                    <div className="text-xs text-white/75">{fmtDate(m.startAt)}</div>
                  </div>
                  {m.calendarEventId && !m.calendarEventId.startsWith("calendly-link:") && <span className="rounded-md bg-zest-300 px-1.5 py-0.5 text-[10px] font-bold text-brand-900">Calendly ✓</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Activity */}
      <Card title="Recent activity" delay={380}>
        {events.length === 0 ? <p className="muted">No activity yet — go to <Link href="/run" className="text-blush-600 underline">Run</Link> to queue domains.</p> : (
          <ol className="relative space-y-1 border-l-2 border-blush-100 pl-5">
            {events.map(({ e, domain, name }, i) => (
              <li key={e.id} className="reveal relative py-1 text-sm" style={{ animationDelay: `${420 + i * 35}ms` }}>
                <span className={`absolute -left-[31px] top-1.5 grid h-5 w-5 place-items-center rounded-full ring-4 ring-white ${ACTOR_STYLE[e.actor] ?? "bg-cream-200"}`}>{ACTOR_ICON[e.actor]}</span>
                <span className="text-ink-700">{domain ? <Link className="font-semibold text-brand-800 hover:text-blush-600" href={`/companies/${domain}`}>{name ?? domain}</Link> : <span className="font-semibold text-ink-500">System</span>}</span>
                <span className="text-ink-700"> · {label(e.type)}</span>
                <span className="ml-2 text-xs text-ink-500">{timeAgo(e.ts)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
