import { NextResponse, type NextRequest } from "next/server";
import { storeTokensFromCode } from "@/lib/google/auth";
import { logEvent } from "@/lib/db/events";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expected = req.cookies.get("g_oauth_state")?.value;
  const back = new URL("/settings", req.nextUrl.origin);
  if (!code || !state || state !== expected) {
    back.searchParams.set("google", "error:invalid_state");
    return NextResponse.redirect(back);
  }
  try {
    const email = await storeTokensFromCode(code);
    await logEvent(null, "human", "google_connected", { email });
    back.searchParams.set("google", "connected");
  } catch (e) {
    back.searchParams.set("google", `error:${String((e as Error).message).slice(0, 150)}`);
  }
  const res = NextResponse.redirect(back);
  res.cookies.delete("g_oauth_state");
  return res;
}
