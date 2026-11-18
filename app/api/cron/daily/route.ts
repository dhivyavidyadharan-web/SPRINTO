import { handler, json } from "@/lib/api";
import { runDailyJobs } from "@/lib/agent/runtime";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Vercel Cron (once a day on Hobby). Protected by CRON_SECRET (Authorization: Bearer). */
export const GET = handler(async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "unauthorized" }, 401);
  return json(await runDailyJobs("cron"));
});
