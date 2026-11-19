"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, RefreshCw, CalendarClock } from "lucide-react";

async function post(url: string, body?: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

export interface StepLog { domain?: string; status?: string; detail?: string; tokens?: number; costUsd?: number; ms: number }

/** Client-side loop over /api/pipeline/step until the queue is empty (one company per request). */
export function usePipelineRunner(onStep?: () => void) {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<StepLog[]>([]);
  const stop = useRef(false);
  async function run() {
    setRunning(true); stop.current = false;
    try {
      while (!stop.current) {
        const t0 = Date.now();
        let r: { done: boolean } & Omit<StepLog, "ms">;
        try { r = await post("/api/pipeline/step"); }
        catch (e) { setLog((l) => [...l, { status: "ERROR", detail: String((e as Error).message), ms: Date.now() - t0 }]); break; }
        if (r.done) break;
        setLog((l) => [...l, { ...r, ms: Date.now() - t0 }]);
        onStep?.();
      }
    } finally { setRunning(false); }
  }
  return { running, log, run, stop: () => { stop.current = true; } };
}

export function ActionButtons({ hero = false }: { hero?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const runner = usePipelineRunner(() => router.refresh());
  async function act(name: string, url: string) {
    setBusy(name); setMsg("");
    try { const j = await post(url); setMsg(`${name}: ${summarise(j)}`); router.refresh(); }
    catch (e) { setMsg(`${name} failed: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button className={hero ? "btn-zest" : "btn-primary"} disabled={runner.running} onClick={runner.run}>{runner.running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} {runner.running ? `Running… (${runner.log.length} done)` : "Run pipeline"}</button>
        <button className={hero ? "btn-ghost-light" : "btn-secondary"} disabled={!!busy} onClick={() => act("Check replies", "/api/replies/check")}>{busy === "Check replies" ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Check replies now</button>
        <button className={hero ? "btn-ghost-light" : "btn-secondary"} disabled={!!busy} onClick={() => act("Daily jobs", "/api/jobs/daily")}>{busy === "Daily jobs" ? <Loader2 size={16} className="animate-spin" /> : <CalendarClock size={16} />} Run daily jobs now</button>
      </div>
      {msg && <div className={hero ? "text-sm text-white/80" : "muted"}>{msg}</div>}
      {runner.log.length > 0 && <div className={hero ? "text-sm text-white/80" : "muted"}>Last: {runner.log.slice(-3).map((l) => `${l.domain ?? ""} → ${l.status}`).join(" · ")}</div>}
    </div>
  );
}

function summarise(j: Record<string, unknown>) {
  if (Array.isArray(j.results)) return `${(j.results as { processed: number }[]).reduce((n, r) => n + (r.processed ?? 0), 0)} new replies processed in ${j.results.length} threads`;
  if (Array.isArray(j.ticks)) return `${(j.ticks as unknown[]).length} conversations checked, ${(j.requeued as unknown[] | undefined)?.length ?? 0} re-queued`;
  return "done";
}

export function RunPanel({ envDryRun }: { envDryRun: boolean }) {
  const router = useRouter();
  const [domains, setDomains] = useState("");
  const [dryRun, setDryRun] = useState(envDryRun);
  const [msg, setMsg] = useState("");
  const runner = usePipelineRunner(() => router.refresh());
  async function enqueueAndRun() {
    setMsg("");
    try {
      if (domains.trim()) {
        const j = await post("/api/pipeline/enqueue", { domains, dryRun });
        setMsg(`Queued ${j.added.length}${j.skipped.length ? `; skipped ${j.skipped.map((s: { domain: string; status: string }) => `${s.domain} (${s.status})`).join(", ")}` : ""}`);
      }
      await runner.run();
      router.refresh();
    } catch (e) { setMsg((e as Error).message); }
  }
  async function onFile(f: File | undefined) {
    if (!f) return;
    const text = await f.text();
    setDomains(text.split(/\r?\n/).map((l) => l.split(",")[0].trim()).filter((d) => d && d.toLowerCase() !== "domain").join("\n"));
  }
  const totalTokens = runner.log.reduce((n, l) => n + (l.tokens ?? 0), 0);
  const totalCost = runner.log.reduce((n, l) => n + (l.costUsd ?? 0), 0);
  return (
    <div className="space-y-3">
      <textarea className="input h-36 font-mono" placeholder={"acme.com\nexample.io"} value={domains} onChange={(e) => setDomains(e.target.value)} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn-secondary cursor-pointer">Upload domains.csv<input type="file" accept=".csv,.txt" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dryRun || envDryRun} disabled={envDryRun} onChange={(e) => setDryRun(e.target.checked)} /> DRY_RUN (draft only, no Gmail send){envDryRun && " — forced by env"}</label>
        <button className="btn-primary" disabled={runner.running} onClick={enqueueAndRun}>{runner.running ? <><Loader2 size={16} className="animate-spin" /> Processing…</> : <><Play size={16} /> Queue &amp; run</>}</button>
        {runner.running && <button className="btn-secondary" onClick={runner.stop}>Stop after current</button>}
      </div>
      {msg && <div className="muted">{msg}</div>}
      {runner.log.length > 0 && (
        <div className="card overflow-hidden">
          <table className="tbl">
            <thead><tr><th>Domain</th><th>Result</th><th>Tokens</th><th>Est. cost</th><th>Time</th></tr></thead>
            <tbody>
              {runner.log.map((l, i) => (
                <tr key={i}><td>{l.domain ? <a className="text-brand-700 underline" href={`/companies/${l.domain}`}>{l.domain}</a> : "—"}</td><td>{l.status}{l.detail ? <div className="text-xs text-red-600">{l.detail}</div> : null}</td><td>{l.tokens ?? 0}</td><td>${(l.costUsd ?? 0).toFixed(4)}</td><td>{(l.ms / 1000).toFixed(1)}s</td></tr>
              ))}
              <tr className="font-semibold"><td>Total</td><td>{runner.log.length} companies</td><td>{totalTokens}</td><td>${totalCost.toFixed(4)}</td><td /></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ContactsUpload() {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [msg, setMsg] = useState("");
  async function upload() {
    try {
      const j = await post("/api/contacts/upload", { csv });
      setMsg(`Parsed ${j.parsed}: ${j.inserted} new, ${j.updated} updated.${j.resumed.length ? ` Auto-resumed: ${j.resumed.join(", ")} (run the pipeline to continue).` : ""}`);
      setCsv(""); router.refresh();
    } catch (e) { setMsg((e as Error).message); }
  }
  return (
    <div className="space-y-2">
      <textarea className="input h-28 font-mono text-xs" placeholder="domain,first_name,last_name,title,email,linkedin_url" value={csv} onChange={(e) => setCsv(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="btn-secondary cursor-pointer">Choose contacts.csv<input type="file" accept=".csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} /></label>
        <button className="btn-primary" disabled={!csv.trim()} onClick={upload}>Upload contacts</button>
      </div>
      {msg && <div className="muted">{msg}</div>}
    </div>
  );
}

export function SimulateReply({ companyId }: { companyId: number }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function send() {
    setBusy(true); setMsg("");
    try { await post(`/api/conversations/${companyId}/simulate`, { text }); setText(""); router.refresh(); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-2">
      <textarea className="input h-20" placeholder="Simulate prospect reply, e.g. “Sounds good — does Thursday 3pm work?”" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex items-center gap-2">
        <button className="btn-secondary" disabled={busy || !text.trim()} onClick={send}>{busy && <Loader2 size={14} className="animate-spin" />} Send as prospect</button>
        {msg && <span className="text-sm text-red-600">{msg}</span>}
      </div>
    </div>
  );
}

/** Auto-refresh + reply check every 60 s while the Conversations page is open. */
export function ConversationsPoller() {
  const router = useRouter();
  const [last, setLast] = useState<string>("");
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try { await post("/api/replies/check"); } catch { /* ignore */ }
      if (!alive) return;
      setLast(new Date().toLocaleTimeString());
      router.refresh();
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [router]);
  return <span className="muted">Auto-checking replies every 60 s{last && ` · last ${last}`}</span>;
}

export function FeedbackBox({ emailId, body }: { emailId: number; body: string }) {
  const router = useRouter();
  const [verdict, setVerdict] = useState<"good" | "bad" | null>(null);
  const [working, setWorking] = useState("");
  const [notWorking, setNotWorking] = useState("");
  const [edited, setEdited] = useState(body);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function submit() {
    if (!verdict) return;
    setBusy(true); setMsg("");
    try {
      const j = await post("/api/feedback", { emailId, verdict, working, notWorking, editedBody: edited !== body ? edited : undefined });
      setMsg(j.error ? `Saved; rule distillation failed: ${j.error}` : `Saved. Rules created: ${(j.created ?? []).map((i: number) => `R${i}`).join(", ") || "none"}; merged: ${(j.merged ?? []).map((i: number) => `R${i}`).join(", ") || "none"}${j.retired?.length ? `; retired: ${j.retired.map((i: number) => `R${i}`).join(", ")}` : ""}`);
      router.refresh();
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">Feedback
        <button className={verdict === "good" ? "btn-primary !py-1" : "btn-secondary !py-1"} onClick={() => setVerdict("good")}>👍 Good</button>
        <button className={verdict === "bad" ? "btn-danger !bg-red-600 !py-1 !text-white" : "btn-danger !py-1"} onClick={() => setVerdict("bad")}>👎 Bad</button>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <textarea className="input h-16" placeholder="What's working" value={working} onChange={(e) => setWorking(e.target.value)} />
        <textarea className="input h-16" placeholder="What's not working" value={notWorking} onChange={(e) => setNotWorking(e.target.value)} />
      </div>
      <details><summary className="cursor-pointer text-xs text-slate-600">Edited version (optional)</summary><textarea className="input mt-1 h-40 font-mono text-xs" value={edited} onChange={(e) => setEdited(e.target.value)} /></details>
      <div className="flex items-center gap-2"><button className="btn-primary !py-1" disabled={!verdict || busy} onClick={submit}>{busy && <Loader2 size={14} className="animate-spin" />} Submit feedback</button>{msg && <span className="text-xs text-slate-600">{msg}</span>}</div>
    </div>
  );
}

export function InputActions({ companyId, isConversation, reason }: { companyId: number; isConversation: boolean; reason: string }) {
  const router = useRouter();
  const [instruction, setInstruction] = useState("");
  const [reset, setReset] = useState(false);
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function act(body: Record<string, unknown>) {
    setBusy(true); setMsg("");
    try { const j = await post(`/api/input/${companyId}`, body); setMsg(j.result?.note ?? "Done"); router.refresh(); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }
  const gateUnknown = /cannot_determine/.test(reason);
  const retryable = /calendar|google|quality_gate|pipeline_error|booking/i.test(reason);
  return (
    <div className="space-y-2">
      {isConversation && (
        <div className="space-y-1">
          <textarea className="input h-16" placeholder="Type a reply/instruction — the agent drafts and sends it, then resumes waiting" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
          <div className="flex items-center gap-3">
            <button className="btn-primary !py-1" disabled={busy || !instruction.trim()} onClick={() => act({ action: "instruction", instruction, resetRounds: reset })}>Send via agent</button>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} /> reset rounds</label>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input type="datetime-local" className="input !w-auto !py-1" value={when} onChange={(e) => setWhen(e.target.value)} />
        <button className="btn-secondary !py-1" disabled={busy || !when} onClick={() => act({ action: "mark_booked", slotIso: new Date(when).toISOString() })}>Mark as booked</button>
        <button className="btn-secondary !py-1" disabled={busy} onClick={() => act({ action: "move_backup" })}>Move to Backup</button>
        <button className="btn-danger !py-1" disabled={busy} onClick={() => act({ action: "do_not_contact" })}>Do not contact</button>
        {gateUnknown && <button className="btn-primary !py-1" disabled={busy} onClick={() => act({ action: "override_qualified" })}>Override → Qualified</button>}
        {retryable && <button className="btn-secondary !py-1" disabled={busy} onClick={() => act({ action: "retry" })}>Retry</button>}
        {busy && <Loader2 size={14} className="animate-spin" />}
      </div>
      {msg && <div className="text-xs text-slate-600">{msg}</div>}
    </div>
  );
}

export function RuleRow({ id, kind, text, status }: { id: number; kind: string; text: string; status: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [t, setT] = useState(text);
  async function patch(body: Record<string, unknown>) {
    await fetch(`/api/rules/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setEditing(false); router.refresh();
  }
  return editing ? (
    <div className="flex gap-2"><input className="input !py-1" value={t} onChange={(e) => setT(e.target.value)} /><button className="btn-primary !py-1" onClick={() => patch({ text: t })}>Save</button><button className="btn-secondary !py-1" onClick={() => setEditing(false)}>Cancel</button></div>
  ) : (
    <div className="flex items-center gap-2">
      <span className="flex-1">{text}</span>
      <button className="btn-secondary !px-2 !py-0.5 text-xs" onClick={() => setEditing(true)}>Edit</button>
      {status === "active"
        ? <button className="btn-danger !px-2 !py-0.5 text-xs" onClick={() => patch({ status: "retired" })}>Retire</button>
        : <button className="btn-secondary !px-2 !py-0.5 text-xs" onClick={() => patch({ status: "active" })}>Re-activate</button>}
      <span className="hidden">{kind}</span>
    </div>
  );
}
