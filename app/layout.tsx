import "./globals.css";
import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { Nav, MobileNav } from "@/components/Nav";

export const metadata: Metadata = { title: "Sprinto Outbound Agent", description: "Autonomous outbound agent dashboard (live test)" };
export const dynamic = "force-dynamic";

async function inputNeededCount() {
  try {
    const r = await db().execute(sql`SELECT count(*)::int AS n FROM companies WHERE status = 'INPUT_NEEDED'`);
    return (r.rows[0] as { n: number }).n;
  } catch {
    return 0;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const n = await inputNeededCount();
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <Nav inputNeeded={n} />
          <div className="min-w-0 flex-1">
            <MobileNav />
            <main className="mx-auto max-w-[1400px] px-4 py-6 md:px-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
