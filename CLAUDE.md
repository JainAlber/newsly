# Newsly — CLAUDE.md

## Project
A Next.js 14 app that fetches AI news from RSS feeds, summarizes each article using Groq AI into 3 bullet points, and displays them in a clean card UI.

## Long-Term Project Vision & Roadmap

### Phase 1: Infrastructure & Orchestration (Current Focus)
- Hardening the multi-stage production Docker environment to optimize image sizing.
- Implementing multi-container orchestration via Docker Compose for localized network isolation and seamless local deployment.
- Hardening automated CI/CD pipelines via GitHub Actions for continuous code integration and validation checking.

### Phase 2: AI Agents & Custom Tools (Upcoming)
- Evolving the codebase into an autonomous, multi-step agent workflow.
- Designing a custom Model Context Protocol (MCP) server allowing LLMs to safely read, manipulate, parse, and process feed criteria.
- Transitioning static summary endpoints into automated parallel feed processing with rate-limited backend batching layers.

### Phase 3: Observability, Watchers, & Evals
- Building an internal automated "Watchers" network for real-time tracking, evaluation, and system health checks.
- Integrating LangSmith to implement evaluation datasets, monitoring traces, and strict quality guardrails for LLM processing pipelines.

## App Name
Newsly

## Tech Stack
- Framework: Next.js 14 (App Router)
- Styling: Tailwind CSS
- AI: Groq API (model: llama-3.1-8b-instant)
- News Source: RSS feeds (no database, no auth)

## Rules
- Always use .env.local for API keys — never hardcode them
- Never commit .env.local to GitHub
- Keep components simple — one file per component
- Use async/await, not .then()
- All API calls go in /app/api/ routes, never in frontend components directly

## RSS Sources
- TechCrunch AI: https://techcrunch.com/category/artificial-intelligence/feed/
- OpenAI Blog: https://openai.com/blog/rss.xml
- Google AI Blog: https://blog.google/technology/ai/rss/

## What NOT to do
- No database
- No authentication
- No TypeScript strict errors — keep it simple
- Do not use paid APIs other than Groq

## Prompt Logging
After completing any task I am given, I must append an entry to PROMPTS.md in this exact format:

---
## [Phase name — short description]
Date: [today's date]
Prompt:
[the full prompt that was given]

Result:

---

Do this automatically after every prompt without being asked.

## CI/CD Pipeline
- Platform: GitHub Actions
- Registry: GitHub Container Registry (GHCR) — ghcr.io/jainalber/newsly
- Workflow file: .github/workflows/ci.yml
- Triggers: push to master, pull_request to master
- Jobs (in order):
  1. lint — runs ESLint on the codebase
  2. build-and-push — builds the Docker image, pushes to GHCR on master only
  3. deploy — triggers a Railway redeploy after the image is pushed to GHCR (master only)
- The GROQ_API_KEY build arg uses the placeholder value during CI
- Vercel deploy continues to trigger automatically and is separate
- RAILWAY_TOKEN, RAILWAY_SERVICE_ID, and RAILWAY_ENVIRONMENT_ID are saved as GitHub Secrets
- The deploy job calls the Railway GraphQL API (serviceInstanceRedeploy with serviceId + environmentId) to redeploy
- Railway project is live at the generated Railway domain