import { handler, json } from "@/lib/api";
import { runDailyJobs } from "@/lib/agent/runtime";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** "Run daily jobs now" button: same logic as the cron. */
export const POST = handler(async () => json(await runDailyJobs("human")));
