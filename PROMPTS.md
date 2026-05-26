# Newsly — Prompt Log

---
## Project Setup — Next.js 14 scaffold + news API + UI
Date: 2026-05-27
Prompt:
Set up the full project: (1) Initialize a Next.js 14 app with Tailwind CSS in the current folder (not a subfolder). (2) Install groq-sdk and rss-parser. (3) Create /app/api/news/route.js that fetches the 3 RSS feeds from CLAUDE.md, parses the 5 most recent articles each (title, link, description, source), summarizes each via Groq (model llama3-8b-8192) into exactly 3 • bullets, and returns a JSON array of {title, link, source, bullets[3]}. (4) Create /app/page.js: fetch /api/news on load, loading state, article cards (source badge, title, 3 bullets, "Read Full Article" link), Refresh button, clean dark Tailwind theme. (5) Create /app/layout.js with metadata (title: Newsly, description: Your daily AI news briefing). Plain JavaScript, no TypeScript.

Result:
Scaffolded Next.js 14 manually (folder already had .git/CLAUDE.md/etc., so create-next-app could not run). Files: package.json, next.config.js, postcss.config.js, tailwind.config.js, jsconfig.json, app/globals.css, app/layout.js, app/page.js, app/api/news/route.js. Installed next@^14.2.35 (bumped from 14.2.5 for the 2025-12-11 security patch), react/react-dom 18.3.1, tailwindcss, groq-sdk@^1, rss-parser@^3. Verified: `npm run build` compiles clean; GET /api/news returns 200 with 15 articles across all 3 sources, each with 3 real bullets, 0 failures.

NOTE: The requested Groq model `llama3-8b-8192` is decommissioned by Groq (400 model_decommissioned) and cannot be used. Swapped to its documented successor `llama-3.1-8b-instant`, which works.

---
## Harden /app/api/news/route.js — batching, timeout, retry, fallback
Date: 2026-05-27
Prompt:
Fix the "Summary unavailable" bug in /app/api/news/route.js: (1) process articles in batches of 3 with a 500ms delay between batches instead of one big Promise.all; (2) add an 8s timeout per Groq call, retry once on timeout before falling back; (3) the fallback must never say "Summary unavailable" — use the headline in a placeholder like "Click to read the full article about [title]" split across 3 bullets; (4) add export const maxDuration = 30 at the top.

Result:
Restructured route: feeds parsed in parallel into a flat item list, then summaries run in batches of BATCH_SIZE=3 with a 500ms sleep between batches. Each Groq call uses { timeout: 8000, maxRetries: 0 }; summarize() retries once then returns placeholderBullets(title) = ["Click to read the full article about \"<title>\".", "An automatic summary could not be generated this time.", "Open the link below for the full story."]. Added `export const maxDuration = 30`. Verified: build clean; GET /api/news → 200, 15 articles, 0 fallbacks, ~7.0s (was ~2.1s, the extra time is the 4×500ms batch gaps + sequential batches). Forced-failure test confirmed the fallback returns the 3 placeholder bullets with no crash.

NOTE: The original "Summary unavailable" was caused by the decommissioned model (fixed in the previous task), not timeouts — the last run before this change already showed 0/15 failures. These changes are still valid resilience hardening against real Groq slowness/rate limits.

---
