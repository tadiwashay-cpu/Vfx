// Render viewer screenshots in headless Chromium (CDN routed to node_modules).
//   node tools/shots.mjs [name=query ...]   e.g. front="view=front" power="clip=PowerUp&t=0.9"
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = createRequire(import.meta.url)("playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 8766;
const srv = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: root, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const jobs = process.argv.slice(2).map((a) => a.split(/=(.*)/s));
const W = +(process.env.W || 720), H = +(process.env.H || 1280);
mkdirSync(join(root, "renders"), { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let failed = false;
try {
  for (const [name, q] of jobs) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
      const p = join(root, "node_modules/three", new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", ""));
      route.fulfill({ status: existsSync(p) ? 200 : 404, contentType: "text/javascript", body: existsSync(p) ? readFileSync(p) : "" });
    });
    await page.goto(`http://127.0.0.1:${port}/web/index.html?${/ui=/.test(q) ? "" : "ui=0&"}${q}`);
    await page.waitForFunction(() => window.__viewer && window.__viewer.ready, null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => { const c = window.__viewer.camera.position; return { cam: [c.x, c.y, c.z].map((v) => +v.toFixed(2)), programs: window.__viewer.renderer.info.programs.length }; });
    await page.screenshot({ path: join(root, "renders", name + ".png") });
    console.log(name, JSON.stringify(info), errors.length ? "ERRORS: " + errors.join(" | ") : "ok");
    if (errors.length || info.cam.some((v) => !isFinite(v))) failed = true;
    await page.close();
  }
} finally { await browser.close(); srv.kill(); }
process.exit(failed ? 1 : 0);
