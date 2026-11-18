import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./lib/session";

const PUBLIC = [/^\/login$/, /^\/api\/login$/, /^\/api\/google\/callback$/, /^\/api\/cron\//];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const password = process.env.DASHBOARD_PASSWORD ?? "";
  if (!password && pathname === "/login") return NextResponse.redirect(new URL("/", req.url));
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  // Password gate is optional: with no DASHBOARD_PASSWORD set, the dashboard is open (fine locally;
  // set one before sharing a public Vercel URL). The login page then just redirects home.
  if (!password) return NextResponse.next();
  const ok = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value, password);
  if (ok) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"] };
