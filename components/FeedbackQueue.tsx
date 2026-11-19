"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { ThumbsUp, ThumbsDown, ChevronDown, Loader2, Sparkles, CheckCircle2, PenLine } from "lucide-react";

export type QueueItem = {
  emailId: number; domain: string; companyName: string; kind: string; subject: string; body: string;
  sentAgo: string; hookSignalId: string | null; contact: string | null;
};

const KIND_LABEL: Record<string, string> = { cold: "Cold email", followup_1: "Follow-up 1", followup_2: "Follow-up 2" };

function FeedbackCard({ item, index, defaultOpen }: { item: QueueItem; index: number; defaultOpen: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [verdict, setVerdict] = useState<"good" | "bad" | null>(null);
  const [working, setWorking] = useState("");
  const [notWorking, setNotWorking] = useState("");
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState(item.body);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    if (!verdict) return;
    setBusy(true);
    try {
      const r = await fetch("/api/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailId: item.emailId, verdict, working, notWorking, editedBody: edited !== item.body ? edited : undefined }),
      });
      const j = await r.json();
      const made = (j.created ?? []).map((i: number) => `R${i}`);
      const merged = (j.merged ?? []).map((i: number) => `R${i}`);
      setDone(j.error ? "Saved (rule extraction failed — try again later)" : made.length || merged.length ? `New rules: ${made.join(", ") || "—"}${merged.length ? ` · reinforced ${merged.join(", ")}` : ""}` : "Saved — nothing new to learn from this one");
      setTimeout(() => router.refresh(), 1600);
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="card reveal flex items-center gap-3 border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm">
        <CheckCircle2 className="text-emerald-600" size={18} />
        <div><b>{item.companyName}</b> · thanks! <span className="text-ink-700">{done}</span></div>
      </div>
    );
  }

  return (
    <div className="card card-hover reveal overflow-hidden" style={{ animationDelay: `${index * 60}ms` }}>
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(!open)}>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blush-400 to-brand-600 text-sm font-bold text-white">{item.companyName.slice(0, 1).toUpperCase()}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-brand-900">{item.companyName}</span>
            <span className="rounded-md bg-lavender-200 px-1.5 text-[11px] font-semibold text-brand-800">{KIND_LABEL[item.kind] ?? item.kind}</span>
            {item.hookSignalId && <span className="rounded-md bg-zest-200 px-1.5 text-[11px] font-semibold text-brand-900">hook {item.hookSignalId}</span>}
          </div>
          <div className="truncate text-xs text-ink-500">“{item.subject}” · to {item.contact ?? "—"} · {item.sentAgo}</div>
        </div>
        <ChevronDown size={18} className={clsx("text-ink-500 transition-transform duration-300", open && "rotate-180")} />
      </button>

      <div className={clsx("grid transition-all duration-300", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        <div className="overflow-hidden">
          <div className="space-y-3 border-t border-brand-50 px-4 py-4">
            {editing
              ? <textarea className="input h-56 font-mono text-xs" value={edited} onChange={(e) => setEdited(e.target.value)} />
              : <pre className="whitespace-pre-wrap rounded-xl bg-cream-50 p-4 font-sans text-[13px] leading-relaxed text-ink-900 ring-1 ring-brand-50">{edited}</pre>}

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-brand-800">How did this email land?</span>
              <button onClick={() => setVerdict("good")} className={clsx("btn !py-1.5", verdict === "good" ? "bg-emerald-600 text-white shadow-soft" : "border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50")}><ThumbsUp size={15} className={verdict === "good" ? "animate-wiggle" : ""} /> Good</button>
              <button onClick={() => setVerdict("bad")} className={clsx("btn !py-1.5", verdict === "bad" ? "bg-rose-600 text-white shadow-soft" : "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50")}><ThumbsDown size={15} className={verdict === "bad" ? "animate-wiggle" : ""} /> Bad</button>
              <button onClick={() => setEditing(!editing)} className="btn-secondary ml-auto !py-1.5"><PenLine size={14} /> {editing ? "Done editing" : "Edit the email"}</button>
            </div>

            <div className={clsx("grid gap-2 transition-all duration-300 md:grid-cols-2", verdict ? "opacity-100" : "pointer-events-none opacity-40")}>
              <textarea className="input h-20" placeholder="What's working? e.g. the opening line names the exact job post" value={working} onChange={(e) => setWorking(e.target.value)} />
              <textarea className="input h-20" placeholder="What's not working? e.g. too long, sounds like a template" value={notWorking} onChange={(e) => setNotWorking(e.target.value)} />
            </div>
            <div className="flex items-center gap-3">
              <button disabled={!verdict || busy} onClick={submit} className="btn-pink">{busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Teach the agent</button>
              <span className="text-xs text-ink-500">Your notes become reusable rules that every future email follows.</span>
              <Link href={`/companies/${item.domain}`} className="ml-auto text-xs font-semibold text-blush-600 hover:text-brand-700">Decision log →</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FeedbackQueue({ items }: { items: QueueItem[] }) {
  if (!items.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><CheckCircle2 size={22} /></div>
        <div className="font-semibold text-brand-800">All caught up</div>
        <div className="max-w-xs text-sm text-ink-500">Every sent email has feedback. New emails will appear here.</div>
      </div>
    );
  }
  return <div className="space-y-3">{items.map((it, i) => <FeedbackCard key={it.emailId} item={it} index={i} defaultOpen={i === 0} />)}</div>;
}
