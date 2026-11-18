import { handler, json } from "@/lib/api";
import { applyInputAction, type InputAction } from "@/lib/inputNeeded";

export const maxDuration = 60;

export const POST = handler(async (req: Request, { params }: { params: Promise<{ companyId: string }> }) => {
  const { companyId } = await params;
  const a = (await req.json()) as InputAction;
  return json({ ok: true, result: await applyInputAction(Number(companyId), a) });
});
