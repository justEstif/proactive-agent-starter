// Repo root and the root .env. Every app reads the same .env.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let root: string | undefined;

/** The checkout root: the nearest directory above this file with the root package.json (PAS_HOME overrides). */
export function repoRoot(): string {
  if (process.env.PAS_HOME) return resolve(process.env.PAS_HOME);
  if (root) return root;
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "package.json")) && dirname(dir) !== dir) dir = dirname(dir);
  root = existsSync(join(dir, "package.json"))
    ? dir
    : resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
  return root;
}

export function loadRootEnv(file = join(repoRoot(), ".env")): boolean {
  if (!existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set. Add it to ${join(repoRoot(), ".env")}.`);
  return value;
}
