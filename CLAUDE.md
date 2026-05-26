# Newsly — CLAUDE.md

## Project
A Next.js 14 app that fetches AI news from RSS feeds, summarizes each article using Groq AI into 3 bullet points, and displays them in a clean card UI.

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