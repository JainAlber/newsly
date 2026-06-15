# Newsly — Deployment

Reference for the full deploy pipeline. For app/architecture rules see `CLAUDE.md`; for the change log see `PROMPTS.md`.

## 1. Overview

Newsly ships through two parallel paths from the same `master` branch. **Vercel** auto-deploys the Next.js app natively on every push (zero-config, no Docker). In parallel, a **GitHub Actions** pipeline lints the code, builds the production multi-stage Docker image, pushes it to **GitHub Container Registry (GHCR)**, and triggers a **Railway** redeploy of that image via the Railway GraphQL API. Vercel is the fast native preview/prod surface; Railway runs the containerized image that matches local Docker exactly. Uptime is watched by UptimeRobot.

## 2. Architecture

```
git push (master)
      │
      ├──────────────► Vercel (native Next.js build + deploy, automatic)
      │
      └──► GitHub Actions (.github/workflows/ci.yml)
              │
              ├─ Job 1: lint            → npm ci → npx next lint
              │
              ├─ Job 2: build-and-push  (needs: lint)
              │     → docker buildx build (multi-stage Dockerfile)
              │       build-arg GROQ_API_KEY=placeholder_key_for_compilation
              │     → push to GHCR: ghcr.io/jainalber/newsly:latest + :<git-sha>
              │       (push only on master; PRs build-only)
              │
              └─ Job 3: deploy          (needs: build-and-push, master only)
                    → curl POST https://backboard.railway.app/graphql/v2
                      mutation { serviceInstanceRedeploy(serviceId, environmentId) }
                    → Railway pulls the new image and redeploys
```

Each job gates the next via `needs:`. On a pull request, lint + build run for validation but nothing is pushed or deployed.

## 3. Environments

| Aspect            | Vercel                          | Railway                                   |
|-------------------|---------------------------------|-------------------------------------------|
| Build type        | Next.js native (no Docker)      | Docker image from GHCR                     |
| Trigger           | Auto on push to master          | CI-triggered (Actions `deploy` job)        |
| Artifact          | Vercel's own build output       | `ghcr.io/jainalber/newsly:<git-sha>`       |
| Use               | Fast native prod/preview        | Container parity with local Docker         |
| Domain            | Vercel-generated domain         | `newsly-production.up.railway.app`         |
| Redeploy on push  | Always                          | Only after image successfully pushed       |

Both track `master`. They are independent — a Railway failure does not affect the Vercel deploy and vice versa.

## 4. GitHub Secrets

Set under **Settings → Secrets and variables → Actions**.

| Secret                    | Used by              | Purpose                                                        |
|---------------------------|----------------------|----------------------------------------------------------------|
| `GROQ_API_KEY`            | Runtime (Vercel/Railway env) | Groq API auth for article summarization. CI build uses a placeholder build-arg, never the real key. |
| `GITHUB_TOKEN`            | `build-and-push` job | Auto-provisioned by Actions. Authenticates GHCR push (`packages: write`). No manual setup. |
| `RAILWAY_TOKEN`           | `deploy` job         | Bearer auth for the Railway GraphQL API.                       |
| `RAILWAY_SERVICE_ID`      | `deploy` job         | Identifies which Railway service to redeploy.                  |
| `RAILWAY_ENVIRONMENT_ID`  | `deploy` job         | Identifies which environment (e.g. production) to redeploy.    |

Secrets are injected into the deploy step via the job `env:` block — never inlined into the curl command, so they don't leak into logs. `GROQ_API_KEY` is a runtime secret on the hosting platforms, not a GitHub Actions secret used during build.

## 5. Local Development

**Native (fast iteration):**
```bash
npm install
echo "GROQ_API_KEY=your_key_here" > .env.local   # never commit this
npm run dev          # http://localhost:3000
```

**Docker Compose (production parity):**
```bash
# .env.local must exist with GROQ_API_KEY (loaded via env_file)
docker compose up -d --build   # build + boot detached
docker compose logs -f newsly  # follow logs
docker compose down            # stop + remove containers/network
```
Compose builds the same multi-stage `Dockerfile` the CI pipeline ships, so a clean `compose up` reproduces the Railway runtime locally. Use `npm run dev` for hot-reload work; use Compose to validate the container before pushing.

## 6. Monitoring

- **UptimeRobot** pings `https://newsly-production.up.railway.app` every **5 minutes**.
- Alerts fire if the Railway deployment is down or unresponsive.
- App-level logs: the news API emits structured JSON lines (`level`, `timestamp`, `message`, context) via `/lib/logger.js` — viewable in the Railway service logs (and Vercel function logs).

## 7. Rollback

Each push tags an immutable image `ghcr.io/jainalber/newsly:<git-sha>`, so any prior build can be re-deployed.

**Via Railway dashboard:**
1. Open the Newsly service → **Deployments** tab.
2. Find the previous good deployment (each lists its image tag / commit).
3. Click the deployment's menu → **Redeploy** (or **Rollback**) to restore that exact image.

**Via Git (re-triggers the whole pipeline):**
```bash
git revert <bad-sha>   # or reset to a known-good commit
git push origin master # CI rebuilds + redeploys cleanly
```
Prefer the dashboard redeploy for an immediate restore (no rebuild); use the Git path when you also want `master` to reflect the rollback.
