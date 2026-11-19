"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clsx } from "clsx";
import { Search, Sparkles, Loader2, ArrowRight, Building2 } from "lucide-react";

type Hit = { domain: string; name: string | null; status: string; score: number | null };

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
function toDomain(s: string) {
  return s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

/**
 * Global "search or add a company" bar. Matches existing companies by name/domain;
 * a website that isn't in the system yet can be researched right here (queue + run).
 */
export function CompanySearch() {
  const router = useRouter();
  const path = usePathname();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searchedFor, setSearchedFor] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  // "/" focuses the search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(t.tagName)) { e.preventDefault(); input.current?.focus(); }
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onClick); };
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); setSearchedFor(""); return; }
    const term = q.trim();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/companies/search?q=${encodeURIComponent(term)}`);
        const j = await r.json();
        setHits(j.results ?? []);
      } catch { setHits([]); }
      setSearchedFor(term);
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  if (path === "/login") return null;

  const domain = toDomain(q);
  const isDomain = DOMAIN_RE.test(domain);
  const exists = hits.some((h) => h.domain === domain);
  const loading = q.trim().length >= 2 && searchedFor !== q.trim();

  async function research() {
    setBusy(domain); setMsg("Queued. Reading the website and the news…");
    try {
      const r = await fetch("/api/pipeline/enqueue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domains: [domain] }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      // Each step processes one company (≤ 60 s). Loop until our domain has a result or the queue is empty.
      for (let i = 0; i < 12; i++) {
        const s = await fetch("/api/pipeline/step", { method: "POST" }).then((x) => x.json());
        if (s.done) break;
        if (s.domain === domain) {
          setMsg(`${domain}: ${String(s.status ?? "").toLowerCase().replace(/_/g, " ")}`);
          if (s.status !== "QUALIFIED") break; // qualified companies continue with contact + email in the next step
        } else setMsg(`Finishing ${s.domain} first (it was already in the queue)…`);
      }
      setOpen(false); setQ("");
      router.push(`/companies/${domain}`);
      router.refresh();
    } catch (e) {
      setMsg(`Couldn't research ${domain}: ${(e as Error).message}`);
    } finally { setBusy(null); }
  }

  const showPanel = open && (q.trim().length >= 2 || !!busy);

  return (
    <div ref={box} className="relative mx-auto w-full max-w-[1400px] px-4 pt-5 md:px-8">
      <div className={clsx("flex items-center gap-2 rounded-2xl bg-white/90 px-4 py-2.5 shadow-soft ring-1 backdrop-blur transition-all duration-200", open ? "ring-blush-300" : "ring-brand-100")}>
        <Search size={17} className="text-blush-500" />
        <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); setMsg(""); }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter") { if (hits[0] && !isDomain) router.push(`/companies/${hits[0].domain}`); else if (isDomain && exists) router.push(`/companies/${domain}`); else if (isDomain && !busy) research(); } }}
          placeholder="Search your companies, or type a website to research a new one (e.g. acme.com)"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-500" />
        <kbd className="hidden rounded-md bg-cream-100 px-1.5 text-[11px] font-semibold text-ink-500 sm:block">/</kbd>
      </div>

      {showPanel && (
        <div className="absolute left-4 right-4 z-30 mt-2 overflow-hidden rounded-2xl bg-white shadow-lift ring-1 ring-brand-100 animate-fade-up md:left-8 md:right-8">
          {hits.length > 0 && (
            <ul className="max-h-72 overflow-y-auto py-1">
              {hits.map((h) => (
                <li key={h.domain}>
                  <button onClick={() => { setOpen(false); setQ(""); router.push(`/companies/${h.domain}`); }} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-blush-50">
                    <Building2 size={15} className="text-brand-600" />
                    <span className="font-semibold text-brand-900">{h.name ?? h.domain}</span>
                    <span className="text-xs text-ink-500">{h.domain}</span>
                    <span className="ml-auto rounded-md bg-lavender-200 px-1.5 text-[11px] font-semibold text-brand-800">{h.status.replace(/_/g, " ").toLowerCase()}</span>
                    {h.score !== null && <span className="text-[11px] text-ink-500">score {h.score}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {isDomain && !exists && (!loading || !!busy) && (
            <button disabled={!!busy} onClick={research} className="flex w-full items-center gap-3 border-t border-brand-50 bg-gradient-to-r from-blush-50 to-lavender-100 px-4 py-3 text-left text-sm hover:from-blush-100">
              {busy ? <Loader2 size={16} className="animate-spin text-blush-600" /> : <Sparkles size={16} className="text-blush-600" />}
              <span className="font-semibold text-brand-900">{busy ? `Researching ${domain}…` : `Research ${domain} now`}</span>
              <span className="text-xs text-ink-500">{busy ? "about a minute" : "qualify, find the decision-maker and email if it qualifies"}</span>
              {!busy && <ArrowRight size={15} className="ml-auto text-blush-600" />}
            </button>
          )}
          {loading && hits.length === 0 && <div className="flex items-center gap-2 px-4 py-3 text-sm text-ink-500"><Loader2 size={14} className="animate-spin" /> Searching…</div>}
          {!loading && !isDomain && hits.length === 0 && (
            <div className="px-4 py-3 text-sm text-ink-500">No company called “{q.trim()}” yet. Type its website (for example <span className="mono">{q.trim().toLowerCase().replace(/\s+/g, "")}.com</span>) to research it.</div>
          )}
          {msg && <div className="border-t border-brand-50 px-4 py-2 text-xs text-brand-800">{msg}</div>}
        </div>
      )}
    </div>
  );
}
