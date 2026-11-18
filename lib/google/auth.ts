import { google } from "googleapis";
import { config } from "../env";
import { getSetting, setSetting } from "../settings";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
];
const TOKEN_KEY = "google_refresh_token";

export function oauthClient() {
  return new google.auth.OAuth2(config.googleClientId, config.googleClientSecret, config.googleRedirectUri);
}

export function consentUrl(state: string) {
  return oauthClient().generateAuthUrl({ access_type: "offline", prompt: "consent", scope: GOOGLE_SCOPES, state, login_hint: config.myEmail || undefined });
}

export async function storeTokensFromCode(code: string) {
  const c = oauthClient();
  const { tokens } = await c.getToken(code);
  if (!tokens.refresh_token) throw new Error("Google did not return a refresh token. Remove the app's access at myaccount.google.com/permissions and reconnect.");
  await setSetting(TOKEN_KEY, tokens.refresh_token, { encrypted: true });
  c.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: c });
  const profile = await gmail.users.getProfile({ userId: "me" });
  await setSetting("google_account_email", profile.data.emailAddress ?? "");
  return profile.data.emailAddress;
}

export class GoogleNotConnectedError extends Error {
  constructor() { super("Google is not connected (no refresh token). Connect Google on the Settings page."); }
}

/** Authenticated OAuth client for my account, or throws GoogleNotConnectedError. */
export async function authedClient() {
  const rt = await getSetting(TOKEN_KEY, { encrypted: true }).catch(() => null);
  if (!rt) throw new GoogleNotConnectedError();
  const c = oauthClient();
  c.setCredentials({ refresh_token: rt });
  return c;
}

export async function googleStatus() {
  const rt = await getSetting(TOKEN_KEY).catch(() => null);
  const email = await getSetting("google_account_email").catch(() => null);
  return { connected: !!rt, email };
}
