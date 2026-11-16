// `npm run dev:admin`: the admin site (APP_SURFACE=admin) on port 3001, next to
// `npm run dev` (public site, port 3000). See documentation/manuals/SUBDOMAINS.md.
//
// Values come from .env.local (shared, read by Next.js) and then
// .env.admin.local (admin only, git-ignored), which wins. The admin site
// needs its own BETTER_AUTH_SECRET, BETTER_AUTH_URL and AUTH_JWT_ISSUER.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readEnvFile(name) {
  const file = path.join(appRoot, name);
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  return out;
}

const adminEnv = readEnvFile(".env.admin.local");
if (Object.keys(adminEnv).length === 0) {
  console.warn("[dev:admin] No .env.admin.local. Copy the admin block of .env.example to it.");
}

const env = {
  ...process.env,
  ...adminEnv,
  APP_SURFACE: "admin",
  // Its own build folder: two dev servers cannot share .next.
  NEXT_DIST_DIR: ".next-admin",
  NEXT_TSCONFIG_PATH: "tsconfig.admin.json",
};

const nextBin = path.join(appRoot, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "dev", "-p", "3001"], { cwd: appRoot, env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
