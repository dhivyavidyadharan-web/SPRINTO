"use client";
import { useState } from "react";
import { clsx } from "clsx";
import { GATES, GATE_IDS, SIGNALS, SIGNAL_IDS, QUALIFY_MIN_SCORE, decideVerdict, type GateId, type GateStatus, type SignalId } from "@/lib/rubric";

const VERDICT_STYLE: Record<string, { cls: string; text: string }> = {
  QUALIFIED: { cls: "bg-emerald-500 text-white", text: "Researched contact gets a personalised cold email." },
  NURTURE: { cls: "bg-zest-300 text-brand-900", text: "Good company, no buying moment yet — parked and re-checked later. No email." },
  DISQUALIFIED: { cls: "bg-rose-500 text-white", text: "Not a Sprinto prospect right now. No email." },
  INPUT_NEEDED: { cls: "bg-amber-400 text-brand-900", text: "The website didn't say enough — waits for a human to decide." },
};

const NEXT: Record<GateStatus, GateStatus> = { pass: "fail", fail: "unknown", unknown: "pass" };

/** Click gates and signals to see what the code would decide. Uses the same decideVerdict() as the pipeline. */
export function RubricSimulator() {
  const [gates, setGates] = useState<Record<GateId, GateStatus>>({ G1: "pass", G2: "pass", G3: "pass", G4: "pass", G5: "pass" });
  const [fired, setFired] = useState<SignalId[]>(["T1", "F1"]);
  const v = decideVerdict(gates, fired);
  const style = VERDICT_STYLE[v.verdict];
  const toggle = (s: SignalId) => setFired((f) => (f.includes(s) ? f.filter((x) => x !== s) : [...f, s]));

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        <div>
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-500">1 · Gates — click to cycle pass → fail → unknown</div>
          <div className="flex flex-wrap gap-2">
            {GATE_IDS.map((g) => (
              <button key={g} onClick={() => setGates((s) => ({ ...s, [g]: NEXT[s[g]] }))}
                className={clsx("rounded-xl px-3 py-1.5 text-xs font-semibold ring-1 transition-all duration-200 hover:-translate-y-0.5",
                  gates[g] === "pass" && "bg-emerald-50 text-emerald-800 ring-emerald-200",
                  gates[g] === "fail" && "bg-rose-50 text-rose-700 ring-rose-200",
                  gates[g] === "unknown" && "bg-amber-50 text-amber-800 ring-amber-200")}>
                {g} {GATES[g].name} · {gates[g]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-500">2 · Signals found on the website / in the news</div>
          <div className="flex flex-wrap gap-2">
            {SIGNAL_IDS.map((s) => {
              const on = fired.includes(s);
              return (
                <button key={s} onClick={() => toggle(s)}
                  className={clsx("rounded-xl px-3 py-1.5 text-xs font-semibold ring-1 transition-all duration-200 hover:-translate-y-0.5",
                    on ? (SIGNALS[s].layer === "timing" ? "bg-brand-700 text-white ring-brand-700" : "bg-blush-500 text-white ring-blush-500") : "bg-white text-ink-700 ring-brand-100")}>
                  {s} {SIGNALS[s].name} <span className={on ? "text-zest-300" : "text-ink-500"}>+{SIGNALS[s].points}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 flex gap-3 text-[11px] text-ink-500"><span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-brand-700" />timing (“why now”)</span><span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-blush-500" />fit (“right size”)</span></div>
        </div>
      </div>

      <div className="lg:col-span-2">
        <div className="rounded-2xl bg-gradient-to-br from-brand-800 to-blush-600 p-5 text-white shadow-lift">
          <div className="text-xs font-semibold uppercase tracking-wide text-white/70">The code decides</div>
          <div className="mt-2 flex items-center gap-3">
            <span key={v.verdict} className={clsx("animate-fade-up rounded-xl px-3 py-1.5 text-lg font-bold", style.cls)}>{v.verdict.replace("_", " ")}</span>
            <span className="text-sm text-white/80">score <b className="text-2xl text-white">{v.score}</b> / {QUALIFY_MIN_SCORE}+</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-zest-300 transition-all duration-500" style={{ width: `${Math.min(100, (v.score / 16) * 100)}%` }} />
          </div>
          <p className="mt-3 text-sm text-white/90">{style.text}</p>
          {v.flags.length > 0 && <p className="mt-2 text-xs text-white/75">Flags: {v.flags.join(", ")} — still emailed, but marked for a closer look.</p>}
          <p className="mt-2 font-mono text-[11px] text-white/60">{v.rationale}</p>
        </div>
      </div>
    </div>
  );
}
