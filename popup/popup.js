const statusEl = document.querySelector("#status");
const platformEl = document.querySelector("#platform");
const tracksEl = document.querySelector("#tracks");
const DEFAULT_SETTINGS = {
  theme: "auto",
  language: "中文（简体）"
};

document.querySelector("#openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.querySelector("#togglePanel").addEventListener("click", async () => {
  const tab = await getActiveTab();
  const response = await sendToTab(tab.id, { type: "VCS_TOGGLE_PANEL" });
  setStatus(response?.ok ? "已切换面板状态" : response?.error || "当前页面不可用");
});

document.querySelector("#summarize").addEventListener("click", async () => {
  const tab = await getActiveTab();
  setStatus("已发送总结请求");
  const response = await sendToTab(tab.id, { type: "VCS_SUMMARIZE_NOW" });
  if (!response?.ok) {
    setStatus(response?.error || "请求失败，请打开视频页后重试");
  }
});

init();

async function init() {
  await initTheme();
  const tab = await getActiveTab();
  const response = await sendToTab(tab.id, { type: "VCS_GET_STATUS" });

  if (!response?.ok) {
    setStatus("请打开支持的视频页面");
    platformEl.textContent = "-";
    tracksEl.textContent = "-";
    return;
  }

  const payload = response.payload;
  setStatus(payload.title || "已连接页面面板");
  platformEl.textContent = payload.platform || "-";
  tracksEl.textContent = String(payload.tracks ?? "-");
}

async function initTheme() {
  const result = await chrome.storage.local.get("vcsSettings");
  applyTheme({
    ...DEFAULT_SETTINGS,
    ...(result.vcsSettings || {})
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.vcsSettings) {
      applyTheme({
        ...DEFAULT_SETTINGS,
        ...(changes.vcsSettings.newValue || {})
      });
    }
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (document.documentElement.dataset.themeMode === "auto") {
      applyTheme({ theme: "auto" });
    }
  });
}

function applyTheme(settings) {
  const mode = ["auto", "light", "dark"].includes(settings.theme) ? settings.theme : "auto";
  const resolved = mode === "auto"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : mode;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = resolved;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function setStatus(message) {
  statusEl.textContent = message;
}
