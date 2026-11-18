import { publicConfig, config } from "@/lib/env";
import { googleStatus } from "@/lib/google/auth";
import { Card, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const sp = await searchParams;
  const g = await googleStatus().catch(() => ({ connected: false, email: null as string | null }));
  const cfg = publicConfig();
  const mismatch = g.connected && g.email && config.myEmail && g.email.toLowerCase() !== config.myEmail;
  return (
    <div className="space-y-6">
      <div><h1 className="h1">Settings</h1><p className="muted">Configuration comes from environment variables. Secrets are never shown.</p></div>
      {sp.google && <div className={`card px-4 py-3 text-sm ${sp.google === "connected" ? "text-brand-800" : "text-red-700"}`}>Google: {sp.google}</div>}
      <Card title="Google (Gmail + Calendar)">
        <div className="flex flex-wrap items-center gap-3">
          {g.connected ? <Pill tone="green">Google connected ✓ {g.email}</Pill> : <Pill tone="amber">Not connected</Pill>}
          <a className="btn-primary" href="/api/google/connect">{g.connected ? "Reconnect Google" : "Connect Google"}</a>
        </div>
        {mismatch && <p className="mt-2 text-sm text-red-700">Warning: connected account ({g.email}) differs from MY_EMAIL ({config.myEmail}). Emails are still sent only to MY_EMAIL.</p>}
        <p className="mt-2 text-xs text-slate-500">Scopes: gmail.modify, calendar. Refresh token stored encrypted (AES-256-GCM) in the settings table.</p>
      </Card>
      <Card title="Mode">
        <div className="flex flex-wrap gap-2">
          <Pill tone="amber">LIVE TEST: all email → {config.myEmail || "MY_EMAIL not set!"}</Pill>
          <Pill tone={config.dryRunEnv ? "amber" : "green"}>DRY_RUN env = {String(config.dryRunEnv)}</Pill>
        </div>
      </Card>
      <Card title="Configuration (non-secret)">
        <table className="tbl"><tbody>{Object.entries(cfg).map(([k, v]) => <tr key={k}><td className="mono">{k}</td><td>{String(v)}</td></tr>)}</tbody></table>
      </Card>
    </div>
  );
}
