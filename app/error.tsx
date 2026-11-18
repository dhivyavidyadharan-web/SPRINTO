"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto mt-10 max-w-xl space-y-3 p-6">
      <h1 className="text-lg font-semibold text-red-700">Something went wrong</h1>
      <p className="text-sm text-slate-600">If this is a fresh setup, check that <span className="mono">DATABASE_URL</span> is set and that you ran <span className="mono">npm run db:push</span>. Server logs have the full error{error.digest ? ` (digest ${error.digest})` : ""}.</p>
      <button className="btn-secondary" onClick={reset}>Try again</button>
    </div>
  );
}
