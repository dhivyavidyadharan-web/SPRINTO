import { handler, json } from "@/lib/api";
import { checkReplies } from "@/lib/agent/runtime";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const POST = handler(async () => json({ results: await checkReplies() }));
