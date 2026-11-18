import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { config } from "../env";

export type ModelSlot = "fast" | "smart";

/** Accumulates token usage across one pipeline run / agent step. */
export class TokenMeter {
  tokensIn = 0;
  tokensOut = 0;
  calls: { purpose: string; model: string; in: number; out: number }[] = [];
  add(purpose: string, model: string, tin: number, tout: number) {
    this.tokensIn += tin;
    this.tokensOut += tout;
    this.calls.push({ purpose, model, in: tin, out: tout });
  }
  /** Rough cost estimate (USD per 1M tokens). Approximate public list prices; tune in env if needed. */
  get estCostUsd() {
    let c = 0;
    for (const k of this.calls) {
      const smart = k.model === config.smartModel || k.model.includes("pro");
      const pin = smart ? 1.25 : 0.3;
      const pout = smart ? 10 : 2.5;
      c += (k.in * pin + k.out * pout) / 1_000_000;
    }
    return Math.round(c * 10000) / 10000;
  }
}

let _client: GoogleGenAI | null = null;
function client() {
  if (!_client) {
    if (!config.geminiKey) throw new Error("GEMINI_API_KEY is not set");
    _client = new GoogleGenAI({ apiKey: config.geminiKey });
  }
  return _client;
}

export function modelFor(slot: ModelSlot) {
  return slot === "fast" ? config.fastModel : config.smartModel;
}

/** Strip JSON-schema keys Gemini's responseJsonSchema does not accept. */
function toGeminiSchema(schema: z.ZodType): unknown {
  const js = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        if (k === "$schema" || k === "additionalProperties") continue;
        out[k] = clean(v);
      }
      return out;
    }
    return node;
  };
  return clean(js);
}

export interface GenerateOpts<T extends z.ZodType> {
  slot: ModelSlot;
  purpose: string;
  system: string;
  prompt: string;
  schema: T;
  temperature?: number;
  meter?: TokenMeter;
}

/**
 * Structured JSON generation: responseMimeType=application/json + JSON schema,
 * validated with Zod. Retries once on invalid JSON / schema mismatch.
 */
export async function generateJson<T extends z.ZodType>(opts: GenerateOpts<T>): Promise<z.infer<T>> {
  const model = modelFor(opts.slot);
  const temperature = opts.temperature ?? (opts.slot === "fast" ? 0 : 0.7);
  let lastErr: unknown;
  let prompt = opts.prompt;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now();
    const res = await withRetry(() =>
      client().models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          systemInstruction: opts.system,
          temperature,
          responseMimeType: "application/json",
          responseJsonSchema: toGeminiSchema(opts.schema),
          ...thinkingFor(opts.slot),
        },
      }),
    );
    const u = res.usageMetadata;
    const tin = u?.promptTokenCount ?? 0;
    const tout = (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0);
    opts.meter?.add(opts.purpose, model, tin, tout);
    console.log(`[gemini] ${opts.purpose} model=${model} in=${tin} out=${tout} ms=${Date.now() - t0}`);
    const text = res.text ?? "";
    try {
      const parsed = JSON.parse(text);
      return opts.schema.parse(parsed);
    } catch (e) {
      lastErr = e;
      prompt = `${opts.prompt}\n\nYour previous answer was invalid (${String(e).slice(0, 300)}). Return ONLY valid JSON matching the schema.`;
    }
  }
  throw new Error(`Gemini ${opts.purpose}: invalid JSON after retry: ${String(lastErr)}`);
}

/** Thinking level per slot (GEMINI_FAST_THINKING / GEMINI_SMART_THINKING: low|medium|high, empty = model default). */
function thinkingFor(slot: ModelSlot) {
  const level = slot === "fast" ? config.fastThinking : config.smartThinking;
  return level ? { thinkingConfig: { thinkingLevel: level as never } } : {};
}

async function withRetry<R>(fn: () => Promise<R>, tries = 3): Promise<R> {
  let err: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      err = e;
      const msg = String((e as Error)?.message ?? e);
      const transient = /429|500|502|503|504|UNAVAILABLE|RESOURCE_EXHAUSTED|fetch failed|timeout/i.test(msg);
      if (!transient || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw err;
}
