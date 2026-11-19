import { handler, json } from "@/lib/api";
import { decideSuggestion } from "@/lib/learning";

export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const b = (await req.json()) as { approve?: boolean };
  return json(await decideSuggestion(Number(id), !!b.approve));
});
