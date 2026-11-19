import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { MessageSquareHeart, ListChecks, PenTool, Send, TrendingUp, Sparkles } from "lucide-react";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/env";
import { hookSummary } from "@/lib/feedback";
import { feedbackQueue } from "@/lib/dashboard";
import { Card, Pill, fmtDate, timeAgo } from "@/components/ui";
import { RuleRow } from "@/components/actions";
import { FeedbackQueue } from "@/components/FeedbackQueue";

export const dynamic = "force-dynamic";

const STEPS = [
  { icon: MessageSquareHeart, title: "You rate an email", text: "👍 / 👎, what's working, what's not, or your edited version", tone: "from-blush-400 to-blush-600" },
  { icon: ListChecks, title: "Agent writes rules", text: "Turns it into 0–3 general do / don't rules, merging duplicates", tone: "from-brand-500 to-brand-700" },
  { icon: PenTool, title: "Every draft follows them", text: "Cold emails and follow-ups must apply active rules", tone: "from-lavender-300 to-brand-500" },
  { icon: TrendingUp, title: "Replies feed back", text: "Booked / declined / silent outcomes score each opening line", tone: "from-zest-400 to-zest-500" },
];

export default async function FeedbackPage() {
  const rules = await db().select().from(schema.rules).orderBy(desc(schema.rules.status), desc(schema.rules.timesApplied), desc(schema.rules.id));
  const fbs = await db().select({ f: schema.feedback, e: schema.emails, c: schema.companies }).from(schema.feedback)
    .innerJoin(schema.emails, eq(schema.feedback.emailId, schema.emails.id)).innerJoin(schema.companies, eq(schema.emails.companyId, schema.companies.id)).orderBy(desc(schema.feedback.id));
  const summary = await hookSummary();
  const q = await feedbackQueue(30);
  const active = rules.filter((r) => r.status === "active").length;
  const items = q.pending.map((p) => ({ emailId: p.emailId, domain: p.domain, companyName: p.companyName, kind: p.kind, subject: p.subject, body: p.body, sentAgo: timeAgo(p.sentAt), hookSignalId: p.hookSignalId, contact: p.contact }));

  return (
    <div className="space-y-6">
      <div className="reveal">
        <h1 className="h1 flex items-center gap-2"><Sparkles className="text-blush-500" /> Feedback loop</h1>
        <p className="muted mt-1 max-w-2xl">Teach the agent how you like to write. Every note you leave becomes a rule that all future emails follow.</p>
      </div>

      {/* How the loop works */}
      <div className="grid gap-3 md:grid-cols-4">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={s.title} className="card card-hover reveal relative p-4" style={{ animationDelay: `${60 + i * 70}ms` }}>
              <div className="flex items-center gap-3">
                <div className={`grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br ${s.tone} text-white shadow-soft`}><Icon size={18} /></div>
                <div className="text-xs font-bold text-ink-500">STEP {i + 1}</div>
              </div>
              <div className="mt-3 font-semibold text-brand-900">{s.title}</div>
              <div className="mt-0.5 text-xs text-ink-500">{s.text}</div>
              {i < STEPS.length - 1 && <div className="absolute -right-3 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-white text-blush-500 shadow-soft md:grid">→</div>}
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="space-y-3 xl:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-brand-900"><Send size={17} className="text-blush-500" /> Waiting for your feedback <span className="rounded-full bg-blush-500 px-2 text-xs font-bold text-white">{items.length}</span></h2>
            <span className="text-xs text-ink-500">{q.reviewed} reviewed so far</span>
          </div>
          <FeedbackQueue items={items} />
        </div>

        <div className="space-y-6 xl:col-span-2">
          <Card title={`Rules the agent follows (${active}/${config.maxActiveRules} active)`} delay={200}>
            {rules.length === 0 ? (
              <p className="muted py-3 text-center">No rules yet. Rate an email on the left and the agent will turn your notes into rules here.</p>
            ) : (
              <ul className="space-y-2">
                {rules.map((r, i) => (
                  <li key={r.id} className={`reveal rounded-xl p-2.5 text-sm ring-1 ${r.status !== "retired" ? "bg-white ring-brand-100" : "bg-cream-50 opacity-60 ring-cream-200"}`} style={{ animationDelay: `${240 + i * 40}ms` }}>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="mono text-ink-500">R{r.id}</span>
                      <Pill tone={r.kind === "do" ? "green" : "red"}>{r.kind === "do" ? "DO" : "DON'T"}</Pill>
                      {r.status === "trial" && <Pill tone="amber">on trial</Pill>}
                      <span className="ml-auto text-[11px] text-ink-500">applied {r.timesApplied}× · {r.origin === "outcome" ? <Link href="/learning" className="font-semibold text-blush-600">learned from replies</Link> : r.origin === "experiment" ? <Link href="/learning" className="font-semibold text-blush-600">A/B test winner</Link> : r.sourceFeedbackId ? `from feedback #${r.sourceFeedbackId}` : "manual"}</span>
                    </div>
                    <RuleRow id={r.id} kind={r.kind} text={r.text} status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="What's landing (reply outcomes by opening line)" delay={260}>
            <pre className="whitespace-pre-wrap font-sans text-sm text-ink-700">{summary}</pre>
            <p className="mt-2 text-xs text-ink-500">The drafter sees this summary too, and leans toward openings that get replies.</p>
          </Card>
        </div>
      </div>

      <Card title="Feedback history" delay={320}>
        {fbs.length === 0 ? <p className="muted">No feedback yet.</p> : (
          <table className="tbl"><thead><tr><th>When</th><th>Company / email</th><th>Verdict</th><th>Working</th><th>Not working</th><th>Edited</th></tr></thead><tbody>
            {fbs.map(({ f, e, c }) => (
              <tr key={f.id}><td className="whitespace-nowrap text-xs">{fmtDate(f.createdAt)}</td><td><Link className="font-semibold text-brand-800 hover:text-blush-600" href={`/companies/${c.domain}`}>{c.name ?? c.domain}</Link><div className="text-xs text-ink-500">{e.kind}: {e.subject}</div></td><td>{f.verdict === "good" ? "👍" : "👎"}</td><td className="text-xs">{f.working}</td><td className="text-xs">{f.notWorking}</td><td className="text-xs">{f.editedBody ? "yes" : "—"}</td></tr>
            ))}
          </tbody></table>
        )}
      </Card>
    </div>
  );
}
