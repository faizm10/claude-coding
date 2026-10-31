#!/usr/bin/env node
// Entry point: silence Node's "SQLite is experimental" notice before anything loads it.
const emit = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const text = typeof warning === "string" ? warning : warning?.message;
  if (text?.includes("SQLite is an experimental feature")) return;
  return (emit as (...a: unknown[]) => void).call(process, warning, ...args);
}) as typeof process.emitWarning;

await import("./main.js");
