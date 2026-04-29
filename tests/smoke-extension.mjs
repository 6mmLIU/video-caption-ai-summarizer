import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const extensionDir = rootDir;
const fixtureDir = join(rootDir, "tests", "fixtures");
const outputDir = join(rootDir, "output", "playwright");
const userDataDir = join(rootDir, "output", `chrome-profile-${Date.now()}`);
const externalVideoUrl = process.env.VCS_TEST_URL || "";
const externalNonVideoUrl = process.env.VCS_NON_VIDEO_URL || "";
const skipCopyCheck = process.env.VCS_SKIP_COPY === "1";
const chromeCandidates = [
  "/Users/liu/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
];
const chromePath = await firstExisting(chromeCandidates);
const debugPort = Number(process.env.VCS_DEBUG_PORT || 9227);

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
const targetVideoUrl = externalVideoUrl || `${baseUrl}/video-page.html`;
const targetNonVideoUrl = externalNonVideoUrl || `${baseUrl}/blank-page.html`;
const waitTimeout = externalVideoUrl ? 30000 : 15000;

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

  const videoTarget = await createTarget(targetVideoUrl);
  const videoPage = await Cdp.connect(videoTarget.webSocketDebuggerUrl);
  await videoPage.send("Page.enable");
  await videoPage.send("Runtime.enable");
  await waitForPageReady(videoPage);

  await waitForExpression(videoPage, `
    Boolean(document.querySelector("#vcs-root")?.shadowRoot?.querySelector(".vcs-panel"))
  `, waitTimeout);
  await waitForExpression(videoPage, `
    (() => {
      const status = document.querySelector("#vcs-root")?.shadowRoot?.querySelector("#vcs-status")?.textContent || "";
      return status.includes("已发现") || status.includes("粘贴") || status.includes("失败");
    })()
  `, waitTimeout);

  const panelState = await evaluate(videoPage, `
    const root = document.querySelector("#vcs-root");
    const shadow = root.shadowRoot;
    return {
      extensionId: root.dataset.extensionId || "",
      status: shadow.querySelector("#vcs-status")?.textContent || "",
      platform: shadow.querySelector(".vcs-subtitle")?.textContent?.split("·")?.[0]?.trim()
        || shadow.querySelector(".vcs-chip")?.textContent
        || "",
      track: shadow.querySelector("#vcs-track")?.selectedOptions?.[0]?.textContent || "",
      title: shadow.querySelector(".vcs-meta-title")?.textContent
        || shadow.querySelector(".vcs-meta span")?.textContent
        || "",
      collapsedByDefault: shadow.querySelector(".vcs-panel")?.classList.contains("is-collapsed") || false
    };
  `);

  if (!panelState.collapsedByDefault) {
    throw new Error("Panel should be collapsed by default.");
  }

  if (!panelState.status.includes("已发现")) {
    throw new Error(`Expected readable captions, got status: ${panelState.status}`);
  }

  await capture(videoPage, join(outputDir, "video-panel-collapsed.png"));

  await evaluate(videoPage, `
    document.querySelector("#vcs-root").shadowRoot.querySelector("#vcs-expand").click();
    return true;
  `);
  await waitForExpression(videoPage, `
    !document.querySelector("#vcs-root")?.shadowRoot?.querySelector(".vcs-panel")?.classList.contains("is-collapsed")
  `, 5000);
  await delay(280);
  await capture(videoPage, join(outputDir, "video-panel.png"));

  let copyState = null;
  if (!skipCopyCheck) {
    await evaluate(videoPage, `
      document.querySelector("#vcs-root").shadowRoot.querySelector("#vcs-copy-transcript").click();
      return true;
    `, { userGesture: true });
    await waitForExpression(videoPage, `
      (() => {
        const root = document.querySelector("#vcs-root");
        const shadow = root?.shadowRoot;
        const status = shadow?.querySelector("#vcs-status")?.textContent || "";
        return status.includes("字幕已复制") || status.includes("复制失败");
      })()
    `, waitTimeout);
    copyState = await evaluate(videoPage, `
      const root = document.querySelector("#vcs-root");
      const shadow = root.shadowRoot;
      return {
        status: shadow.querySelector("#vcs-status")?.textContent || "",
        transcriptLength: shadow.querySelector("#vcs-preview")?.value?.length || 0
      };
    `);
    if (!copyState.status.includes("字幕已复制") || copyState.transcriptLength < 40) {
      throw new Error(`Transcript copy failed: ${JSON.stringify(copyState)}`);
    }
  }

  await evaluate(videoPage, `
    document.querySelector("#vcs-root").shadowRoot.querySelector("#vcs-refresh").click();
    return true;
  `);
  await waitForExpression(videoPage, `
    document.querySelector("#vcs-root")?.shadowRoot?.querySelector("#vcs-refresh")?.classList.contains("is-spinning")
  `, 3000);

  const refreshAnimated = await evaluate(videoPage, `
    return document.querySelector("#vcs-root")?.shadowRoot?.querySelector("#vcs-refresh")?.classList.contains("is-spinning") || false;
  `);

  const nonVideoTarget = await createTarget(targetNonVideoUrl);
  const nonVideoPage = await Cdp.connect(nonVideoTarget.webSocketDebuggerUrl);
  await nonVideoPage.send("Page.enable");
  await nonVideoPage.send("Runtime.enable");
  await waitForPageReady(nonVideoPage);
  await delay(1200);
  const nonVideoState = await evaluate(nonVideoPage, `
    return {
      url: location.href,
      hasPanel: Boolean(document.querySelector("#vcs-root")?.shadowRoot?.querySelector(".vcs-panel"))
    };
  `);
  if (nonVideoState.hasPanel) {
    throw new Error("Panel should not mount on non-video pages.");
  }

  const extensionId = panelState.extensionId || await waitForExtensionId(browser);

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
  await popupPage.send("Emulation.setDeviceMetricsOverride", {
    width: 360,
    height: 430,
    deviceScaleFactor: 1,
    mobile: false
  });
  await waitForPageReady(popupPage);
  await capture(popupPage, join(outputDir, "popup.png"));

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    targetVideoUrl,
    targetNonVideoUrl,
    extensionId,
    panelState,
    copyState,
    skipCopyCheck,
    refreshAnimated,
    nonVideoState,
    screenshots: [
      "output/playwright/video-panel-collapsed.png",
      "output/playwright/video-panel.png",
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

async function evaluate(cdp, expression, options = {}) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => { ${expression} })()`,
    returnByValue: true,
    awaitPromise: true,
    userGesture: Boolean(options.userGesture)
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
