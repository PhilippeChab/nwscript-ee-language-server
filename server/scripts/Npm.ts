import { execFileSync } from "child_process";
import { existsSync, realpathSync } from "fs";
import { basename, dirname, join } from "path";

// Run npm through Node.js, avoiding shell interpretation of workspace paths and
// Windows .cmd shims. Support nvm, hosted CI toolchains, and system installations.
export function runNpm(args: string[], cwd: string): string {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), join(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js")];
  try {
    const commands = execFileSync(process.platform === "win32" ? "where.exe" : "which", ["npm"], { encoding: "utf8" })
      .trim()
      .split(/\r?\n/);
    for (const command of commands) {
      candidates.push(realpathSync(command), join(dirname(command), "node_modules/npm/bin/npm-cli.js"));
    }
  } catch {
    /* The Node.js installation candidates above can still be used. */
  }
  const npm = candidates.find((candidate) => candidate && basename(candidate) === "npm-cli.js" && existsSync(candidate));
  if (!npm) throw new Error("Cannot locate npm. Install npm and ensure it is available on PATH.");
  return execFileSync(process.execPath, [npm, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
