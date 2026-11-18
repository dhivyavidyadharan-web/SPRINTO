import { handler, json } from "@/lib/api";
import { pipelineStep } from "@/lib/pipeline/run";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Processes exactly ONE queued company. The dashboard calls this in a loop until done. */
export const POST = handler(async () => json(await pipelineStep()));
