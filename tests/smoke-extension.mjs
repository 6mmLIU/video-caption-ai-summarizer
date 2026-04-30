import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const extensionDir = rootDir;
const fixtureDir = join(rootDir, "tests", "fixtures");
const outputDir = join(rootDir, "output", "playwright");
const userDataDir = join(rootDir, "output", "chrome-profile");
const chromeCandidates = [
  "/Users/liu/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
];
const chromePath = await firstExisting(chromeCandidates);
const debugPort = 9227;

class Cdp {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", rejectOpen, { once: true });
    });
    return new Cdp(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) {
        return;
      }
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result || {});
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(payload);
    });
  }

  close() {
    this.socket.close();
  }
}

await mkdir(outputDir, { recursive: true });
await rm(userDataDir, { recursive: true, force: true });

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = url.pathname === "/" ? "/video-page.html" : url.pathname;
    const filePath = join(fixtureDir, pathname);
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": "no-store"
    });
    response.end(body);
  } catch (_error) {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
  }
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

const chrome = spawn(chromePath, [
  `--user-data-dir=${userDataDir}`,
  `--remote-debugging-port=${debugPort}`,
  "--remote-allow-origins=*",
  `--disable-extensions-except=${extensionDir}`,
  `--load-extension=${extensionDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--window-size=1440,960",
  "about:blank"
], {
  stdio: ["ignore", "ignore", "pipe"]
});

let browser = null;
const errors = [];
chrome.stderr.on("data", (chunk) => errors.push(String(chunk)));

try {
  const version = await waitForJson(`http://127.0.0.1:${debugPort}/json/version`, 15000);
  browser = await Cdp.connect(version.webSocketDebuggerUrl);

  const videoTarget = await createTarget(`${baseUrl}/video-page.html`);
  const videoPage = await Cdp.connect(videoTarget.webSocketDebuggerUrl);
  await videoPage.send("Page.enable");
  await videoPage.send("Runtime.enable");
  await waitForPageReady(videoPage);

  await waitForExpression(videoPage, `
    Boolean(document.querySelector("#vcs-root")?.shadowRoot?.querySelector(".vcs-panel"))
  `, 15000);
  await waitForExpression(videoPage, `
    (() => {
      const status = document.querySelector("#vcs-root")?.shadowRoot?.querySelector("#vcs-status")?.textContent || "";
      return status.includes("已发现") || status.includes("粘贴") || status.includes("失败");
    })()
  `, 15000);

  const panelState = await evaluate(videoPage, `
    const root = document.querySelector("#vcs-root");
    const shadow = root.shadowRoot;
    return {
      status: shadow.querySelector("#vcs-status")?.textContent || "",
      platform: shadow.querySelector(".vcs-chip")?.textContent || "",
      track: shadow.querySelector("#vcs-track")?.selectedOptions?.[0]?.textContent || "",
      title: shadow.querySelector(".vcs-meta-title")?.textContent || ""
    };
  `);

  await capture(videoPage, join(outputDir, "video-panel.png"));

  await evaluate(videoPage, `
    document.querySelector("#vcs-root").shadowRoot.querySelector("#vcs-collapse").click();
    return true;
  `);
  await waitForExpression(videoPage, `
    document.querySelector("#vcs-root")?.shadowRoot?.querySelector(".vcs-panel")?.classList.contains("is-collapsed")
  `, 5000);
  await capture(videoPage, join(outputDir, "video-panel-collapsed.png"));

  const extensionId = await waitForExtensionId(browser);

  const optionsTarget = await createTarget(`chrome-extension://${extensionId}/options/options.html`);
  const optionsPage = await Cdp.connect(optionsTarget.webSocketDebuggerUrl);
  await optionsPage.send("Page.enable");
  await optionsPage.send("Runtime.enable");
  await waitForPageReady(optionsPage);
  await capture(optionsPage, join(outputDir, "options-page.png"));

  const popupTarget = await createTarget(`chrome-extension://${extensionId}/popup/popup.html`);
  const popupPage = await Cdp.connect(popupTarget.webSocketDebuggerUrl);
  await popupPage.send("Page.enable");
  await popupPage.send("Runtime.enable");
  await waitForPageReady(popupPage);
  await capture(popupPage, join(outputDir, "popup.png"));

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    extensionId,
    panelState,
    screenshots: [
      "output/playwright/video-panel.png",
      "output/playwright/video-panel-collapsed.png",
      "output/playwright/options-page.png",
      "output/playwright/popup.png"
    ]
  }, null, 2));
} finally {
  if (browser) {
    await browser.close();
  }
  chrome.kill("SIGTERM");
  server.close();
}

async function createTarget(url) {
  const endpoint = `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`;
  const response = await fetch(endpoint, { method: "PUT" });
  if (!response.ok) {
    throw new Error(`Failed to create Chrome target: ${response.status}`);
  }
  return response.json();
}

async function waitForExtensionId(cdp) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    const targets = await cdp.send("Target.getTargets");
    const target = targets.targetInfos.find((item) => item.url.startsWith("chrome-extension://"));
    if (target) {
      return new URL(target.url).host;
    }
    await delay(250);
  }
  throw new Error("Extension service worker target was not found.");
}

async function waitForPageReady(cdp) {
  await waitForExpression(cdp, `document.readyState === "complete" || document.readyState === "interactive"`, 10000);
}

async function waitForExpression(cdp, expression, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await evaluate(cdp, `return (${expression});`);
    if (value) {
      return value;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => { ${expression} })()`,
    returnByValue: true,
    awaitPromise: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result.value;
}

async function capture(cdp, path) {
  const screenshot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  await writeFile(path, Buffer.from(screenshot.data, "base64"));
}

async function waitForJson(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response.json();
      }
    } catch (_error) {
      // Chrome is still starting.
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function contentType(filePath) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".vtt": "text/vtt; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8"
  };
  return types[extname(filePath)] || "application/octet-stream";
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function firstExisting(paths) {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch (_error) {
      // Try the next browser candidate.
    }
  }
  throw new Error("No Chromium-compatible browser executable was found.");
}
