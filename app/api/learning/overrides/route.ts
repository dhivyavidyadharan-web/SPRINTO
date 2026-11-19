import { handler, json } from "@/lib/api";
import { resetRubricOverrides } from "@/lib/learning";

/** Undo every approved rubric point change (back to the coded defaults). */
export const DELETE = handler(async () => { await resetRubricOverrides(); return json({ ok: true }); });
