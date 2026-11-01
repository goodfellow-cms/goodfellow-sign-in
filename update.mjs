// Brings this copy of the sign-in service up to date with the newest release of Goodfellow, whose
// create-goodfellow package carries it on npm (templates/sign-in/). The update workflow runs it each
// week; Cloudflare deploys the change once it's pushed. It keeps your Worker's name, and takes only
// a release that's been out a day, as Goodfellow's site updates do.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DAY = 24 * 60 * 60 * 1000;
const npm = (args) =>
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });

const info = JSON.parse(npm(["view", "create-goodfellow", "dist-tags", "time", "--json"]));
const releases = Object.entries(info.time)
  .filter(([version, at]) => /^\d+\.\d+\.\d+$/.test(version) && Date.now() - Date.parse(at) > DAY)
  .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]));
const latest = info["dist-tags"].latest;
const release = releases.find(([version]) => version === latest)?.[0] ?? releases[0]?.[0];
if (!release) throw new Error("npm lists no release of create-goodfellow old enough to use.");

const here = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const work = mkdtempSync(join(tmpdir(), "goodfellow-sign-in-"));
const [packed] = JSON.parse(
  npm(["pack", `create-goodfellow@${release}`, "--pack-destination", work, "--json", "--ignore-scripts"]),
);
execFileSync("tar", ["-xzf", join(work, packed.filename), "-C", work]);
const from = join(work, "package", "templates", "sign-in");
if (!existsSync(join(from, "worker.js"))) {
  console.log(`create-goodfellow ${release} doesn't carry the sign-in service yet.`);
  process.exit(0);
}

for (const file of ["worker.js", "deploy.mjs", "update.mjs", "package.json", "package-lock.json", "README.md"]) {
  if (existsSync(join(from, file))) cpSync(join(from, file), join(here, file));
}
if (existsSync(join(from, "_npmrc"))) cpSync(join(from, "_npmrc"), join(here, ".npmrc"));
// The release's settings, with the name you deployed it under.
const mine = JSON.parse(readFileSync(join(here, "wrangler.json"), "utf8"));
const theirs = JSON.parse(readFileSync(join(from, "wrangler.json"), "utf8"));
writeFileSync(join(here, "wrangler.json"), `${JSON.stringify({ ...theirs, name: mine.name }, null, 2)}\n`);
console.log(`Up to date with Goodfellow ${release}.`);
