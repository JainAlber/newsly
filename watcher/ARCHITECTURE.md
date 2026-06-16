# The Watcher v1 — Architecture

## What it is
The Watcher is an autonomous GitHub PR review agent. It runs as its own GitHub
Actions workflow (`.github/workflows/watcher.yml`) on every pull request to
`master`, reads the diff, asks Groq to review it, and writes its verdict back to
the PR — a comment, a label, and a pass/fail signal. No human triggers it and no
human is in the loop between "PR opened" and "review posted".

This is the first concrete piece of the Phase 3 "Watchers" network described in
the root `CLAUDE.md` roadmap.

## The 6-step flow
The agent (`watcher/index.js`) runs a fixed pipeline:

1. **Read config** — pulls `GITHUB_TOKEN`, `PR_NUMBER`, `REPO_OWNER`,
   `REPO_NAME`, and `GROQ_API_KEY` from the environment (all injected by the
   workflow). Missing any → exit 1.
2. **Fetch the diff** — `GET /repos/{owner}/{repo}/pulls/{pr}/files`. Keeps
   `filename`, `status`, and `patch`; skips files with no patch (binary /
   deleted); caps at the first 10 files to stay inside Groq's token budget.
3. **Review with Groq** — sends the concatenated diff to `llama-3.1-8b-instant`
   with a strict senior-reviewer system prompt, `max_tokens: 1500`,
   `timeout: 15s`. Asks for a JSON array of
   `{ file, line, severity, issue, suggestion }`.
4. **Post a comment** — `POST /repos/{owner}/{repo}/issues/{pr}/comments` with a
   markdown report: header, findings tables grouped HIGH → MEDIUM → LOW, and a
   footer count. No findings → a single "✅ No issues found" comment.
5. **Apply a label** — creates the label if it doesn't exist, then applies one:
   - any HIGH finding → `needs-review`
   - only MEDIUM/LOW → `watcher-checked`
   - no findings → `watcher-approved`
6. **Signal CI** — exits `1` if any HIGH finding (job fails visibly), else `0`.

### Error handling
- Malformed JSON from Groq → posts "Watcher could not parse review output" and
  exits `0` (a bad model response is not a code failure).
- Any GitHub API failure → logs to stderr and exits `1`.
- Progress logs are structured JSON to stdout; errors are structured JSON to
  stderr.

## What makes it autonomous
- **Self-triggering** — fires on `pull_request` events, not on a human command.
- **Self-contained decision** — it chooses the severity, the label, and the
  pass/fail outcome with no human approval step.
- **Acts on the world** — it writes back to GitHub (comment + label) and gates
  CI, rather than just printing a report someone has to read.
- **Fails safe** — a model hiccup degrades to a comment and a green exit; only
  real HIGH findings or infrastructure failures turn the job red.

## How to extend it to other repos later
The agent is parameterized entirely by environment variables, so nothing is
hardcoded to Newsly:
- **Drop it into another repo** — copy `watcher/` and
  `.github/workflows/watcher.yml`, add the `WATCHER_TOKEN` and `GROQ_API_KEY`
  secrets. `REPO_OWNER` / `REPO_NAME` / `PR_NUMBER` come from the Actions event.
- **Centralize it** — turn `watcher/` into a published package or a reusable
  workflow (`workflow_call`) and have each repo call it, so the logic lives in
  one place.
- **Tune the review** — adjust `SYSTEM_PROMPT`, `MAX_FILES`, `GROQ_MODEL`, or the
  label/severity mapping at the top of `index.js`.
- **Grow the network** — additional watchers (security, dependency, perf) can
  follow the same self-trigger → review → write-back → label pattern, forming the
  Phase 3 Watchers network.
