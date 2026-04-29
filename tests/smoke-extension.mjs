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
const skipExtendedOptionsChecks = process.env.VCS_SKIP_EXTENDED_OPTIONS === "1";
const chromeCandidates = [
  "/Users/liu/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
];
const chromePath = await firstExisting(chromeCandidates);
const debugPort = Number(process.env.VCS_DEBUG_PORT || 9227);
const modelRequests = [];

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
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 20000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeoutId);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
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
    if (url.pathname === "/mock-chat") {
      const rawBody = await readRequestBody(request);
      let body = null;
      try {
        body = rawBody ? JSON.parse(rawBody) : null;
      } catch (_error) {
        body = rawBody;
      }
      modelRequests.push({
        method: request.method,
        headers: request.headers,
        body
      });
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(JSON.stringify({
        choices: [
          {
            message: {
              content: [
                "## 一句话结论",
                "",
                "**MOCK SUMMARY CUSTOM PROMPT OK**",
                "",
                "---",
                "",
                "## 关键观点",
                "- Markdown 粗体应该被渲染",
                "- 摘要块应该在解析按钮下方",
                "",
                "1. 支持有序列表"
              ].join("\n")
            }
          }
        ]
      }));
      return;
    }

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
        transcriptLength: shadow.querySelector("#vcs-preview")?.textContent?.trim().length || 0
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

  if (!skipExtendedOptionsChecks) {
  await evaluate(optionsPage, `
    return chrome.storage.local.remove(["vcsSettings", "vcsHistory"]);
  `);
  await optionsPage.send("Page.reload", { ignoreCache: true });
  await waitForPageReady(optionsPage);

  await waitForExpression(optionsPage, `
    document.querySelector("#language")?.value?.trim().length > 0
  `, 5000);
  const optionsState = await evaluate(optionsPage, `
    return chrome.storage.local.get("vcsSettings").then((result) => ({
      language: document.querySelector("#language")?.value || "",
      uiLanguage: document.querySelector("#uiLanguage")?.value || "",
      uiLanguageOptions: [...document.querySelectorAll("#uiLanguage option")].map((option) => option.value),
      appearanceHeading: document.querySelector("#appearance h2")?.textContent || "",
      saveHistory: document.querySelector("#saveHistory")?.checked || false,
      themeMode: document.documentElement.dataset.themeMode || "",
      theme: document.documentElement.dataset.theme || "",
      activeProfileExists: Boolean(document.querySelector("#activeProfile")),
      settingsProfileCount: result.vcsSettings?.profiles?.length || 0,
      profileName: document.querySelector("#profileName")?.value || "",
      model: document.querySelector("#model")?.value || "",
      temperature: document.querySelector("#temperature")?.value || ""
    }));
  `);
  if (optionsState.language !== "中文（简体）") {
    throw new Error(`Expected default summary language, got: ${optionsState.language}`);
  }
  if (
    optionsState.uiLanguage !== "zh-CN" ||
    !optionsState.uiLanguageOptions.includes("en") ||
    optionsState.appearanceHeading !== "外观"
  ) {
    throw new Error(`Expected default Chinese UI with an English option: ${JSON.stringify(optionsState)}`);
  }
  if (!optionsState.saveHistory) {
    throw new Error("Summary history should be enabled by default after settings migration.");
  }
  if (optionsState.activeProfileExists) {
    throw new Error(`API profile selector should be removed: ${JSON.stringify(optionsState)}`);
  }
  if (!optionsState.settingsProfileCount || !optionsState.profileName || optionsState.model || optionsState.temperature !== "1") {
    throw new Error(`API defaults should expose an editable name, blank model, and temperature 1: ${JSON.stringify(optionsState)}`);
  }

  await evaluate(optionsPage, `
    document.querySelector("#uiLanguage").value = "en";
    document.querySelector("#uiLanguage").dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  `);
  await waitForExpression(optionsPage, `
    document.documentElement.lang === "en" &&
      document.querySelector("#appearance h2")?.textContent === "Appearance" &&
      document.querySelector("#saveStatus")?.textContent.includes("Interface language saved")
  `, 5000);
  const englishUiState = await evaluate(optionsPage, `
    return chrome.storage.local.get("vcsSettings").then((result) => ({
      storedUiLanguage: result.vcsSettings?.uiLanguage || "",
      summaryLanguageLabel: document.querySelector("#language")?.closest(".field")?.querySelector("span")?.textContent || "",
      saveButton: document.querySelector("#saveAll")?.textContent || ""
    }));
  `);
  if (
    englishUiState.storedUiLanguage !== "en" ||
    englishUiState.summaryLanguageLabel !== "Summary Output Language" ||
    englishUiState.saveButton !== "Save Settings"
  ) {
    throw new Error(`English UI option should translate and persist: ${JSON.stringify(englishUiState)}`);
  }
  await evaluate(optionsPage, `
    document.querySelector("#uiLanguage").value = "zh-CN";
    document.querySelector("#uiLanguage").dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  `);
  await waitForExpression(optionsPage, `
    document.documentElement.lang === "zh-CN" &&
      document.querySelector("#appearance h2")?.textContent === "外观" &&
      document.querySelector("#saveStatus")?.textContent.includes("界面语言已保存")
  `, 5000);

  const presetState = await evaluate(optionsPage, `
    document.querySelector("#profileName").value = "自定义配置";
    document.querySelector("#model").value = "custom-model";
    document.querySelector("#temperature").value = "0.7";
    document.querySelector("[data-preset='kimi']").click();
    return {
      profileName: document.querySelector("#profileName").value,
      model: document.querySelector("#model").value,
      temperature: document.querySelector("#temperature").value,
      provider: document.querySelector("#provider").value,
      endpoint: document.querySelector("#endpoint").value
    };
  `);
  if (
    presetState.profileName !== "自定义配置" ||
    presetState.model !== "custom-model" ||
    presetState.temperature !== "0.7" ||
    !presetState.endpoint.includes("moonshot")
  ) {
    throw new Error(`Preset buttons should only update provider and endpoint: ${JSON.stringify(presetState)}`);
  }

  await evaluate(optionsPage, `
    document.querySelector("input[name='theme'][value='dark']").click();
    return true;
  `);
  await waitForExpression(optionsPage, `
    document.documentElement.dataset.themeMode === "dark" && document.documentElement.dataset.theme === "dark"
  `, 5000);

  await evaluate(optionsPage, `
    return chrome.storage.local.set({
      vcsHistory: Array.from({ length: 35 }, (_, index) => ({
        id: "history-" + index,
        title: "History Video " + index,
        platform: "Fixture",
        model: "test-model",
        summary: "Summary item " + index,
        createdAt: new Date(Date.now() - index * 1000).toISOString()
      }))
    });
  `);
  await waitForExpression(optionsPage, `
    document.querySelector("#historyCount")?.textContent?.trim() === "30 / 30"
  `, 5000);
  const historyState = await evaluate(optionsPage, `
    return chrome.storage.local.get("vcsHistory").then((result) => ({
      count: document.querySelector("#historyCount")?.textContent?.trim() || "",
      items: document.querySelectorAll(".history-item").length,
      storedLength: result.vcsHistory?.length || 0
    }));
  `);
  if (historyState.items !== 30 || historyState.storedLength !== 30) {
    throw new Error(`History should render and persist at 30 items: ${JSON.stringify(historyState)}`);
  }

  await evaluate(optionsPage, `
    window.__vcsExportDownload = null;
    HTMLAnchorElement.prototype.click = function () {
      window.__vcsExportDownload = {
        download: this.download,
        href: this.href
      };
    };
    document.querySelector("#exportSettings").click();
    return true;
  `);
  await waitForExpression(optionsPage, `
    Boolean(window.__vcsExportDownload?.download)
  `, 5000);
  const exportState = await evaluate(optionsPage, `
    return window.__vcsExportDownload;
  `);
  if (!exportState.download.includes("video-caption-ai-settings") || !exportState.download.endsWith(".json")) {
    throw new Error(`Settings export should create a JSON download: ${JSON.stringify(exportState)}`);
  }
  }

  await capture(optionsPage, join(outputDir, "options-page.png"));
  const resetState = await assertResetRequiresSave(optionsPage, `${baseUrl}/mock-chat`);
  const promptRequestState = await assertPromptTemplateReachesModel({
    optionsPage,
    videoPage,
    modelRequests,
    mockEndpoint: `${baseUrl}/mock-chat`,
    waitTimeout
  });

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
    resetState,
    promptRequestState,
    screenshots: [
      "output/playwright/video-panel-collapsed.png",
      "output/playwright/video-panel.png",
      "output/playwright/video-panel-summary.png",
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

async function assertResetRequiresSave(optionsPage, mockEndpoint) {
  await setExtensionSettings(optionsPage, mockSettings({
    endpoint: mockEndpoint,
    promptTemplate: "RESET_GUARD_PROMPT {{transcript}}\n{{outputTemplate}}",
    outputTemplate: "RESET_GUARD_OUTPUT"
  }));
  await optionsPage.send("Page.reload", { ignoreCache: true });
  await waitForPageReady(optionsPage);
  await waitForExpression(optionsPage, `
    document.querySelector("#promptTemplate")?.value.includes("RESET_GUARD_PROMPT")
  `, 5000);
  await delay(300);

  await evaluate(optionsPage, `
    document.querySelector("#resetSettings").click();
    return true;
  `);
  await waitForExpression(optionsPage, `
    document.querySelector("#promptTemplate")?.value.includes("你是一个擅长处理视频字幕")
  `, 5000);

  const state = await evaluate(optionsPage, `
    return new Promise((resolve) => {
      chrome.storage.local.get("vcsSettings", (result) => {
        resolve({
          persistedPrompt: result.vcsSettings?.promptTemplate || "",
          formPrompt: document.querySelector("#promptTemplate")?.value || "",
          status: document.querySelector("#saveStatus")?.textContent || ""
        });
      });
    });
  `);

  if (!state.persistedPrompt.includes("RESET_GUARD_PROMPT")) {
    throw new Error("Reset should not persist defaults until Save Settings is clicked.");
  }
  if (state.formPrompt.includes("RESET_GUARD_PROMPT")) {
    throw new Error("Reset should update the form to the default prompt.");
  }
  if (!state.status.includes("保存设置")) {
    throw new Error(`Reset status should explain that saving is required, got: ${state.status}`);
  }

  return {
    persistedPromptStillCustom: state.persistedPrompt.includes("RESET_GUARD_PROMPT"),
    formResetToDefault: state.formPrompt.includes("你是一个擅长处理视频字幕")
  };
}

async function assertPromptTemplateReachesModel({
  optionsPage,
  videoPage,
  modelRequests,
  mockEndpoint,
  waitTimeout
}) {
  modelRequests.length = 0;
  const promptTemplate = [
    "PROMPT_EFFECT_MARKER",
    "标题={{title}}",
    "平台={{platform}}",
    "链接={{url}}",
    "语言={{language}}",
    "字幕={{transcript}}",
    "模板={{outputTemplate}}"
  ].join("\n");
  const outputTemplate = "OUTPUT_EFFECT_MARKER";

  await setExtensionSettings(optionsPage, mockSettings({
    endpoint: mockEndpoint,
    promptTemplate: "PROMPT_SEED {{transcript}}\n{{outputTemplate}}",
    outputTemplate: "OUTPUT_SEED"
  }));
  await optionsPage.send("Page.reload", { ignoreCache: true });
  await waitForPageReady(optionsPage);
  await waitForExpression(optionsPage, `
    document.querySelector("#endpoint")?.value === ${JSON.stringify(mockEndpoint)}
  `, 5000);
  await delay(300);
  await evaluate(optionsPage, `
    document.querySelector("#promptTemplate").value = ${JSON.stringify(promptTemplate)};
    document.querySelector("#outputTemplate").value = ${JSON.stringify(outputTemplate)};
    document.querySelector("#saveAll").click();
    return true;
  `);
  await waitForExpression(optionsPage, `
    document.querySelector("#saveStatus")?.textContent.includes("设置已保存")
  `, 5000);

  const savedPromptState = await evaluate(optionsPage, `
    return new Promise((resolve) => {
      chrome.storage.local.get("vcsSettings", (result) => {
        resolve({
          promptTemplate: result.vcsSettings?.promptTemplate || "",
          outputTemplate: result.vcsSettings?.outputTemplate || ""
        });
      });
    });
  `);
  if (!savedPromptState.promptTemplate.includes("PROMPT_EFFECT_MARKER")) {
    throw new Error("Prompt edited through the options page was not saved.");
  }
  if (!savedPromptState.outputTemplate.includes("OUTPUT_EFFECT_MARKER")) {
    throw new Error("Output template edited through the options page was not saved.");
  }

  await waitForExpression(videoPage, `
    !document.querySelector("#vcs-root")?.shadowRoot?.querySelector("#vcs-refresh")?.classList.contains("is-spinning")
  `, waitTimeout);
  await evaluate(videoPage, `
    document.querySelector("#vcs-root").shadowRoot.querySelector("#vcs-summarize").click();
    return true;
  `, { userGesture: true });

  await waitForExpression(videoPage, `
    (() => {
      const shadow = document.querySelector("#vcs-root")?.shadowRoot;
      const status = shadow?.querySelector("#vcs-status")?.textContent || "";
      const summary = shadow?.querySelector("#vcs-summary")?.textContent || "";
      const completed = status.includes("完成：") || status.includes("Done:");
      return completed && summary.includes("MOCK SUMMARY CUSTOM PROMPT OK");
    })()
  `, waitTimeout);

  if (modelRequests.length !== 1) {
    throw new Error(`Expected exactly one model request, got ${modelRequests.length}.`);
  }

  const request = modelRequests[0];
  const messages = Array.isArray(request.body?.messages) ? request.body.messages : [];
  const requestText = JSON.stringify(request.body);
  const requiredMarkers = [
    "PROMPT_EFFECT_MARKER",
    "OUTPUT_EFFECT_MARKER",
    "Modern AI Video Demo",
    "Generic Video"
  ];

  for (const marker of requiredMarkers) {
    if (!requestText.includes(marker)) {
      throw new Error(`Model request did not include expected prompt marker: ${marker}`);
    }
  }

  const userMessage = messages.find((message) => message.role === "user")?.content || "";
  if (!userMessage.includes("PROMPT_EFFECT_MARKER") || !userMessage.includes("OUTPUT_EFFECT_MARKER")) {
    throw new Error("Custom prompt and output template should both be rendered into the user message.");
  }

  const summaryLayoutState = await evaluate(videoPage, `
    const shadow = document.querySelector("#vcs-root")?.shadowRoot;
    const summarizeButton = shadow?.querySelector("#vcs-summarize");
    const result = shadow?.querySelector(".vcs-result");
    const trackRow = shadow?.querySelector(".vcs-track-row");
    const shell = shadow?.querySelector(".vcs-summary-shell");
    const shellStyle = shell ? getComputedStyle(shell) : null;
    return {
      resultAfterButton: summarizeButton?.nextElementSibling === result,
      resultBeforeTrack: result?.nextElementSibling === trackRow,
      strongText: shadow?.querySelector("#vcs-summary strong")?.textContent || "",
      listItems: shadow?.querySelectorAll("#vcs-summary li").length || 0,
      hasSeparator: Boolean(shadow?.querySelector("#vcs-summary hr")),
      overflowY: shellStyle?.overflowY || "",
      maxHeight: shellStyle?.maxHeight || ""
    };
  `);
  if (
    !summaryLayoutState.resultAfterButton ||
    !summaryLayoutState.resultBeforeTrack ||
    !summaryLayoutState.strongText.includes("MOCK SUMMARY CUSTOM PROMPT OK") ||
    summaryLayoutState.listItems < 3 ||
    !summaryLayoutState.hasSeparator ||
    summaryLayoutState.overflowY !== "auto" ||
    summaryLayoutState.maxHeight === "none"
  ) {
    throw new Error(`Summary Markdown block should render below the parse button in a scrollable area: ${JSON.stringify(summaryLayoutState)}`);
  }

  await capture(videoPage, join(outputDir, "video-panel-summary.png"));

  return {
    requestCount: modelRequests.length,
    customPromptInUserMessage: userMessage.includes("PROMPT_EFFECT_MARKER"),
    outputTemplateInUserMessage: userMessage.includes("OUTPUT_EFFECT_MARKER"),
    markdownSummaryRendered: summaryLayoutState.strongText.includes("MOCK SUMMARY CUSTOM PROMPT OK")
  };
}

async function setExtensionSettings(cdp, settings) {
  const serialized = JSON.stringify(settings);
  return evaluate(cdp, `
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ vcsSettings: ${serialized} }, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(true);
      });
    });
  `);
}

function mockSettings({ endpoint, promptTemplate, outputTemplate }) {
  return {
    theme: "auto",
    uiLanguage: "zh-CN",
    language: "中文（简体）",
    panelEnabled: true,
    activeProfileId: "deepseek",
    profiles: [
      {
        id: "deepseek",
        name: "Mock API",
        provider: "openai-compatible",
        endpoint,
        apiKey: "test-key",
        model: "mock-model",
        temperature: 1,
        maxTokens: 1024
      }
    ],
    promptTemplate,
    outputTemplate,
    chunkSize: 12000,
    chunkOverlap: 600,
    includeTimestamps: true,
    includeTitleAndUrl: true,
    redactTerms: "",
    saveHistory: false
  };
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

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
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
