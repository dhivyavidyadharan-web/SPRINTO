/** Lists Gemini models available to your key, to pick GEMINI_FAST_MODEL / GEMINI_SMART_MODEL. */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { GoogleGenAI } from "@google/genai";

async function main() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const pager = await ai.models.list();
  for await (const m of pager) {
    if (m.supportedActions?.includes("generateContent") && /gemini/.test(m.name ?? "")) console.log(m.name?.replace("models/", ""), "-", m.displayName);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
