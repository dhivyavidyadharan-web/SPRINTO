import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { consentUrl } from "@/lib/google/auth";

export async function GET() {
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(consentUrl(state));
  res.cookies.set("g_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure: process.env.NODE_ENV === "production" });
  return res;
}
