// One-command install: dependencies, then bearer tokens written into .env if missing.
// Safe to rerun: existing long tokens are kept.
import { join } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { ensureTokens, repoRoot } from "@pas/agent-sdk/node";

const root = repoRoot();
const envFile = join(root, ".env");
if (!existsSync(envFile)) writeFileSync(envFile, "", { mode: 0o600 });
const written = ensureTokens(envFile);
console.log(
  written.length
    ? `Wrote ${written.join(", ")} into .env. Keep them secret; change them any time.`
    : ".env already has both tokens. Nothing to do.",
);
console.log("Setup done. Start the server with: npm run dev");
