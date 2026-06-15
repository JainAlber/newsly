# Pre-Production Code Review — Newsly (BRUTAL)

Date: 2026-06-16
Auditor: principal engineer / security audit. Assume guilty until proven innocent.
Files reviewed: `app/api/news/route.js`, `lib/logger.js`, `app/page.js`, `app/layout.js`, `next.config.js`, `postcss.config.js`, `tailwind.config.js`.
Not reviewable: MCP `newsly-server` (referenced by tooling, not present in repo). **You are shipping an MCP surface that isn't in the tree — that is its own problem.**

---

## CRITICAL

None that meet the strict bar (data loss / breach / *silent* prod failure). The latency bug below is loud (returns a 500), so it lands in HIGH, not CRITICAL. Do not read the absence of CRITICAL as "fine" — four HIGHs below will take you down in production.

---

## HIGH

### H1 — Worst-case latency far exceeds `maxDuration = 30`
**File:** `app/api/news/route.js:9`, `99-191`
**What:** 15 articles, `BATCH_SIZE=3` → 5 sequential batches. One article can burn `MAX_RETRIES(3) × GROQ_TIMEOUT_MS(8s) = 24s`. Sequential batches → worst case ≈ `5 × 24s + 4 × 0.5s ≈ 122s`, ~4× the 30s ceiling.
**Why it matters:** Vercel kills the function at 30s. The placeholder-fallback path (lines 56-63, 127-132) was built specifically to degrade gracefully — and it never runs, because the platform terminates the process first. Users get a hard 500 instead of partial content.
**Fix:** Track a deadline at request start; stop launching new batches as the budget nears and return summarized articles + placeholders for the rest. Or constrain `GROQ_TIMEOUT_MS × MAX_RETRIES × (items/BATCH_SIZE)` to fit 30s.

### H2 — `Number(env) || fallback` silently discards `0`
**File:** `app/api/news/route.js:29-33`
**What:** `Number("0") || 500 === 500`. `0` is falsy, so `BATCH_DELAY_MS=0` or `MAX_RETRIES=0` is impossible — the fallback overrides explicit config. `Number("typo")` → `NaN` → silent fallback, no warning.
**Why it matters:** Operators configure behavior via env (the stated design). A `0` meant to disable a feature silently re-enables the default; a typo'd value is silently ignored. Config that lies is worse than no config.
**Fix:**
```js
function envInt(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : def;
}
```

### H3 — No range validation on `BATCH_SIZE` → hang / broken slicing
**File:** `app/api/news/route.js:29`, `170`
**What:** `for (let i = 0; i < items.length; i += BATCH_SIZE)`. Nothing bounds `BATCH_SIZE`. `BATCH_SIZE=-1` → `Number("-1")` is truthy → `i += -1` runs forever (or until OOM). `BATCH_SIZE=0` is masked only by accident of H2's `|| 3`.
**Why it matters:** A single bad env value turns a request into an infinite loop on a production serverless function. No iteration ceiling protects the loop.
**Fix:** Clamp: `const BATCH_SIZE = Math.max(1, envInt("BATCH_SIZE", 3));`. Same hardening for the other numeric envs.

### H4 — Public endpoint with no rate limiting amplifies to ~15 Groq calls per request
**File:** `app/api/news/route.js:155` (no auth, no throttle) + `7` (`force-dynamic`)
**What:** `/api/news` is unauthenticated and uncached. Each hit fans out to ~15 Groq completions. Anyone can curl it in a loop.
**Why it matters:** Wallet-DoS / quota exhaustion. An attacker (or a crawler) drives your Groq bill and trips your rate limits, taking the app down for real users. Cost scales linearly with request volume, not with actual news volume.
**Fix:** Cache the summarized payload with a TTL (see M3) so repeat hits don't re-call Groq, and/or add basic IP rate limiting at the edge/middleware.

---

## MEDIUM

### M1 — Retry loop: no backoff, retries non-retryable errors
**File:** `app/api/news/route.js:104-125`
**What:** On failure it retries instantly with zero delay. A `429` is retried immediately (worst possible response to rate-limiting); a permanent `400/401` is retried `MAX_RETRIES` times for nothing.
**Why it matters:** Instant retries worsen rate-limiting; pointless retries on permanent errors waste the latency budget (compounds H1).
**Fix:** Exponential backoff between attempts; `break` on non-retryable status (`err.status` present, `!== 429`, `< 500`).

### M2 — Raw `err.message` returned to the client
**File:** `app/api/news/route.js:205-208`
**What:** Upstream error text is shipped to the browser. The UI (`page.js:15-19`) only shows a generic string anyway.
**Why it matters:** Information disclosure — SDK/network internals leak to untrusted clients. Detail already goes to logs (200-204); the client needs none of it.
**Fix:** `return NextResponse.json({ error: "Failed to fetch news" }, { status: 500 });`

### M3 — `force-dynamic` + zero caching re-summarizes everything on every request
**File:** `app/api/news/route.js:7`, `155-198`
**What:** Identical AI news is re-summarized through Groq on every page load and every Refresh.
**Why it matters:** Cost and rate-limit blowup under load; the line-6 "always fetch fresh" comment conflates fresh feeds with re-running identical, expensive summarization.
**Fix:** Cache per-link summaries across requests with a short TTL (e.g. `revalidate`, or an in-process/edge store keyed by link + timestamp).

### M4 — `summaryCache` is dead for its stated purpose; intra-batch race
**File:** `app/api/news/route.js:162-191`
**What:** Comment claims interrupt/resume checkpointing. It's a local `Map` recreated every request and GC'd at request end — no cross-request resume. Each `link` is visited once per request, so the hit branch only fires on a duplicate link across feeds; even then, batch items run concurrently via `Promise.all` and `cache.set` happens post-`await`, so duplicates in one batch both miss and both call Groq.
**Why it matters:** Misleading comment hides that there is no checkpoint. The structure adds cognitive load for ~zero benefit and zero of its advertised behavior.
**Fix:** Remove it and the comment, or dedupe `items` by `link` before the batch loop (deterministic, actually removes redundant calls).

### M5 — Array index used as React key on a reorderable list
**File:** `app/page.js:64`
**What:** `key={i}`. The list is fully replaced each Refresh and feed order isn't stable.
**Why it matters:** React reuses DOM nodes for different articles → stale/incorrect content on refresh.
**Fix:** `key={a.link}`.

### M6 — Unguarded `a.bullets.filter(...)`
**File:** `app/page.js:76`
**What:** Assumes `bullets` is always an array. Any item missing `bullets` (shape drift, future API change) throws during render.
**Why it matters:** One malformed item white-screens the entire page — no per-item isolation.
**Fix:** `{(a.bullets ?? []).filter(Boolean).map(...)}`.

---

## LOW

### L1 — `maxDuration` hardcoded while sibling tunables are env-driven
**File:** `app/api/news/route.js:9`
**What:** Everything else (model, batch size, delays, timeouts, retries) is env-overridable; the 30s budget is a bare literal.
**Why it matters:** Inconsistent config story; the one value that bounds H1 can't be tuned without a code change.
**Fix:** `export const maxDuration = envInt("MAX_DURATION", 30);` (Next allows a static value; use a constant if it must be literal, but at least name it).

### L2 — `placeholderBullets` / padding contradicts "exactly 3 bullet points"
**File:** `app/api/news/route.js:75`, `93-94`
**What:** Prompt demands "exactly 3"; code pads short results with empty strings then the UI filters them out (`page.js:76`).
**Why it matters:** Dead padding — values created only to be stripped downstream. Minor, but it's logic that exists to cancel itself.
**Fix:** Drop the padding; let the UI render whatever real bullets exist.

---

## CLEARED (checked, no finding)
- `lib/logger.js` — no secrets logged; `GROQ_API_KEY` never emitted. Fine for Node runtime (note: `process.stdout.write` would break on Edge runtime — current routes are Node, so OK).
- `groq-sdk` / `rss-parser` / `next` API usage — `groq.chat.completions.create(body, {timeout, maxRetries})`, `parser.parseURL`, `NextResponse.json` all exist and are used correctly. No hallucinated calls.
- `layout.js`, `postcss.config.js`, `tailwind.config.js` — clean.
- Dependency names — no typo-squatting; all real packages.
- No hardcoded secrets anywhere in source.

---

## SCORE

| Severity | Count | Deduction |
|----------|-------|-----------|
| CRITICAL | 0 | 0 |
| HIGH | 4 | −40 |
| MEDIUM | 6 | −30 |
| LOW | 2 | −4 |

**Total: −74 → Score 26 / 100**

**VERDICT: Do not ship.** No data-loss bug, but the graceful-degradation design is defeated by its own latency math (H1), the config layer lies about `0` and can hang on bad input (H2/H3), and an unauthenticated endpoint hands attackers your Groq bill (H4). Fix all four HIGHs before this goes anywhere near production.
