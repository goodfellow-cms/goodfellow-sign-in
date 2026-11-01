// Deploys the sign-in service, telling it the name it's deployed under, which its setup page (/setup)
// uses to find it in your Cloudflare account and save its settings there. Cloudflare runs this as
// the deploy command each time this repository changes.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const { name } = JSON.parse(readFileSync(new URL("./wrangler.json", import.meta.url), "utf8"));
if (typeof name !== "string" || !/^[a-z0-9-]+$/.test(name))
  throw new Error(`wrangler.json's name, ${name}, isn't a Worker's name.`);
const windows = process.platform === "win32";
const result = spawnSync(windows ? "npx.cmd" : "npx", ["wrangler", "deploy", "--var", `WORKER_NAME:${name}`], {
  stdio: "inherit",
  shell: windows,
});
process.exit(result.status ?? 1);
