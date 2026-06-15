# Code Review — Newsly (Hostile)

Date: 2026-06-16
Reviewer: senior engineer, hostile pass
Scope: `app/api/news/route.js`, `lib/logger.js`, `app/page.js`, `app/layout.js`, `next.config.js`. (MCP `newsly-server` not present in repo — could not review.)

---

## Issue 1 — `Number(env) || fallback` silently ignores `0`

**File:** `app/api/news/route.js:29-33`

```js
const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 3;
const BATCH_DELAY_MS = Number(process.env.BATCH_DELAY_MS) || 500;
const GROQ_TIMEOUT_MS = Number(process.env.GROQ_TIMEOUT_MS) || 8000;
const RSS_TIMEOUT_MS = Number(process.env.RSS_TIMEOUT_MS) || 10000;
const MAX_RETRIES = Number(process.env.MAX_RETRIES) || 3;
```

**Problem:** `0` is falsy, so `Number("0") || 500` returns `500`. Setting `BATCH_DELAY_MS=0` to disable the inter-batch sleep, or `MAX_RETRIES=0` to disable retries, is impossible — the fallback overrides the explicit `0`. Also `Number("garbage")` → `NaN` → falls back silently with no warning, so a typo'd env var passes unnoticed.

**Why it matters:** Operators configuring via env (the stated reason for these vars) get behavior that silently contradicts their config. A `0` meant to disable a feature instead re-enables the default.

**Fix:** Parse explicitly and only fall back on `NaN`.

```js
function envInt(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : def;
}
const BATCH_SIZE = envInt("BATCH_SIZE", 3);
const BATCH_DELAY_MS = envInt("BATCH_DELAY_MS", 500);
// ...etc
```

---

## Issue 2 — Retry loop has no backoff and retries non-retryable errors

**File:** `app/api/news/route.js:104-125`

```js
let attempt = 0;
while (attempt < MAX_RETRIES) {
  attempt += 1;
  try {
    const bullets = await callGroq(title, description);
    return bullets;
  } catch (err) {
    logger.warn("Groq summarization attempt failed", { ... });
  }
}
```

**Problem:** On failure the loop immediately retries with zero delay and zero backoff. If Groq returns `429 Too Many Requests`, the code fires the next attempt instantly — exactly the wrong move for a rate-limit. It also retries permanent failures (e.g. `400` invalid model name, `401` bad key) `MAX_RETRIES` times even though they will never succeed, wasting the latency budget.

**Why it matters:** Instant retries on a 429 make rate-limiting worse, not better. Retrying a `401` three times just delays the inevitable fallback by up to 24s. CLAUDE.md mandates a retry cap but says nothing about hammering with no delay.

**Fix:** Add exponential backoff between attempts and break early on non-retryable status codes.

```js
} catch (err) {
  logger.warn("Groq summarization attempt failed", { ... });
  const status = err.status;
  if (status && status !== 429 && status < 500) break; // non-retryable
  if (attempt < MAX_RETRIES) await sleep(BATCH_DELAY_MS * attempt);
}
```

---

## Issue 3 — Worst-case latency blows past `maxDuration = 30`

**File:** `app/api/news/route.js:8-9` + `99-191`

**Problem:** `maxDuration = 30` seconds, but the timing math doesn't fit. 3 feeds × 5 items = up to 15 articles, `BATCH_SIZE=3` → 5 sequential batches. A single slow article can take `MAX_RETRIES (3) × GROQ_TIMEOUT_MS (8s) = 24s`. Batches run sequentially (`await Promise.all` per batch, `+500ms` between), so worst case is roughly `5 × 24s + 4 × 0.5s ≈ 122s` — over 4× the 30s ceiling. Vercel kills the function mid-flight and the client gets a hard failure instead of the placeholder fallback the code carefully builds.

**Why it matters:** The graceful-degradation design (placeholder bullets) is defeated by the platform killing the function before it can return. The retry × timeout product is unbounded relative to `maxDuration`.

**Fix:** Cap total Groq time against the budget, or reduce `GROQ_TIMEOUT_MS × MAX_RETRIES` so even the worst batch chain fits in 30s. E.g. compute a deadline at request start and stop spawning new batches once it's near, returning what's summarized so far plus placeholders for the rest.

---

## Issue 4 — `summaryCache` is dead for its stated purpose

**File:** `app/api/news/route.js:162-191`

```js
// Per-request checkpoint: completed summaries are cached by article URL so
// work is never redone if the batch loop is interrupted and resumed.
const summaryCache = new Map();
```

**Problem:** The comment claims interrupt/resume durability, but the `Map` is a local declared inside `GET()` — it is recreated on every request and garbage-collected when the request ends. There is no resume across requests; an interrupted request loses everything. Within a single request each `it.link` is visited exactly once, so the cache-hit branch (`summaryCache.has(it.link)`) only ever fires if the *same link appears twice across feeds*. Even then it fails: items in one batch run concurrently via `Promise.all`, and `cache.set` happens after the `await`, so two identical links in the same batch both miss and both call Groq (race). The cache delivers essentially none of what its comment promises.

**Why it matters:** Misleading comment hides that there is no checkpointing. The map adds code and cognitive load for a benefit that's near-zero in practice — and zero for its claimed interrupt/resume use case.

**Fix:** Either remove the cache and the misleading comment, or make dedup actually work — dedupe `items` by `link` *before* the batch loop, which removes redundant Groq calls deterministically:

```js
const seen = new Set();
const items = itemLists.flat().filter(it => !seen.has(it.link) && seen.add(it.link));
```

---

## Issue 5 — Raw error message leaked to client

**File:** `app/api/news/route.js:205-208`

```js
return NextResponse.json(
  { error: err.message || "Failed to fetch news" },
  { status: 500 }
);
```

**Problem:** `err.message` is returned verbatim to the browser. Upstream SDK/network errors can embed internal detail (URLs, key-validation text, library internals) in their messages. The client UI (`page.js:15`) only ever shows a generic string anyway, so the detailed message serves no purpose externally.

**Why it matters:** Information disclosure. Internal error text should stay in server logs (it already is, line 200-204), not ship to untrusted clients.

**Fix:** Log the detail, return a generic message.

```js
return NextResponse.json({ error: "Failed to fetch news" }, { status: 500 });
```

---

## Issue 6 — Index used as React key on a reorderable list; `a.bullets` unguarded

**File:** `app/page.js:64` and `:76`

```js
{articles.map((a, i) => (
  <article key={i} ...>
    ...
    {a.bullets.filter(Boolean).map((b, j) => ( ... ))}
```

**Problem:** Two issues. (1) `key={i}` uses array index. The whole list is replaced on each `Refresh`, and feed order is not stable, so index keys cause React to reuse DOM nodes for different articles — stale content and incorrect reconciliation. (2) `a.bullets.filter(...)` assumes `bullets` is always an array. If the API ever returns an item without `bullets` (or shape drifts), this throws and crashes the whole render — there is no per-item guard.

**Why it matters:** Index keys are a well-known source of subtle UI bugs on dynamic lists. The unguarded `.filter` turns one malformed item into a full-page white screen.

**Fix:** Key by a stable field and guard the array.

```js
{articles.map((a) => (
  <article key={a.link} ...>
    ...
    {(a.bullets ?? []).filter(Boolean).map((b, j) => ( ... ))}
```

---

## Issue 7 — `force-dynamic` + no caching = Groq hammered on every request

**File:** `app/api/news/route.js:7` + `155-198`

**Problem:** `export const dynamic = "force-dynamic"` plus no response caching means *every* page load re-fetches all feeds and re-summarizes all ~15 articles through Groq. The same AI news doesn't change second-to-second, but each visitor (and each `Refresh` click) triggers ~15 LLM calls. Under any real traffic this multiplies cost linearly with requests and will trip Groq rate limits quickly.

**Why it matters:** Cost and rate-limit blowup. The comment on line 6 ("always fetch fresh") justifies skipping RSS caching, but conflates fresh feeds with re-running expensive summarization that produces identical output for identical articles.

**Fix:** Cache the summarized payload with a short TTL (e.g. `revalidate = 600`, or an in-process/edge cache keyed by article link with a timestamp), so repeat requests within the window reuse summaries instead of re-calling Groq. Keep RSS fetch fresh if desired, but persist per-link summaries across requests.

---

## Score

7 issues found × −5 = **−35**

**Score: 65 / 100**
