// The installed version of a dependency, found from where Node resolves it (works wherever node_modules lives).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function packageVersion(name: string): string {
  let dir = dirname(fileURLToPath(import.meta.resolve(name)));
  while (dirname(dir) !== dir) {
    const file = join(dir, "package.json");
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, "utf8")) as { name?: string; version?: string };
      if (pkg.name === name) return pkg.version ?? "unknown";
    }
    dir = dirname(dir);
  }
  return "unknown";
}
