// Edge-safe signed session cookie (Web Crypto HMAC). Used by middleware and login route.
export const SESSION_COOKIE = "sprinto_session";
const MAX_AGE_S = 60 * 60 * 24 * 14;

async function hmac(data: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`session:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSessionToken(secret: string) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  return `${exp}.${await hmac(String(exp), secret)}`;
}

export async function verifySessionToken(token: string | undefined, secret: string) {
  if (!token || !secret) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const expected = await hmac(exp, secret);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export const SESSION_MAX_AGE = MAX_AGE_S;
