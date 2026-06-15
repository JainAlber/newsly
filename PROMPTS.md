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
