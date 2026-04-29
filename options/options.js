const SETTINGS_KEY = "vcsSettings";
const HISTORY_KEY = "vcsHistory";
const HISTORY_LIMIT = 30;
const I18N = globalThis.VCS_I18N;

const OLD_DEFAULT_PROMPT_TEMPLATE = [
  "你是一个擅长处理视频字幕的中文研究助理。",
  "请根据下面的视频字幕生成高质量总结。",
  "",
  "标题：{{title}}",
  "平台：{{platform}}",
  "链接：{{url}}",
  "输出语言：{{language}}",
  "",
  "字幕：",
  "{{transcript}}"
].join("\n");

const OLD_DEFAULT_OUTPUT_TEMPLATE = [
  "请使用 Markdown 输出：",
  "## 一句话结论",
  "## 核心摘要",
  "## 关键观点",
  "- 每条观点尽量带上相关时间点",
  "## 章节时间线",
  "## 可执行事项 / 值得追问的问题"
].join("\n");

const DEFAULT_PROMPT_TEMPLATE = [
  "你是一位视频内容提炼专家。请基于字幕文本，生成一份精炼、高信息密度的结构化总结。",
  "",
  "## 视频信息",
  "📌 标题：{{title}}｜🌐 平台：{{platform}}｜🔗 链接：{{url}}",
  "",
  "## 核心原则",
  "- 总结 ≠ 复述。你的任务是**压缩与重构**，不是逐段改写",
  "- 保留硬信息（数据、人名、术语、方法论），砍掉软信息（过渡语、重复论证、情绪渲染）",
  "- 每句话必须承载独立信息量，删掉后会造成信息缺失才有资格留下",
  "- 仅基于字幕实际内容，不推测、不补充、不评价",
  "",
  "## 输出语言：{{language}}",
  "",
  "## 输出格式",
  "{{outputTemplate}}",
  "",
  "## 字幕正文",
  "{{transcript}}"
].join("\n");

const DEFAULT_OUTPUT_TEMPLATE = [
  "请使用 Markdown 输出：",
  "",
  "## 💡 一句话结论",
  "≤ 30字。视频最核心的一个判断或发现。",
  "",
  "## 📋 核心摘要",
  "3~4句话覆盖完整逻辑链：什么问题 → 什么观点/方案 → 什么结论。不用条目，写成连贯段落。",
  "",
  "## 🎯 关键观点",
  "3~7条，每条格式：",
  "- ⏱️ [时间戳] **关键词**：一句话说明（无时间戳则省略⏱️）",
  "",
  "只保留\"删掉就损失信息\"的观点，不凑数。",
  "",
  "## 🗂️ 章节时间线",
  "按叙事顺序分3~6段，每段格式：",
  "- ⏱️ [起止时间] **章节名**：一句话概括（无时间戳则用 1️⃣2️⃣3️⃣ 编号）"
].join("\n");

const DEFAULT_SETTINGS = {
  settingsVersion: 7,
  theme: "auto",
  uiLanguage: "zh-CN",
  language: "中文（简体）",
  panelEnabled: true,
  activeProfileId: "custom",
  profiles: [
    {
      ...profilePreset("deepseek"),
      id: "custom",
      name: "我的 API 配置"
    }
  ],
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  outputTemplate: DEFAULT_OUTPUT_TEMPLATE,
  chunkSize: 12000,
  chunkOverlap: 600,
  requestTimeoutSeconds: 60,
  includeTimestamps: true,
  includeTitleAndUrl: true,
  redactTerms: "",
  saveHistory: false
};

let settings = structuredClone(DEFAULT_SETTINGS);

const fields = {
  uiLanguage: document.querySelector("#uiLanguage"),
  language: document.querySelector("#language"),
  panelEnabled: document.querySelector("#panelEnabled"),
  profileName: document.querySelector("#profileName"),
  provider: document.querySelector("#provider"),
  endpoint: document.querySelector("#endpoint"),
  accessToken: document.querySelector("#accessToken"),
  model: document.querySelector("#model"),
  temperature: document.querySelector("#temperature"),
  maxTokens: document.querySelector("#maxTokens"),
  promptTemplate: document.querySelector("#promptTemplate"),
  outputTemplate: document.querySelector("#outputTemplate"),
  includeTimestamps: document.querySelector("#includeTimestamps"),
  saveHistory: document.querySelector("#saveHistory"),
  redactTerms: document.querySelector("#redactTerms"),
  chunkSize: document.querySelector("#chunkSize"),
  chunkOverlap: document.querySelector("#chunkOverlap"),
  requestTimeoutSeconds: document.querySelector("#requestTimeoutSeconds"),
  importText: document.querySelector("#importText"),
  importFile: document.querySelector("#importFile"),
  historyList: document.querySelector("#historyList"),
  historyCount: document.querySelector("#historyCount"),
  apiStatus: document.querySelector("#apiStatus"),
  saveStatus: document.querySelector("#saveStatus")
};

init();

function i18n() {
  return I18N.create(settings);
}

function t(key, variables) {
  return i18n().t(key, variables);
}

async function init() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  settings = normalizeSettings(result[SETTINGS_KEY]);
  if (JSON.stringify(result[SETTINGS_KEY] || {}) !== JSON.stringify(settings)) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  }
  hydrateForm();
  bindEvents();
  await renderHistory();
}

function bindEvents() {
  document.querySelector("#saveAll").addEventListener("click", () => saveAll());
  document.querySelector("#saveProfile").addEventListener("click", () => saveCurrentProfile());
  document.querySelector("#addProfile").addEventListener("click", addProfile);
  document.querySelector("#deleteProfile").addEventListener("click", deleteProfile);
  document.querySelector("#testProfile").addEventListener("click", testProfile);
  document.querySelector("#exportSettings").addEventListener("click", exportSettings);
  document.querySelector("#importSettings").addEventListener("click", importSettings);
  document.querySelector("#resetSettings").addEventListener("click", resetSettings);
  document.querySelector("#clearHistory").addEventListener("click", clearHistory);
  document.querySelector("#exportHistory").addEventListener("click", exportHistory);
  fields.importFile.addEventListener("change", importSettingsFile);

  document.querySelectorAll("input[name='theme']").forEach((input) => {
    input.addEventListener("change", async () => {
      settings.theme = input.value;
      applyTheme();
      await saveAll(t("options.status.themeSaved"));
    });
  });

  fields.uiLanguage.addEventListener("change", async () => {
    settings.uiLanguage = fields.uiLanguage.value;
    applyTranslations();
    await renderHistory();
    await saveAll(t("options.status.uiLanguageSaved"));
  });

  document.querySelectorAll(".preset").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });

  fields.provider.addEventListener("change", handleProviderChange);
  fields.historyList.addEventListener("click", copyHistoryFromList);
  initSectionNav();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") {
      return;
    }
    if (changes[HISTORY_KEY]) {
      renderHistory();
    }
    if (changes[SETTINGS_KEY] && changes[SETTINGS_KEY].newValue) {
      settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
      hydrateForm();
      renderHistory();
    }
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (settings.theme === "auto") {
      applyTheme();
    }
  });
}

function hydrateForm() {
  const themeInput = document.querySelector(`input[name='theme'][value='${settings.theme || "auto"}']`)
    || document.querySelector("input[name='theme'][value='auto']");
  if (themeInput) {
    themeInput.checked = true;
  }
  fields.uiLanguage.value = settings.uiLanguage || DEFAULT_SETTINGS.uiLanguage;
  fields.language.value = settings.language || DEFAULT_SETTINGS.language;
  fields.panelEnabled.checked = settings.panelEnabled !== false;
  fields.promptTemplate.value = settings.promptTemplate || "";
  fields.outputTemplate.value = settings.outputTemplate || "";
  fields.includeTimestamps.checked = settings.includeTimestamps !== false;
  fields.saveHistory.checked = settings.saveHistory !== false;
  fields.redactTerms.value = settings.redactTerms || "";
  fields.chunkSize.value = settings.chunkSize || 12000;
  fields.chunkOverlap.value = settings.chunkOverlap || 600;
  fields.requestTimeoutSeconds.value = settings.requestTimeoutSeconds || DEFAULT_SETTINGS.requestTimeoutSeconds;
  applyTheme();
  applyTranslations();
  renderProfileFields();
}

function renderProfileFields() {
  const profile = getActiveProfile();
  if (!profile) {
    return;
  }

  fields.profileName.value = profile.name || "";
  fields.provider.value = profile.provider || "proxy";
  fields.endpoint.value = profile.endpoint || "";
  fields.accessToken.value = getProfileSecret(profile);
  fields.model.value = profile.model || "";
  fields.temperature.value = profile.temperature ?? 1;
  fields.maxTokens.value = profile.maxTokens ?? 4096;
  updateProviderHints();
}

async function saveCurrentProfile() {
  const profile = getActiveProfile();
  if (!profile) {
    return;
  }

  profile.name = fields.profileName.value.trim() || profile.id;
  profile.provider = fields.provider.value;
  profile.endpoint = fields.endpoint.value.trim();
  setProfileSecret(profile, fields.accessToken.value.trim());
  profile.model = fields.model.value.trim();
  profile.temperature = Number(fields.temperature.value || 1);
  profile.maxTokens = Number(fields.maxTokens.value || 4096);
  await saveAll(t("options.status.profileSaved"));
}

async function saveAll(message = t("options.status.settingsSaved")) {
  if (typeof message !== "string") {
    message = t("options.status.settingsSaved");
  }
  settings.theme = document.querySelector("input[name='theme']:checked")?.value || "auto";
  settings.uiLanguage = I18N.normalizeUiLanguage(fields.uiLanguage.value);
  settings.language = fields.language.value.trim() || "中文（简体）";
  settings.panelEnabled = fields.panelEnabled.checked;
  settings.promptTemplate = fields.promptTemplate.value;
  settings.outputTemplate = fields.outputTemplate.value;
  settings.includeTimestamps = fields.includeTimestamps.checked;
  settings.saveHistory = fields.saveHistory.checked;
  settings.redactTerms = fields.redactTerms.value;
  settings.chunkSize = Number(fields.chunkSize.value || 12000);
  settings.chunkOverlap = Number(fields.chunkOverlap.value || 600);
  settings.requestTimeoutSeconds = Number(fields.requestTimeoutSeconds.value || DEFAULT_SETTINGS.requestTimeoutSeconds);
  saveCurrentProfileValuesOnly();
  settings = normalizeSettings(settings);
  if (!await ensureEndpointPermissions(settings.profiles)) {
    setStatus(fields.saveStatus, t("options.status.endpointPermissionDenied"), "error");
    return;
  }

  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  setStatus(fields.saveStatus, message, "ok");
}

function saveCurrentProfileValuesOnly() {
  const profile = getActiveProfile();
  if (!profile) {
    return;
  }

  profile.name = fields.profileName.value.trim() || profile.id;
  profile.provider = fields.provider.value;
  profile.endpoint = fields.endpoint.value.trim();
  setProfileSecret(profile, fields.accessToken.value.trim());
  profile.model = fields.model.value.trim();
  profile.temperature = Number(fields.temperature.value || 1);
  profile.maxTokens = Number(fields.maxTokens.value || 4096);
}

function addProfile() {
  const profile = {
    id: `custom-${Date.now()}`,
    name: settings.uiLanguage === "en" ? "New Profile" : "新配置",
    provider: "openai-compatible",
    endpoint: "",
    apiKey: "",
    accessToken: "",
    model: "",
    temperature: 1,
    maxTokens: 4096
  };
  settings.profiles.push(profile);
  settings.activeProfileId = profile.id;
  renderProfileFields();
}

function deleteProfile() {
  if (settings.profiles.length <= 1) {
    setStatus(fields.apiStatus, t("options.status.keepOneProfile"), "error");
    return;
  }

  const index = settings.profiles.findIndex((profile) => profile.id === settings.activeProfileId);
  if (index >= 0) {
    settings.profiles.splice(index, 1);
  }
  settings.activeProfileId = settings.profiles[0].id;
  renderProfileFields();
}

function applyPreset(name) {
  const preset = profilePreset(name);
  const profile = getActiveProfile();
  profile.provider = preset.provider;
  profile.endpoint = preset.endpoint;
  profile.apiKey = "";
  profile.accessToken = "";
  fields.provider.value = profile.provider;
  fields.endpoint.value = profile.endpoint;
  fields.accessToken.value = "";
  updateProviderHints();
  setStatus(fields.apiStatus, t("options.status.presetApplied"), "ok");
}

function handleProviderChange() {
  const preset = profilePreset(providerDefaultPresetName(fields.provider.value));
  fields.endpoint.value = preset.endpoint || "";
  fields.accessToken.value = "";
  updateProviderHints();
}

function providerDefaultPresetName(provider) {
  const names = {
    proxy: "proxy",
    "openai-compatible": "deepseek",
    anthropic: "claude",
    gemini: "gemini",
    ollama: "ollama"
  };
  return names[provider] || "deepseek";
}

function profilePreset(name) {
  const presets = {
    deepseek: {
      id: "deepseek",
      name: "DeepSeek",
      provider: "openai-compatible",
      endpoint: "https://api.deepseek.com/v1/chat/completions",
      apiKey: "",
      accessToken: "",
      model: "",
      temperature: 1,
      maxTokens: 4096
    },
    openai: {
      id: "openai",
      name: "OpenAI / ChatGPT",
      provider: "openai-compatible",
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: "",
      accessToken: "",
      model: "",
      temperature: 1,
      maxTokens: 4096
    },
    claude: {
      id: "claude",
      name: "Claude",
      provider: "anthropic",
      endpoint: "https://api.anthropic.com/v1/messages",
      apiKey: "",
      accessToken: "",
      model: "",
      temperature: 1,
      maxTokens: 4096
    },
    gemini: {
      id: "gemini",
      name: "Gemini",
      provider: "gemini",
      endpoint: "",
      apiKey: "",
      accessToken: "",
      model: "",
      temperature: 1,
      maxTokens: 4096
    },
    kimi: {
      id: "kimi",
      name: "Kimi (Moonshot)",
      provider: "openai-compatible",
      endpoint: "https://api.moonshot.ai/v1/chat/completions",
      apiKey: "",
      accessToken: "",
      model: "",
      temperature: 1,
      maxTokens: 4096
    },
    qwen: {
      id: "qwen",
      name: "通义千问",
      provider: "openai-compatible",
      endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      apiKey: "",
      accessToken: "",
      model: "",
      temperature: 1,
      maxTokens: 4096
    },
    glm: {
      id: "glm",
      name: "智谱 GLM",
      provider: "openai-compatible",
      endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      apiKey: "",
      accessToken: "",
      model: "",
      temperature: 1,
      maxTokens: 4096
    },
    proxy: {
      id: "proxy",
      name: "专用服务",
      provider: "proxy",
      endpoint: "",
      apiKey: "",
      accessToken: "",
      model: "",
      temperature: 1,
      maxTokens: 4096
    },
    ollama: {
      id: "ollama",
      name: "Ollama Local",
      provider: "ollama",
      endpoint: "http://localhost:11434/v1/chat/completions",
      apiKey: "",
      accessToken: "",
      model: "",
      temperature: 1,
      maxTokens: 4096
    }
  };

  return structuredClone(presets[name] || presets.deepseek);
}

async function testProfile() {
  saveCurrentProfileValuesOnly();
  settings = normalizeSettings(settings);
  if (!await ensureEndpointPermissions([getActiveProfile()])) {
    setStatus(fields.apiStatus, t("options.status.endpointPermissionDenied"), "error");
    return;
  }
  setStatus(fields.apiStatus, t("options.status.testing"), "");

  const response = await chrome.runtime.sendMessage({
    type: "VCS_TEST_API",
    profile: getActiveProfile(),
    stream: true
  });

  if (response?.ok) {
    setStatus(fields.apiStatus, t("options.status.connectionSuccess", { text: response.payload.text }), "ok");
  } else {
    setStatus(fields.apiStatus, response?.error || t("options.status.connectionFailed"), "error");
  }
}

async function exportSettings() {
  await saveAll(t("options.status.savedForExport"));
  const payload = {
    type: "video-caption-ai-settings",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: sanitizeSettingsForExport(settings)
  };
  const json = JSON.stringify(payload, null, 2);
  downloadJson(json, `video-caption-ai-settings-${formatDateForFilename(new Date())}.json`);
  const copied = await writeClipboard(json);
  setStatus(fields.saveStatus, copied ? t("options.status.settingsExportedCopied") : t("options.status.settingsExported"), "ok");
}

async function importSettings() {
  try {
    const imported = parseImportedSettings(fields.importText.value);
    settings = normalizeSettings(imported);
    hydrateForm();
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    setStatus(fields.saveStatus, t("options.status.settingsImported"), "ok");
  } catch (error) {
    setStatus(fields.saveStatus, t("options.status.importFailed", { message: error.message }), "error");
  }
}

async function resetSettings() {
  settings = structuredClone(DEFAULT_SETTINGS);
  hydrateForm();
  setStatus(fields.saveStatus, t("options.status.resetRequiresSave"), "ok");
}

async function importSettingsFile() {
  const file = fields.importFile.files?.[0];
  if (!file) {
    return;
  }

  try {
    fields.importText.value = await file.text();
    await importSettings();
  } finally {
    fields.importFile.value = "";
  }
}

async function renderHistory() {
  const result = await chrome.storage.local.get(HISTORY_KEY);
  const history = normalizeHistory(result[HISTORY_KEY]);
  setDigits(fields.historyCount, `${history.length} / ${HISTORY_LIMIT}`);

  if (!history.length) {
    fields.historyList.innerHTML = `<div class="history-empty">${escapeHtml(t("options.history.empty"))}</div>`;
    return;
  }

  fields.historyList.innerHTML = history.map((item, index) => {
    const summary = item.summary || item.text || "";
    const title = item.title || t("options.history.untitled");
    const createdAt = formatDate(item.createdAt);
    const meta = [item.platform, item.model, createdAt].filter(Boolean).join(" · ");
    return `
      <article class="history-item">
        <div class="history-item__head">
          <div>
            <div class="history-item__title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
            <div class="history-item__meta">${escapeHtml(meta || t("options.history.local"))}</div>
          </div>
          <button class="button button--ghost history-copy" type="button" data-history-index="${index}">${escapeHtml(t("options.history.copy"))}</button>
        </div>
        <div class="history-item__summary">${escapeHtml(summary || t("options.history.noSummary"))}</div>
      </article>
    `;
  }).join("");

  if (result[HISTORY_KEY]?.length > HISTORY_LIMIT) {
    await chrome.storage.local.set({ [HISTORY_KEY]: history });
  }
}

async function copyHistoryFromList(event) {
  const button = event.target.closest("[data-history-index]");
  if (!button) {
    return;
  }

  const result = await chrome.storage.local.get(HISTORY_KEY);
  const history = normalizeHistory(result[HISTORY_KEY]);
  const item = history[Number(button.dataset.historyIndex)];
  const text = item?.summary || item?.text || "";
  if (!text.trim()) {
    setStatus(fields.saveStatus, t("options.status.noCopyableHistory"), "error");
    return;
  }

  const copied = await writeClipboard(text);
  setStatus(fields.saveStatus, copied ? t("options.status.historyCopied") : t("options.status.clipboardDenied"), copied ? "ok" : "error");
}

async function clearHistory() {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
  await renderHistory();
  setStatus(fields.saveStatus, t("options.status.historyCleared"), "ok");
}

async function exportHistory() {
  const result = await chrome.storage.local.get(HISTORY_KEY);
  const history = normalizeHistory(result[HISTORY_KEY]);
  const payload = {
    type: "video-caption-ai-history",
    version: 1,
    exportedAt: new Date().toISOString(),
    limit: HISTORY_LIMIT,
    history
  };
  const json = JSON.stringify(payload, null, 2);
  downloadJson(json, `video-caption-ai-history-${formatDateForFilename(new Date())}.json`);
  setStatus(fields.saveStatus, history.length ? t("options.status.historyExported") : t("options.status.emptyHistoryExported"), "ok");
}

function parseImportedSettings(text) {
  if (!text.trim()) {
    throw new Error(t("options.error.emptyImport"));
  }

  const parsed = JSON.parse(text);
  const imported = parsed?.settings || parsed;
  if (!imported || typeof imported !== "object" || Array.isArray(imported)) {
    throw new Error(t("options.error.invalidSettings"));
  }
  return imported;
}

function sanitizeSettingsForExport(value) {
  const output = structuredClone(value || {});
  output.profiles = (Array.isArray(output.profiles) ? output.profiles : []).map((profile) => {
    const cleanProfile = { ...profile };
    delete cleanProfile.apiKey;
    cleanProfile.accessToken = "";
    return cleanProfile;
  });
  return output;
}

function getProfileSecret(profile) {
  if (!profile || profile.provider === "ollama") {
    return "";
  }
  return profile.provider === "proxy"
    ? profile.accessToken || ""
    : profile.apiKey || "";
}

function setProfileSecret(profile, value) {
  if (!profile) {
    return;
  }
  if (profile.provider === "proxy") {
    profile.accessToken = value;
    profile.apiKey = "";
    return;
  }
  if (profile.provider === "ollama") {
    profile.accessToken = "";
    profile.apiKey = "";
    return;
  }
  profile.apiKey = value;
  profile.accessToken = "";
}

async function ensureEndpointPermissions(profiles) {
  const origins = uniqueValues((profiles || [])
    .map(endpointPermissionPattern)
    .filter(Boolean));

  for (const origin of origins) {
    const hasPermission = await chrome.permissions.contains({ origins: [origin] });
    if (hasPermission) {
      continue;
    }
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) {
      return false;
    }
  }

  return true;
}

function endpointPermissionPattern(profile) {
  const url = parseUrl(getProfileEndpoint(profile));
  if (!url) {
    return "";
  }
  if (url.protocol === "https:") {
    return `https://${url.hostname}/*`;
  }
  if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) {
    return `http://${url.hostname}/*`;
  }
  return "";
}

function updateProviderHints() {
  const locale = i18n();
  const provider = fields.provider.value;
  const isOllama = provider === "ollama";
  const isProxy = provider === "proxy";
  const isGemini = provider === "gemini";
  setFieldLabel(fields.endpoint, getEndpointLabel(provider, locale));
  fields.endpoint.placeholder = getEndpointPlaceholder(provider);
  setFieldLabel(fields.accessToken, isProxy ? locale.t("options.api.accessToken") : locale.t("options.api.apiKey"));
  fields.accessToken.placeholder = getSecretPlaceholder(provider, locale);
  fields.accessToken.disabled = isOllama;
  fields.endpoint.disabled = isGemini;
  fields.model.placeholder = isProxy ? locale.t("options.api.modelPlaceholder") : locale.t("options.api.directModelPlaceholder");
}

function getEndpointLabel(provider, locale) {
  if (provider === "ollama") {
    return locale.t("options.api.ollamaEndpoint");
  }
  if (provider === "proxy") {
    return locale.t("options.api.endpoint");
  }
  return locale.t("options.api.directEndpoint");
}

function getEndpointPlaceholder(provider) {
  const placeholders = {
    proxy: "https://your-domain.example.com/v1/chat/completions",
    "openai-compatible": "https://api.deepseek.com/v1/chat/completions",
    anthropic: "https://api.anthropic.com/v1/messages",
    gemini: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    ollama: "http://localhost:11434/v1/chat/completions"
  };
  return placeholders[provider] || placeholders["openai-compatible"];
}

function getSecretPlaceholder(provider, locale) {
  if (provider === "ollama") {
    return "";
  }
  if (provider === "proxy") {
    return locale.language === "en" ? "Optional access token" : "可选访问口令";
  }
  return "sk-...";
}

function getProfileEndpoint(profile) {
  if (!profile) {
    return "";
  }
  if (profile.provider === "gemini" && !profile.endpoint) {
    const model = profile.model || "gemini-pro";
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  }
  return profile.endpoint || "";
}

function parseUrl(value) {
  try {
    return value ? new URL(value) : null;
  } catch (_error) {
    return null;
  }
}

function normalizeHostname(hostname) {
  return String(hostname || "")
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .toLowerCase();
}

function isLoopbackHostname(hostname) {
  const host = normalizeHostname(hostname);
  return host === "localhost"
    || host.endsWith(".localhost")
    || host === "::1"
    || host === "0:0:0:0:0:0:0:1"
    || host.startsWith("127.");
}

function isLoopbackEndpoint(endpoint) {
  const url = parseUrl(endpoint);
  return Boolean(url && url.protocol === "http:" && isLoopbackHostname(url.hostname));
}

function uniqueValues(values) {
  return [...new Set(values)];
}

function normalizeSettings(input) {
  const normalized = deepMerge(DEFAULT_SETTINGS, input || {});
  const importedVersion = Number(input?.settingsVersion || 0);
  normalized.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
  normalized.theme = ["auto", "light", "dark"].includes(normalized.theme) ? normalized.theme : DEFAULT_SETTINGS.theme;
  normalized.uiLanguage = I18N.normalizeUiLanguage(normalized.uiLanguage);
  normalized.language = String(normalized.language || "").trim() || DEFAULT_SETTINGS.language;
  normalized.panelEnabled = normalized.panelEnabled !== false;
  normalized.includeTimestamps = normalized.includeTimestamps !== false;
  normalized.includeTitleAndUrl = normalized.includeTitleAndUrl !== false;
  normalized.saveHistory = normalized.saveHistory === true;
  normalized.promptTemplate = String(normalized.promptTemplate || DEFAULT_SETTINGS.promptTemplate);
  normalized.outputTemplate = String(normalized.outputTemplate || DEFAULT_SETTINGS.outputTemplate);
  if (String(input?.promptTemplate || "") === OLD_DEFAULT_PROMPT_TEMPLATE) {
    normalized.promptTemplate = DEFAULT_SETTINGS.promptTemplate;
  }
  if (String(input?.outputTemplate || "") === OLD_DEFAULT_OUTPUT_TEMPLATE) {
    normalized.outputTemplate = DEFAULT_SETTINGS.outputTemplate;
  }
  normalized.redactTerms = String(normalized.redactTerms || "");
  normalized.chunkSize = clampNumber(normalized.chunkSize, 12000, 2000, 50000);
  normalized.chunkOverlap = clampNumber(normalized.chunkOverlap, 600, 0, 5000);
  normalized.requestTimeoutSeconds = clampNumber(
    normalized.requestTimeoutSeconds,
    DEFAULT_SETTINGS.requestTimeoutSeconds,
    30,
    600
  );

  if (!Array.isArray(normalized.profiles) || !normalized.profiles.length) {
    normalized.profiles = structuredClone(DEFAULT_SETTINGS.profiles);
  }
  normalized.profiles = normalized.profiles.map((profile, index) => normalizeProfile(profile, index, importedVersion));
  if (!normalized.profiles.some((profile) => profile.id === normalized.activeProfileId)) {
    normalized.activeProfileId = normalized.profiles[0].id;
  }
  return normalized;
}

function normalizeProfile(profile, index, importedVersion) {
  const source = profile || {};
  const rawProvider = String(source.provider || "openai-compatible");
  const isLocalOpenAI = rawProvider === "ollama"
    || (rawProvider === "openai-compatible" && isLoopbackEndpoint(source.endpoint));
  const supportedProviders = ["proxy", "openai-compatible", "anthropic", "gemini", "ollama"];
  const provider = isLocalOpenAI
    ? "ollama"
    : (supportedProviders.includes(rawProvider) ? rawProvider : "openai-compatible");
  const fallback = profilePreset(provider === "openai-compatible" ? "deepseek" : provider);
  const temperature = importedVersion < 3 && Number(source.temperature) === 0.2
    ? 1
    : source.temperature;
  return {
    ...fallback,
    id: String(source.id || fallback.id || `profile-${index + 1}`),
    name: String(source.name || fallback.name || `Profile ${index + 1}`),
    provider,
    endpoint: String(source.endpoint || fallback.endpoint || ""),
    apiKey: String(source.apiKey || (!["proxy", "ollama"].includes(provider) ? source.accessToken || "" : "")),
    accessToken: String(provider === "proxy" ? source.accessToken || "" : ""),
    model: String(source.model || fallback.model || ""),
    temperature: clampNumber(temperature, fallback.temperature ?? 1, 0, 2),
    maxTokens: clampNumber(source.maxTokens, fallback.maxTokens, 256, 32000)
  };
}

function normalizeHistory(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object")
    .slice(0, HISTORY_LIMIT);
}

function applyTranslations() {
  const locale = i18n();
  document.documentElement.lang = locale.language === "en" ? "en" : "zh-CN";
  document.title = locale.t("options.documentTitle");

  setText(".topbar h1", locale.t("common.appName"));
  setText(".topbar p", locale.t("options.brandTagline"));
  setText("#exportSettings", locale.t("options.exportSettings"));
  setText("#saveAll", locale.t("options.saveAll"));

  setText(".sidebar a[href='#appearance']", locale.t("options.nav.appearance"));
  setText(".sidebar a[href='#api']", locale.t("options.nav.api"));
  setText(".sidebar a[href='#prompt']", locale.t("options.nav.prompt"));
  setText(".sidebar a[href='#platforms']", locale.t("options.nav.platforms"));
  setText(".sidebar a[href='#history']", locale.t("options.nav.history"));
  setText(".sidebar a[href='#advanced']", locale.t("options.nav.advanced"));

  setText("#appearance .section__head h2", locale.t("options.nav.appearance"));
  setText("#appearance .section__head p", locale.t("options.appearance.description"));
  setText("#appearance > .field > label", locale.t("options.appearance.theme"));
  document.querySelector("#appearance .segmented")?.setAttribute("aria-label", locale.t("options.appearance.theme"));
  setRadioLabel("auto", locale.t("options.appearance.theme.auto"));
  setRadioLabel("light", locale.t("options.appearance.theme.light"));
  setRadioLabel("dark", locale.t("options.appearance.theme.dark"));
  setFieldLabel(fields.uiLanguage, locale.t("options.appearance.uiLanguage"));
  setOptionText(fields.uiLanguage, "zh-CN", locale.t("ui.zh-CN"));
  setOptionText(fields.uiLanguage, "en", locale.t("ui.en"));
  setFieldLabel(fields.language, locale.t("options.appearance.summaryLanguage"));
  fields.language.placeholder = locale.t("options.appearance.summaryLanguagePlaceholder");
  setFieldLabel(fields.panelEnabled, locale.t("options.appearance.panelEnabled"));

  setText("#api .section__head h2", locale.t("options.nav.api"));
  setText("#api .section__head p", locale.t("options.api.description"));
  setText("#addProfile", locale.t("options.api.add"));
  setText("#deleteProfile", locale.t("options.api.delete"));
  setFieldLabel(fields.profileName, locale.t("options.api.profileName"));
  fields.profileName.placeholder = locale.t("options.api.profileNamePlaceholder");
  setFieldLabel(fields.provider, locale.t("options.api.provider"));
  setOptionText(fields.provider, "proxy", locale.t("options.api.provider.proxy"));
  setOptionText(fields.provider, "openai-compatible", locale.t("options.api.provider.openai"));
  setOptionText(fields.provider, "anthropic", locale.t("options.api.provider.anthropic"));
  setOptionText(fields.provider, "gemini", locale.t("options.api.provider.gemini"));
  setOptionText(fields.provider, "ollama", locale.t("options.api.provider.ollama"));
  setFieldLabel(fields.endpoint, locale.t("options.api.endpoint"));
  setFieldLabel(fields.accessToken, locale.t("options.api.accessToken"));
  setFieldLabel(fields.model, locale.t("options.api.model"));
  fields.model.placeholder = locale.t("options.api.modelPlaceholder");
  setFieldLabel(fields.temperature, locale.t("options.api.temperature"));
  setFieldLabel(fields.maxTokens, locale.t("options.api.maxTokens"));
  setText("#saveProfile", locale.t("options.api.saveProfile"));
  setText("#testProfile", locale.t("options.api.testProfile"));
  updateProviderHints();

  setText("#prompt .section__head h2", locale.t("options.nav.prompt"));
  setText("#prompt .section__head p", locale.t("options.prompt.description"));
  setFieldLabel(fields.promptTemplate, locale.t("options.prompt.promptTemplate"));
  setFieldLabel(fields.outputTemplate, locale.t("options.prompt.outputTemplate"));

  setText("#platforms .section__head h2", locale.t("options.nav.platforms"));
  setText("#platforms .section__head p", locale.t("options.platforms.description"));
  setText("#platforms .support-list > div:nth-child(1) span", locale.t("options.platforms.youtube"));
  setText("#platforms .support-list > div:nth-child(2) span", locale.t("options.platforms.bilibili"));
  setText("#platforms .support-list > div:nth-child(3) span", locale.t("options.platforms.html5"));
  setText("#platforms .support-list > div:nth-child(4) span", locale.t("options.platforms.transcript"));
  setFieldLabel(fields.includeTimestamps, locale.t("options.platforms.includeTimestamps"));
  setFieldLabel(fields.redactTerms, locale.t("options.platforms.redactTerms"));
  fields.redactTerms.placeholder = locale.t("options.platforms.redactTermsPlaceholder");

  setText("#history .section__head h2", locale.t("options.nav.history"));
  setText("#history .section__head p", locale.t("options.history.description"));
  setText("#exportHistory", locale.t("options.history.export"));
  setText("#clearHistory", locale.t("options.history.clear"));
  setFieldLabel(fields.saveHistory, locale.t("options.history.saveHistory"));

  setText("#advanced .section__head h2", locale.t("options.nav.advanced"));
  setText("#advanced .section__head p", locale.t("options.advanced.description"));
  setFieldLabel(fields.chunkSize, locale.t("options.advanced.chunkSize"));
  setFieldLabel(fields.chunkOverlap, locale.t("options.advanced.chunkOverlap"));
  setFieldLabel(fields.requestTimeoutSeconds, locale.t("options.advanced.requestTimeoutSeconds"));
  setFieldLabel(fields.importText, locale.t("options.advanced.importJson"));
  fields.importText.placeholder = locale.t("options.advanced.importJsonPlaceholder");
  setFieldLabel(fields.importFile, locale.t("options.advanced.importFile"));
  setText("#importSettings", locale.t("options.advanced.importSettings"));
  setText("#resetSettings", locale.t("options.advanced.resetSettings"));
}

function applyTheme() {
  const mode = settings.theme || "auto";
  const resolved = mode === "auto"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : mode;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = resolved;
}

function downloadJson(json, filename) {
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_error) {
    return false;
  }
}

function formatDateForFilename(date) {
  return date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function formatDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString(i18n().locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function getActiveProfile() {
  return settings.profiles.find((profile) => profile.id === settings.activeProfileId) || settings.profiles[0];
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) {
    element.textContent = value;
  }
}

function setFieldLabel(field, value) {
  const label = field?.closest(".field")?.querySelector("span");
  if (label) {
    label.textContent = value;
  }
}

function setRadioLabel(value, text) {
  const input = document.querySelector(`input[name='theme'][value='${value}']`);
  const label = input?.closest("label");
  if (!label) {
    return;
  }
  let textNode = [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  if (!textNode) {
    textNode = document.createTextNode("");
    label.appendChild(textNode);
  }
  textNode.textContent = ` ${text}`;
}

function setOptionText(select, value, text) {
  const option = select?.querySelector(`option[value='${value}']`);
  if (option) {
    option.textContent = text;
  }
}

function setStatus(element, message, tone) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  element.dataset.statusToken = token;
  element.dataset.tone = tone || "";
  swapText(element, message);
  if (message) {
    window.setTimeout(() => {
      if (element.dataset.statusToken === token) {
        element.dataset.statusToken = "";
        element.dataset.tone = "";
        swapText(element, "");
      }
    }, 5000);
  }
}

function swapText(element, nextText) {
  if (!element) {
    return;
  }

  element.classList.remove("is-exit", "is-enter-start");
  if (element.textContent === nextText) {
    return;
  }

  element.textContent = nextText;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  element.classList.add("is-enter-start");
  void element.offsetHeight;
  element.classList.remove("is-enter-start");
}

function setDigits(group, value) {
  const text = String(value);
  if (!group || (group.textContent === text && group.children.length)) {
    return;
  }

  group.setAttribute("aria-label", text);
  group.classList.remove("is-animating");
  group.replaceChildren();

  [...text].forEach((character, index, characters) => {
    const digit = document.createElement("span");
    digit.className = "t-digit";
    digit.textContent = character;
    if (index === characters.length - 2) {
      digit.dataset.stagger = "1";
    } else if (index === characters.length - 1) {
      digit.dataset.stagger = "2";
    }
    group.appendChild(digit);
  });

  void group.offsetHeight;
  group.classList.add("is-animating");
}

function initSectionNav() {
  const links = [...document.querySelectorAll(".sidebar a[href^='#']")];
  const sections = links
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);

  if (!links.length || !sections.length) {
    return;
  }

  const setCurrent = (id) => {
    links.forEach((link) => {
      const isCurrent = link.getAttribute("href") === `#${id}`;
      if (isCurrent) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  };

  setCurrent(location.hash.slice(1) || sections[0].id);

  if (!("IntersectionObserver" in window)) {
    window.addEventListener("scroll", () => {
      let current = sections[0];
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= 140) {
          current = section;
        }
      }
      setCurrent(current.id);
    }, { passive: true });
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible?.target?.id) {
      setCurrent(visible.target.id);
    }
  }, {
    rootMargin: "-18% 0px -62% 0px",
    threshold: [0, 0.1, 0.35, 0.7]
  });

  sections.forEach((section) => observer.observe(section));
}

function deepMerge(base, extra) {
  if (!extra || typeof extra !== "object") {
    return structuredClone(base);
  }

  const output = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      output[key] = deepMerge(base[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
