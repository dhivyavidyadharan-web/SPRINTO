import Link from "next/link";
import { desc, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/env";
import { Card, StatusBadge, timeAgo } from "@/components/ui";
import { ContactsUpload, RunPanel } from "@/components/actions";

export const dynamic = "force-dynamic";

export default async function RunPage() {
  const queue = await db().select().from(schema.companies).where(inArray(schema.companies.status, ["QUEUED", "PROCESSING"])).orderBy(schema.companies.updatedAt);
  const recent = await db().select().from(schema.companies).orderBy(desc(schema.companies.updatedAt)).limit(15);
  const contacts = await db().execute(sql`SELECT domain, count(*)::int AS n FROM contacts GROUP BY domain ORDER BY domain`);
  return (
    <div className="space-y-6">
      <div><h1 className="h1">Run</h1><p className="muted">Paste domains (one per line) or upload <span className="mono">domains.csv</span>. Each company is processed in its own request (≤ 60 s) while this page loops.</p></div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Queue domains & run" className="lg:col-span-2"><RunPanel envDryRun={config.dryRunEnv} /></Card>
        <Card title={`Queue (${queue.length})`}>
          {queue.length === 0 ? <p className="muted">Queue is empty.</p> : <ul className="space-y-1 text-sm">{queue.map((c) => <li key={c.id} className="flex justify-between"><span>{c.domain}{c.resumeFrom ? <span className="text-xs text-slate-400"> (resume: {c.resumeFrom})</span> : null}</span><StatusBadge status={c.status} /></li>)}</ul>}
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Contacts (CSV from Apollo)" className="lg:col-span-2">
          <p className="muted mb-2">Columns: <span className="mono">domain,first_name,last_name,title,email,linkedin_url</span>. Companies waiting in <em>Input needed → no contact</em> auto-resume from Step 4.</p>
          <ContactsUpload />
        </Card>
        <Card title="Contacts on file">
          {(contacts.rows as { domain: string; n: number }[]).length === 0 ? <p className="muted">None uploaded yet.</p> :
            <ul className="space-y-0.5 text-sm">{(contacts.rows as { domain: string; n: number }[]).map((r) => <li key={r.domain} className="flex justify-between"><span>{r.domain}</span><span className="text-slate-500">{r.n}</span></li>)}</ul>}
        </Card>
      </div>
      <Card title="Recently processed">
        <table className="tbl">
          <thead><tr><th>Domain</th><th>Status</th><th>Score</th><th>Flags</th><th>Updated</th></tr></thead>
          <tbody>{recent.map((c) => (
            <tr key={c.id}><td><Link className="font-medium text-brand-700" href={`/companies/${c.domain}`}>{c.domain}</Link></td><td><StatusBadge status={c.status} /></td><td>{c.score ?? "—"}</td><td className="text-xs">{c.flags.join(", ") || "—"}</td><td className="text-xs text-slate-500">{timeAgo(c.updatedAt)}</td></tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  );
}
