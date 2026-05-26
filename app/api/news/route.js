import { NextResponse } from "next/server";
import Parser from "rss-parser";
import Groq from "groq-sdk";

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

const BATCH_SIZE = 3;
const BATCH_DELAY_MS = 500;
const GROQ_TIMEOUT_MS = 8000;

const parser = new Parser();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
      model: "llama-3.1-8b-instant",
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

// Timeout once, retry once, then fall back to a placeholder.
async function summarize(title, description) {
  try {
    return await callGroq(title, description);
  } catch {
    try {
      return await callGroq(title, description);
    } catch {
      return placeholderBullets(title);
    }
  }
}

async function fetchFeedItems({ name, url }) {
  try {
    const feed = await parser.parseURL(url);
    return (feed.items || []).slice(0, 5).map((item) => ({
      title: item.title || "Untitled",
      link: item.link || "#",
      source: name,
      description: item.contentSnippet || item.content || item.summary || "",
    }));
  } catch {
    // One broken feed should not kill the whole response.
    return [];
  }
}

export async function GET() {
  try {
    // Feeds are cheap — fetch them in parallel.
    const itemLists = await Promise.all(FEEDS.map(fetchFeedItems));
    const items = itemLists.flat();

    // Summaries are the expensive part — process in batches of 3 with a
    // 500ms gap between batches to avoid hammering Groq all at once.
    const articles = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      const summarized = await Promise.all(
        batch.map(async (it) => ({
          title: it.title,
          link: it.link,
          source: it.source,
          bullets: await summarize(it.title, it.description),
        }))
      );
      articles.push(...summarized);
      if (i + BATCH_SIZE < items.length) await sleep(BATCH_DELAY_MS);
    }

    return NextResponse.json(articles);
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Failed to fetch news" },
      { status: 500 }
    );
  }
}
