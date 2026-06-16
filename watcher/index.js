// The Watcher v2 — autonomous GitHub PR review agent.
// Runs inside GitHub Actions on every PR. Fetches the diff, asks Groq to review
// it, posts the findings as a PR comment, labels the PR, and fails the job if any
// HIGH-severity issue is found. v2 adds a second Groq pass that generates Jest
// unit tests for new/modified functions and posts them as a second comment.
// See ARCHITECTURE.md for the full flow.

import "dotenv/config";
import fetch from "node-fetch";
import Groq from "groq-sdk";

// ---------------------------------------------------------------------------
// Structured logging: progress -> stdout (JSON lines), errors -> stderr (JSON).
// ---------------------------------------------------------------------------
function logInfo(message, context = {}) {
  process.stdout.write(
    JSON.stringify({ level: "info", timestamp: new Date().toISOString(), message, ...context }) + "\n"
  );
}

function logError(message, context = {}) {
  process.stderr.write(
    JSON.stringify({ level: "error", timestamp: new Date().toISOString(), message, ...context }) + "\n"
  );
}

// ---------------------------------------------------------------------------
// Config from environment (all injected by the GitHub Actions workflow).
// ---------------------------------------------------------------------------
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const PR_NUMBER = process.env.PR_NUMBER;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const GROQ_MODEL = "llama-3.1-8b-instant";
const MAX_FILES = 10;
const MAX_DIFF_CHARS = 3000;
const GROQ_MAX_TOKENS = 1500;
const GROQ_TIMEOUT_MS = 15000;
const GITHUB_API = "https://api.github.com";

const SYSTEM_PROMPT =
  "You are a senior code reviewer. Be direct and specific. Focus on: bugs, security issues, missing error handling, type mismatches, and hardcoded values. Do not praise. Only flag real problems.";

const TEST_SYSTEM_PROMPT =
  "You are a test engineer. Given these JavaScript function signatures from a PR diff, generate Jest unit tests for each one. Return only the test code, no explanation. Use describe/it/expect pattern.";

const MAX_TEST_FUNCTIONS = 5;

// ---------------------------------------------------------------------------
// GitHub API helpers.
// ---------------------------------------------------------------------------
function githubHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
    "User-Agent": "newsly-watcher-v1",
  };
}

async function fetchPrFiles() {
  const url = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}/files?per_page=100`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub list-files failed: ${res.status} ${body}`);
  }
  const files = await res.json();
  // Skip binary/deleted files (no patch); cap at MAX_FILES for Groq token budget.
  return files
    .filter((f) => f.patch && f.status !== "removed")
    .slice(0, MAX_FILES)
    .map((f) => ({ filename: f.filename, status: f.status, patch: f.patch }));
}

async function postComment(body) {
  const url = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/issues/${PR_NUMBER}/comments`;
  const res = await fetch(url, {
    method: "POST",
    headers: githubHeaders(),
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub post-comment failed: ${res.status} ${text}`);
  }
}

async function ensureLabel(name) {
  // Create the label if missing; 422 = already exists, which is fine.
  const url = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/labels`;
  const colorByName = {
    "needs-review": "d73a4a",
    "watcher-checked": "fbca04",
    "watcher-approved": "0e8a16",
  };
  const res = await fetch(url, {
    method: "POST",
    headers: githubHeaders(),
    body: JSON.stringify({ name, color: colorByName[name] || "ededed", description: "Set by The Watcher v1" }),
  });
  if (!res.ok && res.status !== 422) {
    const text = await res.text();
    throw new Error(`GitHub create-label failed: ${res.status} ${text}`);
  }
}

async function applyLabel(name) {
  await ensureLabel(name);
  const url = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/issues/${PR_NUMBER}/labels`;
  const res = await fetch(url, {
    method: "POST",
    headers: githubHeaders(),
    body: JSON.stringify({ labels: [name] }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub apply-label failed: ${res.status} ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Groq review.
// ---------------------------------------------------------------------------
function buildDiffText(files) {
  return files
    .map((f) => `### FILE: ${f.filename} (${f.status})\n${f.patch}`)
    .join("\n\n");
}

async function reviewWithGroq(files) {
  const groq = new Groq({ apiKey: GROQ_API_KEY });
  let diffText = buildDiffText(files);
  // Cap the diff so the prompt stays under Groq's 6000 TPM token limit (avoids 413).
  if (diffText.length > MAX_DIFF_CHARS) {
    logInfo("Diff truncated to fit token limit", {
      original_length: diffText.length,
      truncated_length: MAX_DIFF_CHARS,
    });
    diffText = diffText.slice(0, MAX_DIFF_CHARS);
  }
  const userPrompt =
    "Review the following pull request diff. Return ONLY a JSON array of findings, " +
    "no prose, in this exact shape:\n" +
    '[{ "file": "filename", "line": "approximate line", "severity": "HIGH|MEDIUM|LOW", "issue": "description", "suggestion": "exact fix" }]\n' +
    "If there are no problems, return [].\n\nDIFF:\n" +
    diffText;

  const completion = await groq.chat.completions.create(
    {
      model: GROQ_MODEL,
      max_tokens: GROQ_MAX_TOKENS,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    },
    { timeout: GROQ_TIMEOUT_MS, maxRetries: 0 }
  );

  return completion.choices?.[0]?.message?.content || "";
}

// ---------------------------------------------------------------------------
// v2 — auto test generation.
// ---------------------------------------------------------------------------
// Patterns that mark a JS function on an added (+) diff line.
const FUNCTION_PATTERNS = [/\bfunction\b/, /=>/, /\bconst\s+\w+\s*=/];

// Scan each file patch for added lines that declare a function and collect up to
// MAX_TEST_FUNCTIONS snippets, each with ±3 lines of surrounding diff context.
function extractFunctionSnippets(files, max = MAX_TEST_FUNCTIONS) {
  const snippets = [];
  for (const f of files) {
    const lines = f.patch.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith("+") || line.startsWith("+++")) continue; // added lines only
      const code = line.slice(1);
      if (!FUNCTION_PATTERNS.some((re) => re.test(code))) continue;
      const start = Math.max(0, i - 3);
      const end = Math.min(lines.length - 1, i + 3);
      const context = lines.slice(start, end + 1).join("\n");
      snippets.push(`// ${f.filename}\n${context}`);
      if (snippets.length >= max) return snippets;
    }
  }
  return snippets;
}

async function generateTests(snippets) {
  const groq = new Groq({ apiKey: GROQ_API_KEY });
  const userPrompt =
    "Generate Jest unit tests for these JavaScript functions taken from a PR diff. " +
    "Each block is prefixed with its source filename.\n\n" +
    snippets.join("\n\n---\n\n");

  const completion = await groq.chat.completions.create(
    {
      model: GROQ_MODEL,
      max_tokens: GROQ_MAX_TOKENS,
      temperature: 0,
      messages: [
        { role: "system", content: TEST_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    },
    { timeout: GROQ_TIMEOUT_MS, maxRetries: 0 }
  );

  return completion.choices?.[0]?.message?.content || "";
}

// Strip a surrounding ``` fence so we don't nest fences inside our own block.
function stripCodeFences(s) {
  const m = s.trim().match(/^```(?:javascript|js)?\s*([\s\S]*?)```$/i);
  return (m ? m[1] : s).trim();
}

// Pull a JSON array out of the model output even if it wrapped it in prose/fences.
function parseFindings(raw) {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON array found in model output");
  }
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("parsed value is not an array");
  return parsed;
}

// ---------------------------------------------------------------------------
// Comment formatting.
// ---------------------------------------------------------------------------
function escapeCell(s) {
  return String(s == null ? "" : s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function severityTable(findings, severity) {
  const rows = findings.filter((f) => (f.severity || "").toUpperCase() === severity);
  if (rows.length === 0) return "";
  let md = `### ${severity}\n\n| File | Line | Issue | Suggestion |\n| --- | --- | --- | --- |\n`;
  for (const f of rows) {
    md += `| ${escapeCell(f.file)} | ${escapeCell(f.line)} | ${escapeCell(f.issue)} | ${escapeCell(f.suggestion)} |\n`;
  }
  return md + "\n";
}

function buildComment(findings) {
  if (findings.length === 0) {
    return "✅ No issues found by The Watcher v1.";
  }
  let body = "## 🔍 Watcher v1 — Automated Code Review\n\n";
  body += severityTable(findings, "HIGH");
  body += severityTable(findings, "MEDIUM");
  body += severityTable(findings, "LOW");
  body += `\n_Found ${findings.length} issue${findings.length === 1 ? "" : "s"}. Review generated by The Watcher v1._`;
  return body;
}

function chooseLabel(findings) {
  const hasHigh = findings.some((f) => (f.severity || "").toUpperCase() === "HIGH");
  if (hasHigh) return "needs-review";
  if (findings.length > 0) return "watcher-checked";
  return "watcher-approved";
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
async function main() {
  const missing = ["GITHUB_TOKEN", "PR_NUMBER", "REPO_OWNER", "REPO_NAME", "GROQ_API_KEY"].filter(
    (k) => !process.env[k]
  );
  if (missing.length > 0) {
    logError("Missing required environment variables", { missing });
    process.exit(1);
  }

  logInfo("Watcher started", { pr: PR_NUMBER, repo: `${REPO_OWNER}/${REPO_NAME}` });

  // Step 2 — fetch diff. GitHub API failure => log + exit 1.
  let files;
  try {
    files = await fetchPrFiles();
    logInfo("Fetched PR files", { count: files.length });
  } catch (err) {
    logError("Failed to fetch PR files", { error: err.message });
    process.exit(1);
  }

  if (files.length === 0) {
    logInfo("No reviewable files (all binary/deleted)", {});
    try {
      await postComment("✅ No issues found by The Watcher v1.");
      await applyLabel("watcher-approved");
    } catch (err) {
      logError("GitHub API call failed", { error: err.message });
      process.exit(1);
    }
    process.exit(0);
  }

  // Step 3 — Groq review.
  let raw;
  try {
    raw = await reviewWithGroq(files);
    logInfo("Groq review received", { chars: raw.length });
  } catch (err) {
    logError("Groq review call failed", { error: err.message });
    process.exit(1);
  }

  // Parse findings. Malformed JSON => comment + exit 0 (not a CI failure).
  let findings;
  try {
    findings = parseFindings(raw);
    logInfo("Parsed findings", { count: findings.length });
  } catch (err) {
    logError("Could not parse Groq output", { error: err.message });
    try {
      await postComment("⚠️ Watcher could not parse review output.");
    } catch (postErr) {
      logError("GitHub API call failed", { error: postErr.message });
      process.exit(1);
    }
    process.exit(0);
  }

  // Steps 4 + 5 — post comment and label. GitHub API failure => log + exit 1.
  const hasHigh = findings.some((f) => (f.severity || "").toUpperCase() === "HIGH");
  try {
    await postComment(buildComment(findings));
    const label = chooseLabel(findings);
    await applyLabel(label);
    logInfo("Posted review and applied label", { label, findings: findings.length, hasHigh });
  } catch (err) {
    logError("GitHub API call failed", { error: err.message });
    process.exit(1);
  }

  // v2 ADDITION — generate Jest tests for new/modified functions and post them
  // as a second comment. Non-fatal: a failure here never sinks the review.
  try {
    const snippets = extractFunctionSnippets(files);
    if (snippets.length === 0) {
      logInfo("No functions found in diff, skipping test generation", {});
    } else {
      const rawTests = await generateTests(snippets);
      const code = stripCodeFences(rawTests);
      if (code) {
        await postComment("## 🧪 Watcher v2 — Suggested Unit Tests\n\n```javascript\n" + code + "\n```");
        logInfo("Posted suggested unit tests", { functions: snippets.length });
      } else {
        logInfo("Test generation returned empty output, skipping comment", {});
      }
    }
  } catch (err) {
    logError("Test generation step failed (non-fatal)", { error: err.message });
  }

  // Step 6 — fail the job visibly if any HIGH finding.
  process.exit(hasHigh ? 1 : 0);
}

main().catch((err) => {
  logError("Unhandled error", { error: err.message });
  process.exit(1);
});
