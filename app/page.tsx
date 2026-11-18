import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { Card, Stat, StatusBadge, timeAgo } from "@/components/ui";
import { ActionButtons } from "@/components/actions";

export const dynamic = "force-dynamic";

async function data() {
  const counts = await db().execute(sql`SELECT status, count(*)::int AS n FROM companies GROUP BY status`);
  const by = Object.fromEntries((counts.rows as { status: string; n: number }[]).map((r) => [r.status, r.n])) as Record<string, number>;
  const replied = await db().execute(sql`SELECT count(DISTINCT company_id)::int AS n FROM events WHERE type LIKE 'resume_reply' OR type = 'positive_reply'`);
  const tokens = await db().execute(sql`SELECT coalesce(sum((decision_log->'tokens'->>'in')::int + (decision_log->'tokens'->>'out')::int),0)::int AS t, coalesce(sum((decision_log->>'estCostUsd')::float),0)::float AS c FROM companies WHERE decision_log IS NOT NULL`);
  const events = await db().select({ e: schema.events, domain: schema.companies.domain }).from(schema.events).leftJoin(schema.companies, eq(schema.events.companyId, schema.companies.id)).orderBy(desc(schema.events.id)).limit(25);
  return { by, replied: (replied.rows[0] as { n: number }).n, tokens: tokens.rows[0] as { t: number; c: number }, events };
}

const sum = (by: Record<string, number>, keys: string[]) => keys.reduce((n, k) => n + (by[k] ?? 0), 0);

export default async function Overview() {
  const { by, replied, tokens, events } = await data();
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  const scraped = total - sum(by, ["QUEUED", "PROCESSING"]);
  const emailedSet = ["EMAILED", "FOLLOWUP_1_SENT", "FOLLOWUP_2_SENT", "IN_CONVERSATION", "MEETING_BOOKED", "BACKUP", "DO_NOT_CONTACT"];
  const qualified = sum(by, ["QUALIFIED", ...emailedSet]) + 0;
  const funnel = [
    { label: "Scraped", n: scraped },
    { label: "Qualified", n: qualified },
    { label: "Emailed", n: sum(by, emailedSet) },
    { label: "Replied", n: replied },
    { label: "Booked", n: by.MEETING_BOOKED ?? 0 },
  ];
  const max = Math.max(1, ...funnel.map((f) => f.n));
  // Metric cards: add new entries here to extend the Overview.
  const metrics = [
    { label: "Companies", value: total },
    { label: "Qualified", value: qualified, hint: scraped ? `${Math.round((qualified / scraped) * 100)}% of scraped` : undefined },
    { label: "Emails out", value: sum(by, emailedSet) },
    { label: "Meetings booked", value: by.MEETING_BOOKED ?? 0 },
    { label: "Input needed", value: by.INPUT_NEEDED ?? 0 },
    { label: "LLM cost (est.)", value: `$${(tokens.c ?? 0).toFixed(3)}`, hint: `${(tokens.t ?? 0).toLocaleString()} tokens` },
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="h1">Overview</h1><p className="muted">Live test mode — every email goes to MY_EMAIL only.</p></div>
        <ActionButtons />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{metrics.map((m) => <Stat key={m.label} {...m} />)}</div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Funnel" className="lg:col-span-1">
          <div className="space-y-2">
            {funnel.map((f) => (
              <div key={f.label}>
                <div className="flex justify-between text-sm"><span>{f.label}</span><span className="font-semibold">{f.n}</span></div>
                <div className="h-2 rounded bg-slate-100"><div className="h-2 rounded bg-brand-600" style={{ width: `${(f.n / max) * 100}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">{Object.entries(by).map(([s, n]) => <span key={s} className="flex items-center gap-1"><StatusBadge status={s} /><span className="text-xs">{n}</span></span>)}</div>
        </Card>
        <Card title="Recent activity" className="lg:col-span-2">
          {events.length === 0 ? <p className="muted">No activity yet — go to <Link href="/run" className="text-brand-700 underline">Run</Link> to queue domains.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {events.map(({ e, domain }) => (
                <li key={e.id} className="flex items-start gap-3 py-1.5">
                  <span className="w-16 shrink-0 text-xs text-slate-400">{timeAgo(e.ts)}</span>
                  <span className="w-16 shrink-0 text-xs font-medium uppercase text-slate-500">{e.actor}</span>
                  <span className="flex-1">{domain ? <Link className="font-medium text-brand-700" href={`/companies/${domain}`}>{domain}</Link> : <span className="text-slate-400">system</span>} · {e.type.replace(/_/g, " ")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
