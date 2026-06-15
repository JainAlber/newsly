# Newsly — Code Audit

Date: 2026-06-15
Scope: `CLAUDE.md`, `app/`, `lib/`. Focus: hardcoded values that belong in env, and missing error handling in the API route (`app/api/news/route.js`).

---

## 1. Hardcoded values that should be environment variables

| # | File:Line | Value | Verdict | Action |
|---|-----------|-------|---------|--------|
| H1 | `app/api/news/route.js:59` | Groq model `"llama-3.1-8b-instant"` | **Should be env.** Model is swapped across deploys (already swapped once when `llama3-8b-8192` was decommissioned). | **Fixed** → `process.env.GROQ_MODEL` (fallback to current). |
| H2 | `app/api/news/route.js:28` | `GROQ_TIMEOUT_MS = 8000` | **Should be env.** Per-deploy tunable; prod vs local differ. | **Fixed** → `process.env.GROQ_TIMEOUT_MS` (fallback 8000). |
| H3 | `app/api/news/route.js:26` | `BATCH_SIZE = 3` | **Should be env.** Rate-limit tuning knob. | **Fixed** → `process.env.BATCH_SIZE` (fallback 3). |
| H4 | `app/api/news/route.js:27` | `BATCH_DELAY_MS = 500` | **Should be env.** Rate-limit tuning knob. | **Fixed** → `process.env.BATCH_DELAY_MS` (fallback 500). |
| H5 | `app/api/news/route.js:11-24` | 3 RSS feed URLs + names | **Borderline — kept as code.** These are the app's canonical sources (defined in `CLAUDE.md` § RSS Sources), not environment-specific or secret. 3 structured `{name,url}` objects don't map cleanly to one env var. **Not moved** (would add parsing complexity for no deploy-time benefit). |
| H6 | `app/layout.js:4-5` | metadata `title`/`description` strings | **Not env.** Static site metadata, correct as code. No action. |
| H7 | `app/page.js:14` | `fetch("/api/news")` | **Not env.** Same-origin relative path; correct. No action. |

All fixes use `process.env.X ?? <current default>` (or parsed int) so behavior is **unchanged** when the env var is unset — non-breaking.

## 2. Missing / weak error handling — `app/api/news/route.js`

| # | Line | Issue | Severity | Status |
|---|------|-------|----------|--------|
| E1 | `route.js:31` | `new Groq({ apiKey: process.env.GROQ_API_KEY })` — no validation that `GROQ_API_KEY` is set. If missing/empty, every Groq call fails and silently degrades to placeholder bullets with no clear signal of *why*. | Medium | **Fixed** — added a startup warn log when the key is absent (see E1 fix). Does not throw (keeps graceful degradation), but makes the misconfig visible. |
| E2 | `route.js:127` | `parser.parseURL(url)` has **no per-feed timeout**. rss-parser defaults to ~60s; with `maxDuration = 30` a single hung feed can exhaust the whole request budget before summarization runs. | Medium | **Fixed** — `Parser` constructed with a request `timeout` (`RSS_TIMEOUT_MS`, default 10000ms). Hung feed now fails fast into the existing per-feed catch → returns `[]`. |
| E3 | `route.js:70` | `completion.choices[0]?.message?.content ?? ""` | None — already guarded with optional chaining + nullish default. | OK, no change. |
| E4 | `route.js:128,132` | `feed.items \|\| []`, `item.title \|\| "Untitled"`, etc. | None — malformed-feed fields already defended. | OK, no change. |
| E5 | `route.js:99,113,134` | `err.message` accessed in catches. If a non-Error is thrown (string/object), `err.message` is `undefined` — logged as `undefined`, not a crash. | Low | Noted, not fixed (cosmetic; would wrap as `String(err)`). |
| E6 | `app/page.js:76` | `a.bullets.filter(Boolean)` — assumes every article has a `bullets` array. The API always returns one, but a malformed payload would throw client-side. Out of API-route scope. | Low (client) | Noted only. |

---

## Summary
- **4 hardcoded values moved to env** (H1–H4) with non-breaking fallbacks; added to `.env.local` and documented in new `.env.local.example`.
- **2 real error-handling gaps fixed** (E1 missing-key visibility, E2 no feed timeout).
- 1 hardcoded set intentionally kept as code (H5 RSS feeds) with rationale.
- 3 items already well-handled (E3, E4) or out of scope/cosmetic (E5, E6).
