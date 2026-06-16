# ADR-001: The Watcher — Automated PR Review Agent

## Status
Accepted

## Context
Newsly's codebase is increasingly written and modified by AI agents. AI-generated
code is fast to produce but is not automatically trustworthy — it can introduce
subtle bugs, security holes, missing error handling, type mismatches, and
hardcoded values that look plausible on the surface. Catching these depends on
code review, but manual review does not scale: it requires a human to be
available, attentive, and consistent on every single pull request, and review
quality degrades with volume and fatigue. In practice many PRs merge with only a
cursory glance. The Watcher fills that gap — an always-on reviewer that runs on
every PR, applies the same standard each time, and surfaces problems (and now
test gaps) before code reaches `master`.

## Decision
We built The Watcher as a self-contained agent that runs as its own GitHub
Actions workflow (`.github/workflows/watcher.yml`) on every pull request:
- A Node.js agent (`watcher/index.js`) fetches the PR diff from the GitHub API.
- It sends the diff to Groq (`llama-3.1-8b-instant`) with a strict senior-reviewer
  prompt and asks for findings as a structured JSON array
  (`file, line, severity, issue, suggestion`).
- It posts the findings as a markdown PR comment grouped HIGH → MEDIUM → LOW,
  applies a severity label (`needs-review` / `watcher-checked` /
  `watcher-approved`), and exits non-zero when a HIGH finding exists so CI fails
  visibly.
- **v2:** a second Groq pass scans the diff for new/modified functions and posts
  generated Jest unit tests as a second PR comment.
All progress is logged as structured JSON to stdout and errors to stderr.

## Alternatives Considered
- **GitHub Copilot PR review** — paid per-seat, and the review behavior is not
  customisable to our prompt, severity scheme, labels, or the test-generation
  step. Rejected: cost + lack of control.
- **CodeRabbit (or similar hosted review SaaS)** — capable, but an external
  service: repository code and diffs leave our infrastructure to a third party.
  Rejected: data residency / supply-chain exposure, plus ongoing cost.
- **Running `/brutalreview` manually** — high-quality, but not automated: a human
  must remember to trigger it and paste in the diff, so it is inconsistent and
  skipped under load. Rejected: defeats the purpose of catching every PR.
- *(Also considered: a self-hosted heavyweight model — rejected for the cost and
  ops burden versus Groq's fast, cheap inference.)*

## Consequences
### Positive
- Fully automated — no human has to trigger it.
- Runs on every PR (opened / synchronize / reopened), so nothing slips through.
- Consistent standard applied every time via a fixed system prompt.
- Catches bugs, security issues, and missing error handling before merge.
- Generates suggested unit tests, nudging contributors toward coverage.
- Self-hosted control: prompt, labels, severity, and exit behavior are all ours.

### Negative / Trade-offs
- Subject to Groq rate limits — bursts of PRs can throttle.
- 15s per-call timeout; very large diffs may time out before responding.
- Only reviews the first 10 files of a diff to stay within token limits, so wide
  PRs are partially covered.
- LLM review can miss cross-file context and whole-architecture concerns, and can
  produce false positives/negatives — it augments, not replaces, human review.
- Generated tests are suggestions, not verified; they may not run as-is.

## Implementation Notes
- **Why `node-fetch`, not axios** — the agent makes a handful of plain REST calls
  to the GitHub API; `node-fetch` is a thin, dependency-light fetch polyfill, so
  pulling in axios would be unnecessary weight.
- **Why a separate `watcher/package.json`** — the agent's deps (node-fetch,
  groq-sdk, dotenv) are isolated from the Next.js app so the app build and the
  watcher install never interfere, and the watcher can later be lifted into its
  own repo unchanged.
- **Why exit code 1 on HIGH** — a non-zero exit makes the Actions job fail
  visibly (red check on the PR), turning a HIGH finding into a hard merge signal
  rather than a comment that can be ignored.
- **Why two separate PR comments** — the review (findings + labels + pass/fail)
  and the suggested tests are distinct concerns with different audiences and
  lifecycles; keeping them as separate comments keeps each focused and lets the
  test step fail independently (non-fatally) without affecting the review verdict.
