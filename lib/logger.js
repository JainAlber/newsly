// Minimal structured logger — emits one JSON object per line to stdout.
// No external dependencies. Fields: level, timestamp (ISO), message, + context.

function log(level, message, context = {}) {
  const entry = {
    level,
    timestamp: new Date().toISOString(),
    message,
    ...context,
  };
  process.stdout.write(JSON.stringify(entry) + "\n");
}

export const logger = {
  info: (message, context) => log("info", message, context),
  warn: (message, context) => log("warn", message, context),
  error: (message, context) => log("error", message, context),
};
