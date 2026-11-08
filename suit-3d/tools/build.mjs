// Build models/suit.glb (+ web/suit.glb.txt) from src/, in headless Chromium.
//   node tools/build.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 8765;
export function serve() {
  const srv = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: root, stdio: "ignore" });
  return new Promise((r) => setTimeout(() => r(srv), 800));
}
const srv = await serve();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`http://127.0.0.1:${port}/tools/export.html`);
  await page.waitForFunction(() => window.ready || false, null, { timeout: 30000 }).catch(() => {});
  if (errors.length) throw new Error(errors.join("\n"));
  const res = await page.evaluate(() => window.exportGLB());
  const bin = Buffer.from(res.b64, "base64");
  mkdirSync(join(root, "models"), { recursive: true }); mkdirSync(join(root, "web"), { recursive: true });
  writeFileSync(join(root, "models/suit.glb"), bin);
  writeFileSync(join(root, "web/suit.glb.txt"), res.b64);
  const tris = Object.values(res.stats).reduce((a, b) => a + b, 0);
  console.log(JSON.stringify({ bytes: bin.length, triangles: tris, perMaterial: res.stats, bones: res.bones, clips: res.clips }));
} finally { await browser.close(); srv.kill(); }
