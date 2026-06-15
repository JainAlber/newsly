import { NextResponse } from "next/server";
import Parser from "rss-parser";
import Groq from "groq-sdk";
import { logger } from "../../../lib/logger";

// RSS feeds change often; always fetch fresh.
export const dynamic = "force-dynamic";
// Allow Vercel up to 30s for the batched Groq calls below.
export const maxDuration = 30;

const FEEDS = [
  {
    name: "TechCrunch AI",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
  },
  {
    name: "OpenAI Blog",
    url: "https://openai.com/blog/rss.xml",
  },
  {
    name: "Google AI Blog",
    url: "https://blog.google/technology/ai/rss/",
  },
];

// Operational tunables — overridable via env, with the original values as
// fallbacks so behavior is unchanged when unset.
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 3;
const BATCH_DELAY_MS = Number(process.env.BATCH_DELAY_MS) || 500;
const GROQ_TIMEOUT_MS = Number(process.env.GROQ_TIMEOUT_MS) || 8000;
const RSS_TIMEOUT_MS = Number(process.env.RSS_TIMEOUT_MS) || 10000;
const MAX_RETRIES = Number(process.env.MAX_RETRIES) || 3;

// Fail fast on a hung feed instead of eating the whole maxDuration budget.
const parser = new Parser({ timeout: RSS_TIMEOUT_MS });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Surface a missing key once at module load — calls still degrade gracefully
// to placeholder bullets, but the misconfiguration is now visible in logs.
if (!process.env.GROQ_API_KEY) {
  logger.warn("GROQ_API_KEY is not set — summaries will fall back to placeholders");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripHtml(str = "") {
  return str
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Fallback when Groq fails twice — never the words "Summary unavailable".
function placeholderBullets(title) {
  return [
    `Click to read the full article about "${title}".`,
    "An automatic summary could not be generated this time.",
    "Open the link below for the full story.",
  ];
}

// One Groq attempt with an 8s per-call timeout.
async function callGroq(title, description) {
  const input = `Title: ${title}\n\nContent: ${stripHtml(description)}`;

  const completion = await groq.chat.completions.create(
    {
      model: GROQ_MODEL,
      messages: [
        {
          role: "user",
          content: `Summarize this news article in exactly 3 bullet points. Be concise and start each bullet with •\n\n${input}`,
        },
      ],
    },
    { timeout: GROQ_TIMEOUT_MS, maxRetries: 0 }
  );

  const text = completion.choices[0]?.message?.content ?? "";
  const bullets = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("•"))
    .map((line) => line.replace(/^•\s*/, "").trim())
    .slice(0, 3);

  if (bullets.length === 0) {
    throw new Error("Model returned no bullets");
  }
  // Pad partial (but real) summaries; empty strings are dropped in the UI.
  while (bullets.length < 3) bullets.push("");
  return bullets;
}

// Retry up to MAX_RETRIES times, then fall back to a placeholder.
async function summarize(title, description, source) {
  const shortTitle = title.slice(0, 50);
  logger.info("Groq summarization started", { title: shortTitle, source });
  const started = Date.now();

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    attempt += 1;
    try {
      const bullets = await callGroq(title, description);
      logger.info("Article summary succeeded", {
        title: shortTitle,
        source,
        attempt,
        duration_ms: Date.now() - started,
      });
      return bullets;
    } catch (err) {
      logger.warn("Groq summarization attempt failed", {
        title: shortTitle,
        source,
        attempt,
        max_retries: MAX_RETRIES,
        reason: err.message,
      });
    }
  }

  logger.error("Groq summarization exhausted retries, using fallback", {
    title: shortTitle,
    source,
    attempts: MAX_RETRIES,
  });
  return placeholderBullets(title);
}

async function fetchFeedItems({ name, url }) {
  logger.info("Fetching RSS source", { source: name });
  try {
    const feed = await parser.parseURL(url);
    return (feed.items || []).slice(0, 5).map((item) => ({
      title: item.title || "Untitled",
      link: item.link || "#",
      source: name,
      description: item.contentSnippet || item.content || item.summary || "",
    }));
  } catch (err) {
    // One broken feed should not kill the whole response.
    logger.error("Failed to fetch RSS source", {
      source: name,
      error: err.message,
    });
    return [];
  }
}

export async function GET() {
  const requestStart = Date.now();
  try {
    // Feeds are cheap — fetch them in parallel.
    const itemLists = await Promise.all(FEEDS.map(fetchFeedItems));
    const items = itemLists.flat();

    // Per-request checkpoint: completed summaries are cached by article URL so
    // work is never redone if the batch loop is interrupted and resumed.
    // In-memory only — lives for the duration of this request, no disk/deps.
    const summaryCache = new Map();

    // Summaries are the expensive part — process in batches of 3 with a
    // 500ms gap between batches to avoid hammering Groq all at once.
    const articles = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      const summarized = await Promise.all(
        batch.map(async (it) => {
          let bullets;
          if (summaryCache.has(it.link)) {
            logger.info("cache hit", { title: it.title });
            bullets = summaryCache.get(it.link);
          } else {
            bullets = await summarize(it.title, it.description, it.source);
            summaryCache.set(it.link, bullets);
          }
          return {
            title: it.title,
            link: it.link,
            source: it.source,
            bullets,
          };
        })
      );
      articles.push(...summarized);
      if (i + BATCH_SIZE < items.length) await sleep(BATCH_DELAY_MS);
    }

    logger.info("News request completed", {
      total_articles: articles.length,
      total_duration_ms: Date.now() - requestStart,
    });
    return NextResponse.json(articles);
  } catch (err) {
    logger.error("News request failed", {
      source: "request",
      error: err.message,
      total_duration_ms: Date.now() - requestStart,
    });
    return NextResponse.json(
      { error: err.message || "Failed to fetch news" },
      { status: 500 }
    );
  }
}
