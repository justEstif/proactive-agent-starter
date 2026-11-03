// Offline dev: the API server and the cron loop together, one Ctrl-C for both.
import { spawn } from "node:child_process";

const procs = [
  spawn("npm", ["run", "dev", "-w", "apps/server"], { stdio: "inherit" }),
  spawn("npm", ["run", "cron", "-w", "apps/cron"], { stdio: "inherit" }),
];
const stop = () => {
  for (const p of procs) p.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => {
  if (code) stop();
});
