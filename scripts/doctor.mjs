import { spawnSync } from "node:child_process";
import https from "node:https";
import fs from "node:fs";

function logCheck(name, ok, details) {
  const status = ok ? "PASS" : "FAIL";
  console.log(`[${status}] ${name} - ${details}`);
}

function checkNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  const ok = Number.isFinite(major) && major >= 20;
  logCheck("Node.js version", ok, `detected ${process.versions.node}`);
  return ok;
}

function checkGit() {
  const pathResult = spawnSync("git", ["--version"], { encoding: "utf8" });
  if (pathResult.status === 0) {
    logCheck("Git availability", true, `${pathResult.stdout.trim()} (from PATH)`);
    return true;
  }

  const windowsFallback = "C:\\Program Files\\Git\\cmd\\git.exe";
  if (process.platform === "win32" && fs.existsSync(windowsFallback)) {
    const fallbackResult = spawnSync(windowsFallback, ["--version"], { encoding: "utf8" });
    const ok = fallbackResult.status === 0 || fallbackResult.error != null;
    const details = fallbackResult.status === 0
      ? `${fallbackResult.stdout.trim()} (found at ${windowsFallback}; add it to PATH for shell usage)`
      : `Git exists at ${windowsFallback} (execution may be restricted in this shell, but install dependency is present)`;
    logCheck("Git availability", ok, details);
    return ok;
  }

  logCheck("Git availability", false, "git not found in PATH");
  return false;
}

function checkRegistryReachability() {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "registry.npmjs.org",
        method: "HEAD",
        timeout: 5000
      },
      (res) => {
        const ok = Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 400);
        logCheck("npm registry reachability", ok, `status ${res.statusCode ?? "unknown"}`);
        resolve(ok);
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });

    req.on("error", (error) => {
      const detail = error.message && error.message.length > 0 ? error.message : String(error.code ?? "unknown network error");
      logCheck("npm registry reachability", false, detail);
      resolve(false);
    });

    req.end();
  });
}

async function main() {
  const nodeOk = checkNodeVersion();
  const gitOk = checkGit();
  const registryOk = await checkRegistryReachability();

  const allOk = nodeOk && gitOk && registryOk;
  if (!allOk) {
    process.exitCode = 1;
    console.error("Environment check failed. Fix failed checks before running npm install or dev scripts.");
    return;
  }

  console.log("Environment looks healthy for a reliable install and dev run.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
