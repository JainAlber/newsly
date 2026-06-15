# Newsly Summarization Evals

This directory holds the **golden eval set** for Newsly's article summarization. It is the ground-truth fixture used to check that the Groq summarization pipeline (`app/api/news/route.js`) keeps producing good 3-bullet summaries as the prompt, model, or batching logic changes.

This supports **Phase 3** of the roadmap (Observability, Watchers, & Evals) in `CLAUDE.md`.

## What the golden set is

`golden_set.json` is a hand-curated array of representative AI-news articles paired with the properties a correct summary must satisfy. Unlike unit tests (deterministic input → exact output), LLM output is non-deterministic, so we assert on **structural and content constraints** the summary must hold, not an exact string match.

It is a *regression guardrail*: if a prompt tweak or model swap quietly degrades quality, running the set should surface it before the change ships.

## Schema — what each `expected` field means

Each example:

```json
{
  "id": "eval_001",
  "article_title": "<the news headline>",
  "article_content": "<2-3 sentence body the model summarizes>",
  "expected": {
    "bullet_count": 3,
    "min_bullet_length": 20,
    "max_bullet_length": 200,
    "must_mention": ["GPT-5"],
    "must_not_mention": ["hallucinated", "I cannot", "As an AI"]
  }
}
```

| Field | Meaning | Why it matters |
|-------|---------|----------------|
| `id` | Stable unique identifier (`eval_NNN`). | Lets you track a single example's pass/fail over time. |
| `article_title` | The input headline. | Fed to the summarizer as the article title. |
| `article_content` | 2-3 sentence body. | The text the model summarizes. Keep it self-contained — no external context needed. |
| `bullet_count` | Exact number of bullets expected (always `3` here). | The product contract is "exactly 3 bullets". Anything else is a regression. |
| `min_bullet_length` | Minimum chars per bullet. | Catches empty / one-word bullets that pass count but say nothing. |
| `max_bullet_length` | Maximum chars per bullet. | Catches runaway bullets that ignore the "be concise" instruction. |
| `must_mention` | Terms at least one bullet must contain (case-insensitive). | Confirms the summary captured the core subject, not generic filler. |
| `must_not_mention` | Terms that must appear in **no** bullet. | Catches refusals ("I cannot"), persona leaks ("As an AI"), and obvious hallucination markers. |

## How to add a new eval example

1. Pick a real (or realistic, plausible) AI-news story — a single clear subject works best.
2. Append an object to the array in `golden_set.json` with the next sequential `id` (`eval_006`, …).
3. Write `article_content` as 2-3 self-contained sentences. Do not rely on facts outside the text.
4. Set `must_mention` to the 1-2 terms a faithful summary cannot omit (model name, company, the key number).
5. Keep `must_not_mention` aligned with the shared refusal/hallucination markers unless the story needs extra ones.
6. Keep the length bounds (`20`/`200`) unless you have a reason to change them globally.

## How to run the evals (manual process)

Not automated yet. Manual loop until a runner script lands:

1. **Start the app** so the summarizer is reachable:
   ```bash
   npm run dev
   ```
2. **For each example**, send `article_title` + `article_content` through the same summarization path the route uses (the Groq call in `app/api/news/route.js`). Easiest path today is a small throwaway script that imports the summarize logic, or paste the title+content into the prompt template manually.
3. **Collect the 3 bullets** the model returns.
4. **Check each assertion** against `expected`:
   - bullets length === `bullet_count`
   - every bullet length between `min_bullet_length` and `max_bullet_length`
   - every `must_mention` term appears in at least one bullet (case-insensitive)
   - no `must_not_mention` term appears in any bullet
5. **Record pass/fail per `id`.** Any failure = investigate the prompt/model before shipping.

> **Next step (planned):** an `evals/run.mjs` script that loads `golden_set.json`, calls the summarizer for each example, applies the assertions automatically, and prints a pass/fail table. Wire it into CI as a non-blocking quality check.

## What Ragas is and why it matters

[**Ragas**](https://github.com/explodinggradients/ragas) ("RAG Assessment") is an open-source Python framework for **evaluating LLM application output with metrics instead of eyeballing**. It was built for RAG pipelines but its metrics apply to any generation step, including summarization.

The structural checks in this golden set (bullet count, length, keyword presence) catch *format* and *gross* failures. They cannot tell you whether a bullet is **factually faithful** to the source article or **actually relevant**. That gap is what Ragas fills:

- **Faithfulness** — does every claim in the summary trace back to the source text? This is the direct, automated measure of hallucination, which our `must_not_mention` markers only approximate.
- **Answer / summary relevancy** — does the output stay on-topic and cover the important parts, or drift into filler?
- **Context precision / recall** — for RAG, whether retrieved context was the right context. Less central to pure summarization but relevant if Newsly later retrieves related articles.

Why it matters for an LLM pipeline like Newsly:

1. **Non-determinism needs scored evals, not assertions.** Exact-match testing breaks the moment the model rewords. Ragas gives a graded score (0-1) you can threshold and trend.
2. **Faithfulness is the metric that matters for news.** A confident, fluent, *wrong* summary is the worst failure mode. Ragas measures it directly rather than guessing from banned phrases.
3. **It feeds the Phase 3 vision.** Ragas integrates with LangSmith (the roadmap's chosen tracing/eval tool), so the golden set here can graduate into a LangSmith dataset scored by Ragas metrics, with quality guardrails enforced on every pipeline change.

Roadmap: keep the structural golden set as the fast, dependency-free first gate; layer Ragas faithfulness/relevancy scoring on top once the eval runner exists.
