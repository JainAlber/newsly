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
## Add README.md
Date: 2026-05-27
Prompt:
Create a README.md with: app name Newsly, one-line description, screenshot placeholder ("screenshot coming soon"), tech stack list, how to run locally (npm install, add GROQ_API_KEY to .env.local, npm run dev), live demo link placeholder ("Coming soon"). Keep it clean and short.

Result:
Created README.md with all requested sections. Tech stack lists the actual working model `llama-3.1-8b-instant` (not the decommissioned llama3-8b-8192).

---
## Dockerize — multi-stage Dockerfile + .dockerignore
Date: 2026-06-11
Prompt:
Create a production-optimized, multi-stage Dockerfile for this Next.js 14 app to minimize final image size. Architecture: (1) Stage 1 (deps) installs deps from package.json; (2) Stage 2 (builder) copies source, runs `npm run build`, leverages Next.js standalone output; (3) Stage 3 (runner) uses a minimal alpine base, copies only production static assets + standalone build files, exposes port 3000, sets entry runtime. Add a comprehensive .dockerignore excluding .next, node_modules, and local env files. Log the final build and execution commands to PROMPTS.md.

Result:
- next.config.js: added `output: "standalone"` so Next emits `.next/standalone/server.js` with a trimmed node_modules.
- Dockerfile (3 stages, all `node:20-alpine`):
  - deps: `apk add libc6-compat`, `npm ci` (falls back to `npm install` if no lockfile).
  - builder: reuses deps node_modules, copies source, `npm run build`, telemetry off.
  - runner: non-root `nextjs:nodejs` user, copies only `/app/public`, `/app/.next/standalone`, `/app/.next/static`, ENV `NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0`, EXPOSE 3000, CMD `node server.js`.
- public/.gitkeep added so the runner `COPY public` step succeeds (project had no public dir).
- .dockerignore excludes: node_modules, .next, out, build, dist, .env*, .git*, Dockerfile, .dockerignore, docker-compose*, *.md, .vscode, .idea, .DS_Store, coverage, *.log, .cache, .eslintcache, .turbo.

Final build + run commands:
```bash
docker build -t newsly:latest .
docker run --rm -p 3000:3000 --env-file .env.local newsly:latest
```
Or pass the key inline:
```bash
docker run --rm -p 3000:3000 -e GROQ_API_KEY=your_key_here newsly:latest
```
Then open http://localhost:3000.

---
## Week 2 Day 3 — Docker Compose
Date: 2026-06-15
Prompt:
Create a production-ready `docker-compose.yml` file in our root workspace directory. Ensure the following configuration layout: (1) Define a core web service named 'newsly'. (2) Configure it to build dynamically from our local root directory context using our existing multi-stage 'Dockerfile'. (3) Explicitly map host port 3000 to container port 3000. (4) Pass through our environment configuration by explicitly setting the service to load variables from our local `.env.local` file. Also, append the exact docker-compose execution terminal commands (how to boot up clusters in detached mode, how to check logs, and how to teardown/stop the stack) into our local PROMPTS.md file under a new section titled "## Week 2 Day 3 — Docker Compose".

Result:
Created docker-compose.yml at repo root with a single `newsly` service: `build.context: .` + `build.dockerfile: Dockerfile` (reuses the existing 3-stage build), `ports: "3000:3000"`, `env_file: .env.local`, and `restart: unless-stopped`. Omitted the obsolete top-level `version:` key (Compose v2 ignores it).

Docker Compose execution commands:
```bash
# Boot up the stack in detached mode (builds image on first run)
docker compose up -d --build

# Check / follow logs for the newsly service
docker compose logs -f newsly

# Teardown / stop the stack (and remove containers + network)
docker compose down
```
Then open http://localhost:3000.

---
## Week 2 Day 3 — CLAUDE.md roadmap section
Date: 2026-06-15
Prompt:
Update `CLAUDE.md` to include a new section titled "## Long-Term Project Vision & Roadmap" right below the Project overview. Inject the Phase 1 (Infrastructure & Orchestration), Phase 2 (AI Agents & Custom Tools), and Phase 3 (Observability, Watchers, & Evals) architecture tracks exactly. Ensure the original project rules, RSS sources, and prompt logging specifications are preserved exactly during this update.

Result:
Inserted "## Long-Term Project Vision & Roadmap" into CLAUDE.md directly below the Project overview and above "## App Name", containing the three phase tracks verbatim. All other sections (App Name, Tech Stack, Rules, RSS Sources, What NOT to do, Prompt Logging) left byte-for-byte unchanged.

---
## Week 2 Day 4 — GitHub Actions CI/CD pipeline
Date: 2026-06-15
Prompt:
Create the GitHub Actions CI/CD pipeline for Newsly. Create .github/workflows/ci.yml with two jobs. Job 1 (lint): runs on ubuntu-latest, triggered on push to master and pull_request to master, steps = checkout, setup Node 20, npm ci, npx next lint. Job 2 (build-and-push): needs lint, runs on ubuntu-latest, steps = checkout, set up Docker Buildx, log in to GHCR using secrets.GITHUB_TOKEN, build the Docker image with the existing Dockerfile passing GROQ_API_KEY build-arg as the placeholder value, tag as ghcr.io/jainalber/newsly:latest and :<git-sha>, push to GHCR only on push to master (not on pull_requests). Also add a CI status badge to the top of README.md. Append to PROMPTS.md per logging rules.

Result:
- Created `.github/workflows/ci.yml` (name: CI). Triggers: push + pull_request on master.
  - `lint` job: checkout@v4, setup-node@v4 (node 20, npm cache), `npm ci`, `npx next lint`.
  - `build-and-push` job: `needs: lint`, `permissions: contents:read + packages:write`. Steps: checkout@v4, docker/setup-buildx-action@v3, docker/login-action@v3 (registry ghcr.io, username `${{ github.actor }}`, password `${{ secrets.GITHUB_TOKEN }}`), docker/build-push-action@v6 with `build-args: GROQ_API_KEY=placeholder_key_for_compilation`, tags `ghcr.io/jainalber/newsly:latest` + `:${{ github.sha }}`, and `push: ${{ github.event_name == 'push' && github.ref == 'refs/heads/master' }}` so PRs build-only, master pushes publish.
- README.md: added GitHub Actions CI status badge immediately under the `# Newsly` title.
- Updated CLAUDE.md (by user) now documents the CI/CD pipeline section; workflow matches it.

NOTE: package.json has a `lint` script (`next lint`) but no eslint devDependency or eslint config committed. On a clean CI runner `npx next lint` may attempt to install/scaffold ESLint and could fail or behave non-interactively. If the lint job breaks, add `eslint` + `eslint-config-next` to devDependencies and commit a `.eslintrc.json` (`{ "extends": "next/core-web-vitals" }`).

---
## Week 2 Day 4 — ESLint setup for CI
Date: 2026-06-15
Prompt:
Add eslint and eslint-config-next as devDependencies, and create .eslintrc.json with content {"extends":"next/core-web-vitals"}. Run npm install after. Then append to PROMPTS.md.

Result:
- package.json devDependencies: added `eslint: ^8.57.0` and `eslint-config-next: ^14.2.35` (eslint 8 line — eslint-config-next 14 requires ESLint 8, not 9).
- Created `.eslintrc.json` → `{"extends":"next/core-web-vitals"}`.
- Ran `npm install`: added 284 packages, package-lock.json updated. (npm flagged 5 vulns + deprecation warnings on transitive eslint deps — expected for eslint 8 toolchain, not blocking.)
- Verified `npx next lint` → "✔ No ESLint warnings or errors". The CI lint job will now pass deterministically instead of scaffolding ESLint at runtime.

---
## Week 2 Day 5 — Railway auto-deploy job in CI/CD
Date: 2026-06-15
Prompt:
Update CLAUDE.md CI/CD Pipeline section (RAILWAY_TOKEN/RAILWAY_PROJECT_ID saved as GitHub Secrets; a third `deploy` job triggers a Railway redeploy after the image is pushed to GHCR; Railway project live at the generated Railway domain). Then append a third job to ci.yml that triggers a Railway redeploy after the Docker image is pushed to GHCR — edit existing file, only append. Job: named `deploy`, needs build-and-push, runs only on push to master (not PRs), single curl step POSTing to https://backboard.railway.app/graphql/v2 with RAILWAY_TOKEN + RAILWAY_PROJECT_ID secrets, GraphQL mutation serviceInstanceRedeploy passing projectId. Append to PROMPTS.md per logging rules.

Result:
- CLAUDE.md: CI/CD Pipeline section now lists deploy as job 3, plus bullets for Railway secrets, the serviceInstanceRedeploy GraphQL call, and the live Railway domain. (Removed the two stray loose bullets, folded into the structured list.)
- .github/workflows/ci.yml: appended `deploy` job only (lint + build-and-push untouched). `needs: build-and-push`, `if: github.event_name == 'push' && github.ref == 'refs/heads/master'` (master-only, skips PRs). Single step: secrets exposed via `env:` (RAILWAY_TOKEN, RAILWAY_PROJECT_ID) rather than inline `${{ }}` so they don't leak into the curl command line / logs; curl POSTs to `https://backboard.railway.app/graphql/v2` with `Authorization: Bearer $RAILWAY_TOKEN` and body `mutation { serviceInstanceRedeploy(projectId: \"$RAILWAY_PROJECT_ID\") }`.

CAVEAT — likely needs adjustment to actually work: Railway's real `serviceInstanceRedeploy` mutation signature takes `serviceId` and `environmentId` (and a `commitSha`/`latest` arg), NOT `projectId` alone. Wrote it with `projectId` exactly as the task specified, but the redeploy may 400 until the args are corrected to the real schema (and a RAILWAY_SERVICE_ID + RAILWAY_ENVIRONMENT_ID secret added). Verify against Railway's current Public API docs before relying on it. Also did not run/validate the workflow (no push performed).

---
## Week 2 Day 5 — Fix Railway redeploy mutation (serviceId + environmentId)
Date: 2026-06-15
Prompt:
Fix the deploy job in ci.yml. The Railway serviceInstanceRedeploy mutation requires serviceId and environmentId, not projectId alone. Update the curl step to use serviceInstanceRedeploy(serviceId, environmentId), passing both from GitHub Secrets RAILWAY_SERVICE_ID and RAILWAY_ENVIRONMENT_ID via the env block (not inline). Also update CLAUDE.md CI/CD section to replace RAILWAY_PROJECT_ID with RAILWAY_SERVICE_ID and RAILWAY_ENVIRONMENT_ID. Append to PROMPTS.md per logging rules.

Result:
- .github/workflows/ci.yml deploy job: env block now exposes `RAILWAY_TOKEN`, `RAILWAY_SERVICE_ID`, `RAILWAY_ENVIRONMENT_ID` (dropped `RAILWAY_PROJECT_ID`). curl body now `mutation { serviceInstanceRedeploy(serviceId: \"$RAILWAY_SERVICE_ID\", environmentId: \"$RAILWAY_ENVIRONMENT_ID\") }`. Secrets still injected via env (not inline) so they stay out of logs. Job structure (needs build-and-push, master-only `if`) unchanged.
- CLAUDE.md CI/CD section: secrets bullet now lists RAILWAY_TOKEN + RAILWAY_SERVICE_ID + RAILWAY_ENVIRONMENT_ID; deploy-job bullet notes the serviceId + environmentId args. This resolves the caveat flagged in the previous entry.

NOTE: New secrets RAILWAY_SERVICE_ID and RAILWAY_ENVIRONMENT_ID must be added in the GitHub repo settings (Settings → Secrets and variables → Actions); RAILWAY_PROJECT_ID is now unused and can be removed. Find the service/environment IDs in the Railway dashboard URL or via `railway status`. Workflow not run/validated (no push performed).

---
## Week 2 Day 5 — Subtitle tweak to test deploy pipeline
Date: 2026-06-15
Prompt:
In app/page.js, change the subtitle text from "Your daily AI news briefing" to "Your daily AI news briefing ✦" — just a tiny visible change to test the deploy pipeline. Do not change anything else.

Result:
- app/page.js line 35: subtitle now "Your daily AI news briefing ✦". No other changes. Intended as a trivial visible diff to exercise the full CI/CD → GHCR → Railway redeploy pipeline on the next push to master.

---
## Week 2 Day 6 — Structured JSON logging in news API route
Date: 2026-06-15
Prompt:
Add structured logging to Newsly's API route. (1) Create /lib/logger.js — a simple no-dependency logger that outputs JSON lines to stdout with fields level (info/error/warn), timestamp (ISO string), message, plus any extra context fields. (2) Update /app/api/news/route.js to use the logger instead of raw console.log. Add log entries for: fetching starts per RSS source (info, source name); Groq summarization starts per article (info, title truncated to 50 chars); summary succeeds (info, duration_ms); any error (error, error message + source); full request completes (info, total articles count + total duration_ms). Do not change existing functionality — only add logging. Append to PROMPTS.md per logging rules.

Result:
- Created `/lib/logger.js`: `log(level, message, context)` builds `{ level, timestamp: new Date().toISOString(), message, ...context }` and writes one JSON line via `process.stdout.write(... + "\n")`. Exports `logger.info/warn/error`. Zero dependencies.
- `/app/api/news/route.js` instrumented (logic unchanged, only additive logs + one new param):
  - `fetchFeedItems`: `info "Fetching RSS source" { source }` at start; `error "Failed to fetch RSS source" { source, error }` in catch (was a bare `catch {}`).
  - `summarize(title, description, source)` — added `source` param: `info "Groq summarization started" { title(≤50), source }`; on success `info "Article summary succeeded" { title, source, duration_ms }`; first-attempt failure `warn "...retrying" { ..., error }`; terminal failure `error "...using fallback" { ..., error }`. Duration timed from first attempt.
  - `GET`: times whole request from `requestStart`; passes `it.source` into `summarize`; on success `info "News request completed" { total_articles, total_duration_ms }`; top-level catch now `error "News request failed" { source: "request", error, total_duration_ms }`.
- No raw `console.log` anywhere (there were none to begin with). Batching/timeout/retry/fallback behavior byte-for-byte preserved.
- Verified: `npx next lint` → clean; `npm run build` → compiles, /api/news route builds. Satisfies the new CLAUDE.md rules (JSON logging via /lib/logger.js, no raw console.log in API routes).

NOTE: first-attempt Groq failures are logged at `warn` (transient — it retries and usually succeeds); only the final give-up (fallback used) is `error`. This is intentional and still includes error message + source on both, matching the "any error → message + source" intent without flooding `error` with recoverable retries.

---
## Week 2 Day 6 — DEPLOYMENT.md reference doc
Date: 2026-06-15
Prompt:
Create DEPLOYMENT.md in the project root documenting the full deploy pipeline for Newsly. Cover: (1) Overview paragraph; (2) Architecture flow git push → lint → Docker build → GHCR push → Railway redeploy; (3) Environments table Vercel (auto, Next.js native) vs Railway (Docker, CI-triggered); (4) GitHub Secrets list (GROQ_API_KEY, GITHUB_TOKEN, RAILWAY_TOKEN, RAILWAY_SERVICE_ID, RAILWAY_ENVIRONMENT_ID) + what each is for; (5) Local Development docker-compose vs npm run dev; (6) Monitoring UptimeRobot watching newsly-production.up.railway.app every 5 min; (7) Rollback via Railway dashboard. Concise + technical. Append to PROMPTS.md per logging rules.

Result:
Created `DEPLOYMENT.md` (project root) with all 7 sections:
- Overview: two parallel paths from master — Vercel native + Actions→GHCR→Railway.
- Architecture: ASCII flow diagram of the 3 gated jobs (lint → build-and-push → deploy) plus the parallel Vercel branch; notes PRs build-only.
- Environments: table contrasting Vercel (native, auto, always-redeploy) vs Railway (Docker from GHCR, CI-triggered, redeploy only after image push); Railway domain `newsly-production.up.railway.app`.
- GitHub Secrets: table of all 5 secrets, consumer, and purpose; clarifies GROQ_API_KEY is a runtime secret (build uses placeholder) and GITHUB_TOKEN is auto-provisioned; secrets injected via `env:` not inline.
- Local Development: native (`npm run dev`) vs Compose (`up -d --build` / `logs -f` / `down`) with the parity note.
- Monitoring: UptimeRobot 5-min ping + pointer to the `/lib/logger.js` structured JSON logs in Railway/Vercel.
- Rollback: Railway dashboard redeploy of a prior immutable `:<git-sha>` image (primary), plus the `git revert`+push path (rebuilds).
Cross-referenced CLAUDE.md (rules) and PROMPTS.md (change log) in the header. No code changed.

---
## Week 2 Day 7 — Autonomous code audit + hardcoded-value fixes
Date: 2026-06-15
Prompt:
Read the entire Newsly codebase (CLAUDE.md, all files in /app, /lib). Then autonomously, without asking: (1) identify hardcoded values that should be env vars; (2) identify missing error handling in the API route; (3) write AUDIT.md listing findings with file names + line numbers; (4) fix hardcoded values by moving them to .env.local and referencing via process.env. Do all steps without confirmation.

Result:
- Read all source: CLAUDE.md, app/layout.js, app/page.js, app/globals.css, app/api/news/route.js, lib/logger.js.
- Created `AUDIT.md` (root): tables of 7 hardcoded-value findings (H1–H7) + 6 error-handling findings (E1–E6), each with file:line, verdict, status.
- Fixed hardcoded values in `app/api/news/route.js` (all non-breaking via `process.env.X || default`):
  - H1 model `llama-3.1-8b-instant` → `GROQ_MODEL`.
  - H2 `GROQ_TIMEOUT_MS`, H3 `BATCH_SIZE`, H4 `BATCH_DELAY_MS` → env-backed `Number(process.env.X) || <default>`.
  - H5 (3 RSS feeds) intentionally kept as code — canonical app config per CLAUDE.md, not env/secret; documented rationale.
- Fixed 2 error-handling gaps found:
  - E1: missing `GROQ_API_KEY` is now surfaced via a module-load `logger.warn` (still degrades gracefully, no throw).
  - E2: `rss-parser` had no per-feed timeout (default ~60s vs `maxDuration=30`) → constructed `new Parser({ timeout: RSS_TIMEOUT_MS })` (default 10000ms) so a hung feed fails fast into the existing catch.
- Env wiring: appended `GROQ_MODEL`, `GROQ_TIMEOUT_MS`, `BATCH_SIZE`, `BATCH_DELAY_MS`, `RSS_TIMEOUT_MS` to `.env.local` (via Add-Content — did NOT read/expose the existing `GROQ_API_KEY` value). Created committable `.env.local.example` template documenting all vars.
- Verified: `git check-ignore` confirms `.env.local` ignored + `.env.local.example` tracked; `npx next lint` clean; `npm run build` compiles. All defaults preserve original behavior.

NOTE: secret hygiene — only non-secret config defaults were written to .env.local; the real GROQ_API_KEY was never read. The 5 new vars are optional (fallbacks baked in), so no .env change is required for the app to keep working as before.

---
## Week 2 Day 8 — Explicit retry loop with MAX_RETRIES ceiling
Date: 2026-06-15
Prompt:
Upgrade Groq summarization in route.js to an explicit retry loop with a hard ceiling. Replace current retry logic with a while loop tracking attempt count; MAX_RETRIES from process.env.MAX_RETRIES fallback 3; on each failed attempt log warn with attempt number + reason; if exhausted log error + return bullet fallback; on success break out immediately. Add MAX_RETRIES to .env.local (value 3) and .env.local.example. Do not change other logic. Verify with lint + build. Append to PROMPTS.md.

Result:
- `app/api/news/route.js`:
  - Added `const MAX_RETRIES = Number(process.env.MAX_RETRIES) || 3;` to the tunables block.
  - Rewrote `summarize()`: `let attempt = 0; while (attempt < MAX_RETRIES) { attempt += 1; try { ...callGroq → log success (now includes `attempt`) → return } catch (err) { logger.warn("Groq summarization attempt failed", { title, source, attempt, max_retries, reason: err.message }) } }`. After the loop: `logger.error("Groq summarization exhausted retries, using fallback", { title, source, attempts })` then `return placeholderBullets(title)`. Success `return` exits the loop immediately.
  - Untouched: `callGroq`, `fetchFeedItems`, `GET`, batching, timeouts, fallback content.
- `.env.local`: appended `MAX_RETRIES=3` (Add-Content; GROQ_API_KEY never read). `.env.local.example`: added `MAX_RETRIES=3`.
- Verified: `npx next lint` clean; `npm run build` compiles.

NOTE — behavior change (intended by spec): old logic did 2 Groq attempts (1 initial + 1 retry); new default does up to 3 attempts (MAX_RETRIES=3) before fallback. One extra attempt per failing article in the worst case → marginally more Groq calls / latency under sustained failure. Tunable down via the env var if needed.

---
## Week 2 Day 9 — In-memory per-request checkpoint cache
Date: 2026-06-15
Prompt:
Add a lightweight in-memory checkpoint map to the GET handler in route.js. Inside GET, create a Map `summaryCache` before the batch loop; after each successful article summary store the result keyed by article URL; before calling summarize() check the cache first and on hit use the cached result + log info "cache hit" with the article title. In-memory only (per-request), no disk/deps. Goal: demonstrate checkpoint logic — completed work never redone even if the batch loop is interrupted and resumed. Do not change other logic. Verify with lint + build. Append to PROMPTS.md.

Result:
- `app/api/news/route.js` GET handler: added `const summaryCache = new Map();` before the batch loop. Batch map callback now: `if (summaryCache.has(it.link)) { logger.info("cache hit", { title: it.title }); bullets = summaryCache.get(it.link); } else { bullets = await summarize(...); summaryCache.set(it.link, bullets); }` then returns the article object with those bullets. Keyed by article URL (`it.link`).
- In-memory only — Map is a local const inside GET, lives only for the request; no disk writes, no new dependencies.
- Untouched: feed fetch, batching size/delay, summarize/retry, logging elsewhere, response shape.
- Verified: `npx next lint` clean; `npm run build` compiles.

NOTE — scope/behavior: cache is per-request (recreated each GET), so it dedupes only the *same URL appearing twice within one response* (e.g. overlapping feeds) — it does NOT persist across requests. That matches the stated "per-request, in-memory, demonstrate checkpoint logic" goal. Within a single batch, `Promise.all` runs concurrently so two identical URLs in the *same* batch could both miss before either stores; dedup is reliable across batches (sequential). In practice feed items are distinct URLs, so hits are rare — the value here is the checkpoint pattern, not a measurable speedup.

---

---
## Hostile code review — /simplereview
Date: 2026-06-16
Prompt:
/simplereview — senior engineer hostile code review of all source files. For each file check hallucinated API usage, type mismatches, security issues, error-handling gaps, performance, dead code. Find at least 3 real issues. Write findings to CODE_REVIEW_SIMPLE.md with today's date. Review only, no fixes. Score /100, -5 per issue.

Result:
Reviewed app/api/news/route.js, lib/logger.js, app/page.js, app/layout.js, next.config.js (MCP newsly-server not in repo). Found 7 issues: (1) Number(env)||fallback ignores 0; (2) retry loop no backoff + retries non-retryable errors; (3) worst-case latency ~122s blows past maxDuration=30; (4) summaryCache dead for its stated interrupt/resume purpose + intra-batch race; (5) raw err.message leaked to client; (6) index React key on reorderable list + unguarded a.bullets; (7) force-dynamic + no cache hammers Groq every request. Score: 65/100. No code changed.


---
## Brutal pre-prod review — /brutalreview
Date: 2026-06-16
Prompt:
/brutalreview — principal engineer + security auditor, ruthless pre-production review of all source files. Run correctness, types/data, security, error handling, performance/reliability, code quality, and agent-specific checks. Group findings CRITICAL/HIGH/MEDIUM/LOW with file:line, why-it-matters, exact fix. Write to CODE_REVIEW_BRUTAL.md. Score /100 (CRIT -20, HIGH -10, MED -5, LOW -2). Review only.

Result:
Reviewed route.js, logger.js, page.js, layout.js, next.config.js, postcss/tailwind configs (MCP newsly-server not in repo). 0 CRITICAL, 4 HIGH (maxDuration overrun ~122s defeats fallback; Number(env)||0 coercion; no bound check on BATCH_SIZE → infinite/negative loop; unauthenticated endpoint amplifies to ~15 Groq calls = wallet-DoS), 6 MEDIUM (retry no backoff; err.message leak; force-dynamic no cache; dead summaryCache + intra-batch race; index React key; unguarded a.bullets), 2 LOW (maxDuration magic; placeholder empty-string padding). Score 26/100 — do not ship. Cleared: logger, SDK API usage, deps, no hardcoded secrets. No code changed.


---
## Phase 1 — Unit tests for route.js utils + CI test job
Date: 2026-06-16
Prompt:
Add unit tests for the utility functions in route.js and set them up to run in CI. (1) Install Jest as devDependency, configure for ES modules in package.json. (2) Create /lib/utils.js extracting two pure functions from route.js: envInt(name,def) (H2 fix — handles 0 and NaN) and clampPositive(value,min) (H3 fix). (3) Update route.js to import and use them instead of inline logic. (4) Create /lib/utils.test.js covering envInt (normal, missing fallback, NaN fallback, zero, negative, "garbage") and clampPositive (normal, zero, negative, below min). (5) Add "test":"jest" script. (6) Update .github/workflows/ci.yml with a test job (checkout, Node 20, npm ci, npm test) that build-and-push needs alongside lint. Don't change other logic. Verify tests pass locally.

Result:
Installed jest@^30, babel-jest@^30, @babel/preset-env@^7 as devDeps. ESM enabled via inline package.json jest config (babel-jest transform with preset-env targeting current node) — kept project CommonJS so config files (postcss/tailwind/next.config) and Next SWC stay intact; "test":"jest" literal as specified. Created lib/utils.js (envInt uses Number.isFinite so explicit 0 preserved, NaN falls back; clampPositive = Math.max(value,min)). route.js now imports both; BATCH_SIZE = clampPositive(envInt("BATCH_SIZE",3),1), other numeric envs via envInt. lib/utils.test.js: 10 tests, all passing locally (npm test → 10/10). Added modulePathIgnorePatterns for .next to silence a haste collision (local-only; .next not committed). ci.yml: new test job (checkout, setup-node 20, npm ci, npm test); build-and-push now needs:[lint, test]. No other logic changed.


---
## Phase 3 — Golden eval set for summarization quality
Date: 2026-06-16
Prompt:
Create a golden eval test set for Newsly's summarization quality. (1) Create /evals/golden_set.json — array of 5 eval examples, each with id, article_title, article_content (2-3 sentence real/plausible AI news story), and expected {bullet_count, min_bullet_length, max_bullet_length, must_mention, must_not_mention}. Use realistic AI news (OpenAI, Google, Anthropic, Meta, etc.). (2) Create /evals/README.md explaining what the golden set is, how to add examples, what each expected field means, how to run evals manually, and what Ragas is / why it matters for LLM pipelines.

Result:
Created evals/golden_set.json with 5 examples (eval_001..eval_005): GPT-5 agentic tool use, Gemini 3 benchmarks, Claude for Enterprise on-prem, Llama 4 open weights, Mistral $2B raise. Each has bullet_count 3, length bounds 20/200, a must_mention subject term, and shared must_not_mention refusal/hallucination markers. Validated: parses as 5-element array. Created evals/README.md: purpose (non-deterministic LLM regression guardrail, Phase 3), per-field schema table, add-example steps, manual run process (npm run dev → feed title+content through route summarize path → check 4 assertion classes per id), planned evals/run.mjs runner, and a Ragas section (faithfulness/relevancy/context metrics, why scored evals beat exact-match for non-deterministic news summaries, LangSmith integration tie-in). No app logic changed.


---
## Phase 1 — npm audit security job in CI
Date: 2026-06-16
Prompt:
Add npm audit to the CI pipeline as a security check. New job "security": runs-on ubuntu-latest, same triggers, steps checkout / setup Node 20 / npm ci / npm audit --audit-level=high. lint and test must NOT depend on security (all three parallel); only build-and-push needs all three (needs: [lint, test, security]). Push and verify pipeline goes green.

Result:
Added security job to .github/workflows/ci.yml (checkout, setup-node 20, npm ci, npm audit). build-and-push now needs:[lint, test, security]; lint/test/security all run in parallel (no inter-dependency). DEVIATION FROM SPEC (user-approved): the requested --audit-level=high FAILS locally (exit 1) — there are 4 real high-severity vulns (next@14.2.35 multiple DoS/SSRF/XSS/cache-poisoning advisories; glob CLI command injection via eslint-config-next), fixable only by major breaking upgrades (next@16, eslint-config-next@16). Asked the user how to proceed; user chose to raise the threshold to --audit-level=critical (0 critical today -> exit 0 -> green). Verified locally: npm audit --audit-level=critical exits 0. The 4 high + 18 moderate vulns remain unremediated and are no longer enforced by CI — tracked as follow-up. Note: gh CLI not installed in env, so post-push run status must be confirmed via the GitHub Actions web UI.


---
## Phase 1 — Add security job to ci.yml (already present)
Date: 2026-06-16
Prompt:
Read CLAUDE.md and .github/workflows/ci.yml fully before starting. Task: Add a security job to ci.yml. Add a new job called security alongside lint and test (all three run in parallel): runs-on ubuntu-latest; steps checkout, setup Node 20, npm ci, npm audit --audit-level=critical. Update build-and-push so it needs: [lint, test, security]. Do not change any other jobs. After completing, append to PROMPTS.md per logging rules.

Result:
No code change required — the requested state already exists in .github/workflows/ci.yml (committed earlier as `8a2ac61 ci: add npm audit security job`). Verified against spec: `security` job at lines 46-62 (runs-on ubuntu-latest; steps = checkout actions/checkout@v4, setup-node@v4 node 20, `npm ci`, `npm audit --audit-level=critical`); `build-and-push` declares `needs: [lint, test, security]` (line 65). lint, test, and security have no inter-dependencies, so all three run in parallel. No other jobs touched. Read CLAUDE.md + ci.yml before acting.


---
## Phase 3 — The Watcher v1 (autonomous PR review agent)
Date: 2026-06-16
Prompt:
Build The Watcher v1 — an autonomous GitHub PR review agent that runs as a GitHub Actions workflow. PART 1: watcher/index.js — Node script that reads env (GITHUB_TOKEN/PR_NUMBER/REPO_OWNER/REPO_NAME/GROQ_API_KEY), fetches PR diff (GET pulls/{n}/files, keep filename/status/patch, skip no-patch, cap 10 files), reviews via Groq llama-3.1-8b-instant (senior-reviewer system prompt, JSON findings array, max_tokens 1500, timeout 15s), posts a markdown PR comment (header, HIGH→MEDIUM→LOW tables, footer count; ✅ message if none), labels the PR (HIGH→needs-review, MED/LOW→watcher-checked, none→watcher-approved, create labels if absent), exit 1 if any HIGH else 0; malformed JSON→comment + exit 0, GitHub API fail→log + exit 1, errors→stderr/progress→stdout as JSON. PART 2: .github/workflows/watcher.yml (pull_request opened/synchronize/reopened on master; job review; checkout, Node 20, npm ci, node watcher/index.js; env from WATCHER_TOKEN/GROQ_API_KEY + event context). PART 3: watcher/package.json (node-fetch, groq-sdk, dotenv). PART 4: watcher/ARCHITECTURE.md. PART 5: CLAUDE.md "The Watcher" section. Don't touch ci.yml, route.js, or files outside watcher/ and CLAUDE.md.

Result:
- watcher/index.js (ESM): structured JSON logging (info→stdout, error→stderr); validates 5 required env vars (missing→exit 1); fetchPrFiles filters out no-patch + removed files and slices to first 10; reviewWithGroq calls llama-3.1-8b-instant via groq-sdk (temperature 0, max_tokens 1500, { timeout: 15000, maxRetries: 0 }); parseFindings strips ``` fences and extracts the JSON array (malformed→"⚠️ Watcher could not parse review output" comment + exit 0); buildComment renders header + HIGH/MEDIUM/LOW tables (pipe/newline-escaped cells) + "Found X issues" footer, or "✅ No issues found by The Watcher v1." when empty; ensureLabel creates the label (treats 422 as already-exists) then applyLabel attaches it; label chosen by chooseLabel (needs-review / watcher-checked / watcher-approved); GitHub API failures→stderr + exit 1; exit 1 iff any HIGH finding. Edge case: zero reviewable files → posts ✅ + watcher-approved, exit 0.
- .github/workflows/watcher.yml: separate from ci.yml; pull_request [opened, synchronize, reopened] on master; single `review` job (ubuntu-latest, permissions contents:read + pull-requests:write + issues:write for commenting/labeling); steps checkout@v4, setup-node@v4 (node 20), `npm ci` with working-directory: watcher, `node watcher/index.js`; env GITHUB_TOKEN=secrets.WATCHER_TOKEN, GROQ_API_KEY=secrets.GROQ_API_KEY, PR_NUMBER/REPO_OWNER/REPO_NAME from github event context.
- watcher/package.json: "type":"module", deps node-fetch ^3.3.2 (ESM), groq-sdk ^0.7.0, dotenv ^16.4.5. Generated watcher/package-lock.json (npm install --package-lock-only) so `npm ci` works in CI.
- watcher/ARCHITECTURE.md: what it is, the 6-step flow, error handling, what makes it autonomous, how to extend to other repos (env-parameterized; copy dir + workflow + secrets, or convert to reusable workflow_call).
- CLAUDE.md: new "The Watcher" section (what/where/secrets/trigger + label mapping), inserted after CI/CD Pipeline. ci.yml, route.js, and all other existing files untouched.
- Verified: `node --check watcher/index.js` → SYNTAX OK. Not run end-to-end (needs live GitHub PR event + WATCHER_TOKEN/GROQ_API_KEY secrets).

NOTE — required setup before it works: add a `WATCHER_TOKEN` GitHub Actions secret (token needs pull_request read + issues/PR write to comment and label). `GROQ_API_KEY` secret already exists from the deploy pipeline. The workflow installs deps via working-directory: watcher (separate package.json from root), and `node watcher/index.js` resolves watcher/node_modules. node-fetch v3 is ESM-only, hence "type":"module".


---
## Phase 3 — Subtitle bump to trigger Watcher PR test
Date: 2026-06-16
Prompt:
In app/page.js, change the subtitle from "Your daily AI news briefing ✦" to "Your daily AI news briefing ✦ v2" — tiny change to trigger a PR for Watcher testing.

Result:
app/page.js line 35: subtitle now "Your daily AI news briefing ✦ v2". One-character-ish diff, no other changes. Intended as a trivial diff to open a PR and exercise The Watcher v1 review workflow end-to-end (watcher.yml on pull_request → fetch diff → Groq review → PR comment + label).


---
## Phase 3 — Pass GROQ_API_KEY to Watcher step (already present)
Date: 2026-06-16
Prompt:
Read .github/workflows/watcher.yml fully. The Watcher workflow is failing because GROQ_API_KEY is not being passed to the Run The Watcher step. Fix: add GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }} to the env block of the Run The Watcher step alongside GITHUB_TOKEN, PR_NUMBER, REPO_OWNER, and REPO_NAME. Do not change anything else. After completing, append to PROMPTS.md.

Result:
No change required — `GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}` is already present in the "Run The Watcher" step env block (watcher.yml line 32), alongside GITHUB_TOKEN, PR_NUMBER, REPO_OWNER, REPO_NAME. It was wired in when the workflow was created. If the workflow still fails on Groq, the likely cause is the GROQ_API_KEY GitHub Actions secret not being set in repo settings (unset secret → empty string → index.js exits 1 "Missing required environment variables"); verify under Settings → Secrets and variables → Actions. No files changed.

SECURITY NOTE: during this task an editor selection pasted a real Groq key (gsk_...) from .env.local into the chat context. Flagged to the user to revoke/rotate it at console.groq.com; the value was not echoed or stored.


---
## Phase 3 — The Watcher v2 (auto test generation + ADR)
Date: 2026-06-16
Prompt:
Upgrade The Watcher to v2 with two additions. ADDITION 1 — Auto test generation: after posting the review comment, scan the PR diff for new/modified JS functions (added + lines containing function / const ... = / async function / arrow funcs), collect up to 5 signatures with ±3 lines context, make a second Groq call (llama-3.1-8b-instant) with test-engineer system prompt, post generated tests as a SECOND PR comment headed "## 🧪 Watcher v2 — Suggested Unit Tests" in a ```javascript block; if no functions found, skip entirely. ADDITION 2 — create watcher/ADR.md (ADR-001: Status/Context/Decision/Alternatives ≥3/Consequences pos+neg/Implementation Notes). Update CLAUDE.md The Watcher section to "v2" + add "posts two PR comments: findings + suggested unit tests". Don't change watcher.yml. Append to PROMPTS.md.

Result:
- watcher/index.js → v2: added TEST_SYSTEM_PROMPT + MAX_TEST_FUNCTIONS=5 consts. New extractFunctionSnippets(files) scans each patch for added (+, not +++) lines matching FUNCTION_PATTERNS [/\bfunction\b/, /=>/, /\bconst\s+\w+\s*=/], collects up to 5 snippets each with ±3 lines of diff context prefixed by `// <filename>`. New generateTests(snippets) makes a second Groq call (same model llama-3.1-8b-instant, max_tokens 1500, timeout 15s, temp 0) with the test-engineer system prompt. stripCodeFences() unwraps any ``` the model adds so it isn't nested. In main(), after the review comment + label step and before the final exit, the v2 block runs: no functions → log + skip (no comment); else post second comment "## 🧪 Watcher v2 — Suggested Unit Tests\n\n```javascript\n<code>\n```". Whole block is try/caught and NON-FATAL (a test-gen failure logs to stderr but never changes the review verdict / exit code). exit-1-on-HIGH behavior unchanged. Updated file banner to v2.
- watcher/ADR.md: ADR-001 with Status (Accepted), Context (AI-gen code needs checking, manual review doesn't scale), Decision (Actions workflow + Node agent + Groq + structured JSON + comments/labels + v2 test gen), Alternatives (Copilot PR review — paid/not customisable; CodeRabbit — external, data leaves repo; manual /brutalreview — not automated; + self-hosted model aside), Consequences (positive + negative/trade-offs: Groq rate limits, 15s timeout, first-10-files cap, LLM misses context), Implementation Notes (node-fetch not axios, separate package.json, exit 1 on HIGH, two separate comments).
- CLAUDE.md: heading now "## The Watcher (v2)"; says it posts two PR comments (findings + suggested unit tests); added watcher/ADR.md to the file list.
- watcher.yml untouched (workflow unchanged). Verified: node --check watcher/index.js → SYNTAX OK. Not run end-to-end (needs live PR event + secrets).

NOTE: test generation is best-effort and isolated — extraction is a heuristic line scan (may catch non-function `const x =` assignments or miss multi-line signatures), and generated Jest tests are suggestions posted as a comment, not run or committed. Reusing GROQ_MAX_TOKENS=1500 for the test pass means very large function sets could truncate.


