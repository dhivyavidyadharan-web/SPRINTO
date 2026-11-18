import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/env";
import { hookSummary } from "@/lib/feedback";
import { Card, Pill, fmtDate } from "@/components/ui";
import { RuleRow } from "@/components/actions";

export const dynamic = "force-dynamic";

export default async function FeedbackPage() {
  const rules = await db().select().from(schema.rules).orderBy(desc(schema.rules.status), desc(schema.rules.id));
  const fbs = await db().select({ f: schema.feedback, e: schema.emails, c: schema.companies }).from(schema.feedback)
    .innerJoin(schema.emails, eq(schema.feedback.emailId, schema.emails.id)).innerJoin(schema.companies, eq(schema.emails.companyId, schema.companies.id)).orderBy(desc(schema.feedback.id));
  const summary = await hookSummary();
  const active = rules.filter((r) => r.status === "active").length;
  return (
    <div className="space-y-6">
      <div><h1 className="h1">Feedback &amp; rules</h1><p className="muted">Feedback on emails is distilled into general rules that every future cold email and follow-up must apply. Max {config.maxActiveRules} active.</p></div>
      <Card title={`Rules (${active} active)`}>
        {rules.length === 0 ? <p className="muted">No rules yet. Give feedback under any sent email on its company page.</p> : (
          <table className="tbl"><thead><tr><th>ID</th><th>Kind</th><th>Rule</th><th>Status</th><th>Applied</th><th>Source</th></tr></thead><tbody>
            {rules.map((r) => (
              <tr key={r.id} className={r.status === "retired" ? "opacity-50" : ""}>
                <td className="mono">R{r.id}</td><td><Pill tone={r.kind === "do" ? "green" : "red"}>{r.kind}</Pill></td>
                <td><RuleRow id={r.id} kind={r.kind} text={r.text} status={r.status} /></td><td>{r.status}</td><td>{r.timesApplied}</td><td className="text-xs">{r.sourceFeedbackId ? `feedback #${r.sourceFeedbackId}` : "manual"}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </Card>
      <Card title="Hook performance (fed to the drafter)"><pre className="whitespace-pre-wrap text-sm">{summary}</pre></Card>
      <Card title="Feedback history">
        {fbs.length === 0 ? <p className="muted">No feedback yet.</p> : (
          <table className="tbl"><thead><tr><th>#</th><th>When</th><th>Company / email</th><th>Verdict</th><th>Working</th><th>Not working</th><th>Edited</th></tr></thead><tbody>
            {fbs.map(({ f, e, c }) => (
              <tr key={f.id}><td>{f.id}</td><td className="text-xs">{fmtDate(f.createdAt)}</td><td><Link className="text-brand-700" href={`/companies/${c.domain}`}>{c.domain}</Link><div className="text-xs text-slate-500">{e.kind}: {e.subject}</div></td><td>{f.verdict === "good" ? "👍" : "👎"}</td><td className="text-xs">{f.working}</td><td className="text-xs">{f.notWorking}</td><td className="text-xs">{f.editedBody ? "yes" : "—"}</td></tr>
            ))}
          </tbody></table>
        )}
      </Card>
    </div>
  );
}
