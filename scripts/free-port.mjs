import { execSync } from "node:child_process";
import process from "node:process";

function parsePortArg() {
  const raw = process.argv[2] ?? process.env.PORT ?? "9001";
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return parsed;
}

function freePortWindows(port) {
  const output = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
  const pids = new Set();
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes("LISTENING")) {
      continue;
    }
    const parts = line.trim().split(/\s+/);
    const pid = Number(parts[parts.length - 1]);
    if (Number.isInteger(pid) && pid > 0) {
      pids.add(pid);
    }
  }

  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
      // eslint-disable-next-line no-console
      console.log(`[free-port] Stopped PID ${pid} on port ${port}`);
    } catch {
      // eslint-disable-next-line no-console
      console.warn(`[free-port] Could not stop PID ${pid} on port ${port} (maybe already exited)`);
    }
  }
}

function freePortPosix(port) {
  let pidsRaw = "";
  try {
    pidsRaw = execSync(`lsof -ti tcp:${port}`, { encoding: "utf8" });
  } catch {
    return;
  }
  const pids = pidsRaw
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      // eslint-disable-next-line no-console
      console.log(`[free-port] Stopped PID ${pid} on port ${port}`);
    } catch {
      // eslint-disable-next-line no-console
      console.warn(`[free-port] Could not stop PID ${pid} on port ${port}`);
    }
  }
}

function main() {
  const port = parsePortArg();
  if (process.platform === "win32") {
    try {
      freePortWindows(port);
    } catch {
      // eslint-disable-next-line no-console
      console.log(`[free-port] No LISTENING process on port ${port}`);
    }
    return;
  }
  freePortPosix(port);
}

main();
