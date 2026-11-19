import { handler, json } from "@/lib/api";
import { runLearning } from "@/lib/learning";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Daily self-learning run (separate cron so it never slows the reply/follow-up job). CRON_SECRET protected. */
export const GET = handler(async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "unauthorized" }, 401);
  return json(await runLearning("cron"));
});
