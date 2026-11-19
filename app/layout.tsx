import "./globals.css";
import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { Nav, MobileNav } from "@/components/Nav";
import { CompanySearch } from "@/components/CompanySearch";

const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });

export const metadata: Metadata = { title: "Sprinto Outbound Agent", description: "Autonomous outbound agent dashboard (live test)" };
export const dynamic = "force-dynamic";

async function counts() {
  try {
    const r = await db().execute(sql`
      SELECT
        (SELECT count(*)::int FROM companies WHERE status = 'INPUT_NEEDED') AS input_needed,
        (SELECT count(*)::int FROM companies WHERE status IN ('BACKUP','FOLLOWUP_1_SENT','FOLLOWUP_2_SENT','NURTURE')) AS cold,
        (SELECT count(*)::int FROM emails e WHERE e.kind IN ('cold','followup_1','followup_2') AND e.send_status IN ('sent','dry_run')
           AND NOT EXISTS (SELECT 1 FROM feedback f WHERE f.email_id = e.id)) AS feedback,
        (SELECT count(*)::int FROM learning_suggestions WHERE status = 'pending') AS learning`);
    const row = r.rows[0] as { input_needed: number; cold: number; feedback: number; learning: number };
    return { inputNeeded: row.input_needed, cold: row.cold, feedback: row.feedback, learning: row.learning };
  } catch {
    return { inputNeeded: 0, cold: 0, feedback: 0, learning: 0 };
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const c = await counts();
  return (
    <html lang="en" className={instrument.variable}>
      <body className="font-sans">
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-32 right-[-10%] h-[420px] w-[420px] animate-floaty rounded-full bg-blush-200/40 blur-3xl" />
          <div className="absolute bottom-[-20%] left-[20%] h-[480px] w-[480px] animate-floaty rounded-full bg-lavender-200/50 blur-3xl [animation-delay:-7s]" />
        </div>
        <div className="flex min-h-screen">
          <Nav counts={c} passwordGate={!!process.env.DASHBOARD_PASSWORD} />
          <div className="min-w-0 flex-1">
            <MobileNav counts={c} />
            <CompanySearch />
            <main className="mx-auto max-w-[1400px] px-4 py-7 md:px-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
