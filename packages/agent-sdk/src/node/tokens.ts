// Bearer tokens in the root .env: one for clients (read, chat, settings), one for cron (workflow only).
// Never prints a token.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const TOKEN_KEYS = ["PAS_CLIENT_TOKEN", "PAS_CRON_TOKEN"] as const;
export const newToken = () => `pas_${randomBytes(32).toString("base64url")}`;

/** Write any missing or short token into `envFile`, keep every other line. Returns the keys it wrote. */
export function ensureTokens(envFile: string, options: { rotate?: boolean } = {}): string[] {
  const text = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const lines = text ? text.split("\n") : [];
  const written: string[] = [];
  const values = new Map<string, string>();
  for (const key of TOKEN_KEYS) {
    const index = lines.findIndex((l) => l.startsWith(`${key}=`));
    const current =
      index >= 0
        ? lines[index]
            .slice(key.length + 1)
            .trim()
            .replace(/^["']|["']$/g, "")
        : "";
    const clash = [...values.values()].includes(current);
    if (!options.rotate && current.length >= 32 && !clash) {
      values.set(key, current);
      continue;
    }
    const token = newToken();
    values.set(key, token);
    if (index >= 0) lines[index] = `${key}=${token}`;
    else lines.push(`${key}=${token}`);
    written.push(key);
  }
  if (written.length)
    writeFileSync(envFile, `${lines.join("\n").replace(/\n*$/, "")}\n`, { mode: 0o600 });
  return written;
}
