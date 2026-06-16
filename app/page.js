"use client";

import { useState, useEffect, useCallback } from "react";

export default function Home() {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/news");
      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();
      setArticles(Array.isArray(data) ? data : []);
    } catch {
      setError("Could not load news. Try refreshing.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="min-h-screen max-w-3xl mx-auto px-4 py-10">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Newsly</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Your daily AI news briefing ✦ v2
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium transition-colors"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300 mb-6">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border border-zinc-800 bg-zinc-900 h-40"
            />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {articles.map((a, i) => (
            <article
              key={i}
              className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 hover:border-zinc-700 transition-colors"
            >
              <span className="inline-block rounded-full bg-indigo-500/15 text-indigo-300 text-xs font-medium px-3 py-1 mb-3">
                {a.source}
              </span>
              <h2 className="text-lg font-semibold leading-snug mb-3">
                {a.title}
              </h2>
              <ul className="space-y-1.5 mb-4">
                {a.bullets.filter(Boolean).map((b, j) => (
                  <li key={j} className="text-zinc-300 text-sm flex gap-2">
                    <span className="text-indigo-400">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <a
                href={a.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-indigo-400 hover:text-indigo-300"
              >
                Read Full Article →
              </a>
            </article>
          ))}
          {!articles.length && !error && (
            <p className="text-zinc-500 text-sm">No articles found.</p>
          )}
        </div>
      )}
    </main>
  );
}
