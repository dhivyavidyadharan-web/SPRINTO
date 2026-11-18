"use client";
import { useState } from "react";

export default function LoginPage() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
    setBusy(false);
    if (r.ok) {
      const next = new URLSearchParams(location.search).get("next") || "/";
      location.href = next.startsWith("/") ? next : "/";
    } else setErr((await r.json()).error ?? "Login failed");
  }
  return (
    <div className="grid min-h-[80vh] place-items-center">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-700 font-bold text-white">S</div>
          <div><div className="font-semibold">Sprinto Outbound Agent</div><div className="muted">Dashboard is private</div></div>
        </div>
        <input type="password" className="input" placeholder="Dashboard password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        {err && <div className="text-sm text-red-600">{err}</div>}
        <button className="btn-primary w-full" disabled={busy || !pw}>{busy ? "Checking…" : "Sign in"}</button>
      </form>
    </div>
  );
}
