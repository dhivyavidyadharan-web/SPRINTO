import { handler, json } from "@/lib/api";
import { runLearning } from "@/lib/learning";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** "Run learning now" button. */
export const POST = handler(async () => json(await runLearning("human")));
