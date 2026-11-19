"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, BrainCircuit, Check, X, RotateCcw, RefreshCw } from "lucide-react";

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

export function RunLearningButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function run() {
    setBusy(true); setMsg("");
    try {
      const j = await call("/api/learning/run", "POST");
      const bits = [
        `${j.data.withOutcome} emails with outcomes`,
        j.trialsStarted.length ? `${j.trialsStarted.length} trial rule(s) started` : null,
        j.promoted.length ? `${j.promoted.length} promoted` : null,
        j.retired.length ? `${j.retired.length} dropped` : null,
        j.experiment ? `experiment: ${j.experiment.reason}` : null,
        j.suggestions.length ? `${j.suggestions.length} rubric suggestion(s)` : null,
        j.reviews.length ? `${j.reviews.length} verdict(s) reviewed` : null,
      ].filter(Boolean);
      setMsg(bits.join(" · "));
      router.refresh();
    } catch (e) { setMsg(`Failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-2">
      <button className="btn-zest" disabled={busy} onClick={run}>{busy ? <Loader2 size={16} className="animate-spin" /> : <BrainCircuit size={16} />} {busy ? "Learning…" : "Run learning now"}</button>
      {msg && <div className="max-w-xl text-sm text-white/85">{msg}</div>}
    </div>
  );
}

export function SuggestionButtons({ id, kind }: { id: number; kind: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"y" | "n" | null>(null);
  const [err, setErr] = useState("");
  async function decide(approve: boolean) {
    setBusy(approve ? "y" : "n"); setErr("");
    try { await call(`/api/learning/suggestions/${id}`, "POST", { approve }); router.refresh(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn-primary !py-1.5" disabled={!!busy} onClick={() => decide(true)}>
        {busy === "y" ? <Loader2 size={14} className="animate-spin" /> : kind === "verdict_review" ? <RefreshCw size={14} /> : <Check size={14} />}
        {kind === "verdict_review" ? "Re-research it" : "Approve change"}
      </button>
      <button className="btn-secondary !py-1.5" disabled={!!busy} onClick={() => decide(false)}>{busy === "n" ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} {kind === "verdict_review" ? "Keep verdict" : "Reject"}</button>
      {err && <span className="text-xs text-rose-600">{err}</span>}
    </div>
  );
}

export function ResetOverridesButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn-secondary !py-1.5" disabled={busy} onClick={async () => { setBusy(true); try { await call("/api/learning/overrides", "DELETE"); router.refresh(); } finally { setBusy(false); } }}>
      {busy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Reset to defaults
    </button>
  );
}

export function RuleStatusButton({ id, to, label }: { id: number; to: "active" | "retired"; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className={to === "active" ? "btn-secondary !px-2 !py-1 text-xs" : "btn-secondary !px-2 !py-1 text-xs text-rose-700"} disabled={busy}
      onClick={async () => { setBusy(true); try { await call(`/api/rules/${id}`, "PATCH", { status: to }); router.refresh(); } finally { setBusy(false); } }}>
      {busy ? <Loader2 size={12} className="animate-spin" /> : null}{label}
    </button>
  );
}
