// Pure config-parsing helpers extracted from app/api/news/route.js.
// envInt fixes H2 in CODE_REVIEW_BRUTAL.md (Number(env) || fallback silently
// discards an explicit 0 and masks NaN from a typo'd value). clampPositive
// fixes H3 (an unbounded BATCH_SIZE of 0 or negative could hang the batch loop).

// Parse an env var to an integer-ish number; fall back only when it is not a
// finite number (missing, "", "garbage" → NaN). An explicit 0 is preserved.
export function envInt(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : def;
}

// Clamp a number so it is never below min.
export function clampPositive(value, min) {
  return Math.max(value, min);
}
