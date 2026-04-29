const statusEl = document.querySelector("#status");
const platformEl = document.querySelector("#platform");
const tracksEl = document.querySelector("#tracks");
let popupSettings = {
  theme: "auto",
  uiLanguage: "zh-CN",
  language: "中文（简体）"
};
const DEFAULT_SETTINGS = {
  theme: "auto",
  uiLanguage: "zh-CN",
  language: "中文（简体）"
};

function i18n() {
  return globalThis.VCS_I18N.create(popupSettings);
}

function t(key, variables) {
  return i18n().t(key, variables);
}

document.querySelector("#openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.querySelector("#togglePanel").addEventListener("click", async () => {
  const tab = await getActiveTab();
  const response = await sendToTab(tab.id, { type: "VCS_TOGGLE_PANEL" });
  setStatus(response?.ok ? t("popup.status.panelToggled") : response?.error || t("popup.status.currentPageUnavailable"));
});

document.querySelector("#summarize").addEventListener("click", async () => {
  const tab = await getActiveTab();
  setStatus(t("popup.status.summarySent"));
  const response = await sendToTab(tab.id, { type: "VCS_SUMMARIZE_NOW" });
  if (!response?.ok) {
    setStatus(response?.error || t("popup.status.summaryFailed"));
  }
});

init();

async function init() {
  await initTheme();
  const tab = await getActiveTab();
  const response = await sendToTab(tab.id, { type: "VCS_GET_STATUS" });

  if (!response?.ok) {
    setStatus(t("popup.status.openVideo"));
    platformEl.textContent = "-";
    tracksEl.textContent = "-";
    return;
  }

  const payload = response.payload;
  setStatus(payload.title || t("popup.status.connected"));
  platformEl.textContent = payload.platform || "-";
  tracksEl.textContent = String(payload.tracks ?? "-");
}

async function initTheme() {
  const result = await chrome.storage.local.get("vcsSettings");
  popupSettings = {
    ...DEFAULT_SETTINGS,
    ...(result.vcsSettings || {})
  };
  popupSettings.uiLanguage = globalThis.VCS_I18N.normalizeUiLanguage(popupSettings.uiLanguage);
  applyTheme(popupSettings);
  applyTranslations();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.vcsSettings) {
      popupSettings = {
        ...DEFAULT_SETTINGS,
        ...(changes.vcsSettings.newValue || {})
      };
      popupSettings.uiLanguage = globalThis.VCS_I18N.normalizeUiLanguage(popupSettings.uiLanguage);
      applyTheme(popupSettings);
      applyTranslations();
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

function applyTranslations() {
  const locale = i18n();
  document.documentElement.lang = locale.language === "en" ? "en" : "zh-CN";
  document.title = locale.t("popup.documentTitle");
  document.querySelector("h1").textContent = locale.t("popup.heading");
  document.querySelector(".info > div:nth-child(1) span").textContent = locale.t("popup.platform");
  document.querySelector(".info > div:nth-child(3) span").textContent = locale.t("popup.tracks");
  document.querySelector("#summarize").textContent = locale.t("popup.summarize");
  document.querySelector("#togglePanel").textContent = locale.t("popup.togglePanel");
  document.querySelector("#openOptions").textContent = locale.t("popup.settings");
  if (statusEl.textContent === "正在读取当前页面" || statusEl.textContent === "Reading current page") {
    setStatus(locale.t("popup.status.reading"));
  }
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
