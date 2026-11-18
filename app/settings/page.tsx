import { publicConfig, config } from "@/lib/env";
import { testMailConnection } from "@/lib/mail";
import { calendlyStatus } from "@/lib/calendar/calendly";
import { Card, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [mail, cal] = await Promise.all([
    testMailConnection().catch((e) => ({ smtp: `error: ${String(e)}`, imap: "—" })),
    calendlyStatus().catch((e) => ({ url: config.calendlyUrl || null, token: !!config.calendlyToken, error: String(e) })),
  ]);
  const cfg = publicConfig();
  const tone = (s: string) => (s === "ok" ? "green" : s === "not configured" ? "amber" : "red") as "green" | "amber" | "red";
  return (
    <div className="space-y-6">
      <div><h1 className="h1">Settings</h1><p className="muted">Configuration comes from environment variables. Secrets are never shown.</p></div>
      <Card title="Gmail (App Password · SMTP + IMAP)">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Account: <b>{config.gmailUser || "—"}</b></span>
          <Pill tone={tone(mail.smtp)}>send (SMTP): {mail.smtp}</Pill>
          <Pill tone={tone(mail.imap)}>read replies (IMAP): {mail.imap}</Pill>
        </div>
        <p className="mt-2 text-xs text-slate-500">Set <span className="mono">GMAIL_APP_PASSWORD</span> (Google Account → Security → 2-Step Verification → App passwords). IMAP must be enabled in Gmail settings → Forwarding and POP/IMAP.</p>
      </Card>
      <Card title="Calendly (scheduling)">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Pill tone={cal.url ? "green" : "amber"}>link: {cal.url ?? "CALENDLY_URL not set"}</Pill>
          <Pill tone={cal.token ? ("error" in cal && cal.error ? "red" : "green") : "slate"}>token: {cal.token ? ("error" in cal && cal.error ? "error" : "ok") : "not set (business-hours slots only)"}</Pill>
          {"eventType" in cal && cal.eventType && <Pill tone="blue">event type: {cal.eventType}</Pill>}
        </div>
        {"error" in cal && cal.error && <p className="mt-2 text-xs text-red-700">{cal.error}</p>}
        <p className="mt-2 text-xs text-slate-500">With a token, proposed times come from your real Calendly availability and the agent tries to book via Calendly&apos;s API; otherwise confirmations include your Calendly link to lock the time in.</p>
      </Card>
      <Card title="Mode">
        <div className="flex flex-wrap gap-2">
          <Pill tone="amber">LIVE TEST: all email → {config.myEmail || "MY_EMAIL not set!"}</Pill>
          <Pill tone={config.dryRunEnv ? "amber" : "green"}>DRY_RUN env = {String(config.dryRunEnv)}</Pill>
          <Pill tone={config.passwordGate ? "green" : "amber"}>dashboard login: {config.passwordGate ? "on" : "off"}</Pill>
        </div>
      </Card>
      <Card title="Configuration (non-secret)">
        <table className="tbl"><tbody>{Object.entries(cfg).map(([k, v]) => <tr key={k}><td className="mono">{k}</td><td>{String(v)}</td></tr>)}</tbody></table>
      </Card>
    </div>
  );
}
