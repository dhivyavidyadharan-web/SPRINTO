import { Snowflake, ThermometerSnowflake, Hourglass, MailX, Sprout } from "lucide-react";
import { coldDeals, COLD_LABELS } from "@/lib/dashboard";
import { Card, Stat } from "@/components/ui";
import { ColdTable } from "@/components/ColdTable";

export const dynamic = "force-dynamic";

export default async function ColdPage() {
  const deals = await coldDeals();
  const rows = deals.map((d) => ({ ...d, kindLabel: COLD_LABELS[d.kind].label, lastActivity: d.lastActivity.toISOString(), revisitAfter: d.revisitAfter?.toISOString() ?? null }));
  const n = (k: string) => deals.filter((d) => d.kind === k).length;
  const dueSoon = deals.filter((d) => d.revisitAfter && d.revisitAfter.getTime() - Date.now() < 14 * 86_400_000).length;
  return (
    <div className="space-y-6">
      <div className="reveal">
        <h1 className="h1 flex items-center gap-2"><Snowflake className="text-sky-500" /> Cold deals</h1>
        <p className="muted mt-1 max-w-2xl">Deals that declined, went silent, or aren&apos;t ready yet. Each one is parked with a revisit date, and the daily job brings it back automatically when that date passes. Use <b>Re-engage</b> to bring one back now.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={COLD_LABELS.declined.label} value={n("declined")} icon={<MailX size={16} />} tone="pink" delay={40} hint={COLD_LABELS.declined.hint} />
        <Stat label={COLD_LABELS.no_reply.label} value={n("no_reply")} icon={<ThermometerSnowflake size={16} />} tone="sky" delay={90} hint={COLD_LABELS.no_reply.hint} />
        <Stat label={COLD_LABELS.cooling.label} value={n("cooling")} icon={<Hourglass size={16} />} tone="lavender" delay={140} hint={COLD_LABELS.cooling.hint} />
        <Stat label={COLD_LABELS.nurture.label} value={n("nurture")} icon={<Sprout size={16} />} tone="zest" delay={190} hint={COLD_LABELS.nurture.hint} />
        <Stat label="Revisit ≤ 14 days" value={dueSoon} icon={<Snowflake size={16} />} tone="plum" delay={240} hint="Coming back on their own soon" />
      </div>
      <Card title="All cold deals" delay={280}>
        <ColdTable rows={rows} />
      </Card>
    </div>
  );
}
