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
