const SETTINGS_KEY = "vcsSettings";
const HISTORY_KEY = "vcsHistory";
const HISTORY_LIMIT = 30;
const I18N = globalThis.VCS_I18N;

const DEFAULT_SETTINGS = {
  settingsVersion: 4,
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
  promptTemplate: [
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
  ].join("\n"),
  outputTemplate: [
    "请使用 Markdown 输出：",
    "## 一句话结论",
    "## 核心摘要",
    "## 关键观点",
    "- 每条观点尽量带上相关时间点",
    "## 章节时间线",
    "## 可执行事项 / 值得追问的问题"
  ].join("\n"),
  chunkSize: 12000,
  chunkOverlap: 600,
  includeTimestamps: true,
  includeTitleAndUrl: true,
  redactTerms: "",
  saveHistory: true
};

let settings = structuredClone(DEFAULT_SETTINGS);

const fields = {
  uiLanguage: document.querySelector("#uiLanguage"),
  language: document.querySelector("#language"),
  panelEnabled: document.querySelector("#panelEnabled"),
  profileName: document.querySelector("#profileName"),
  provider: document.querySelector("#provider"),
  endpoint: document.querySelector("#endpoint"),
  apiKey: document.querySelector("#apiKey"),
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
  document.querySelector("#saveProfile").addEventListener("click", saveCurrentProfile);
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

  document.querySelectorAll(".template").forEach((button) => {
    button.addEventListener("click", () => applyTemplate(button.dataset.template));
  });

  fields.historyList.addEventListener("click", copyHistoryFromList);

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
  fields.provider.value = profile.provider || "openai-compatible";
  fields.endpoint.value = profile.endpoint || "";
  fields.apiKey.value = profile.apiKey || "";
  fields.model.value = profile.model || "";
  fields.temperature.value = profile.temperature ?? 1;
  fields.maxTokens.value = profile.maxTokens ?? 4096;
}

function saveCurrentProfile() {
  const profile = getActiveProfile();
  if (!profile) {
    return;
  }

  profile.name = fields.profileName.value.trim() || profile.id;
  profile.provider = fields.provider.value;
  profile.endpoint = fields.endpoint.value.trim();
  profile.apiKey = fields.apiKey.value.trim();
  profile.model = fields.model.value.trim();
  profile.temperature = Number(fields.temperature.value || 1);
  profile.maxTokens = Number(fields.maxTokens.value || 4096);
  saveAll(t("options.status.profileSaved"));
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
  saveCurrentProfileValuesOnly();
  settings = normalizeSettings(settings);

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
  profile.apiKey = fields.apiKey.value.trim();
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
  fields.provider.value = profile.provider;
  fields.endpoint.value = profile.endpoint;
  setStatus(fields.apiStatus, t("options.status.presetApplied"), "ok");
}

function profilePreset(name) {
  const presets = {
    deepseek: {
      id: "deepseek",
      name: "DeepSeek",
      provider: "openai-compatible",
      endpoint: "https://api.deepseek.com/v1/chat/completions",
      apiKey: "",
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
      model: "",
      temperature: 1,
      maxTokens: 4096
    },
    mimo: {
      id: "mimo",
      name: "小米 MiMo (本地)",
      provider: "openai-compatible",
      endpoint: "http://localhost:11434/v1/chat/completions",
      apiKey: "",
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
      model: "",
      temperature: 1,
      maxTokens: 4096
    }
  };

  return structuredClone(presets[name] || presets.deepseek);
}

function applyTemplate(name) {
  const templates = {
    study: [
      "请使用 Markdown 输出：",
      "## 一句话结论",
      "## 核心摘要",
      "## 概念解释",
      "## 章节时间线",
      "## 关键术语",
      "## 课后复盘问题"
    ].join("\n"),
    meeting: [
      "请使用 Markdown 输出：",
      "## 会议结论",
      "## 已确认决策",
      "## 行动项",
      "- 负责人 / 截止时间 / 背景",
      "## 风险与阻塞",
      "## 需要追问"
    ].join("\n"),
    research: [
      "请使用 Markdown 输出：",
      "## 研究摘要",
      "## 论点与证据",
      "## 重要数据 / 名词",
      "## 反方观点或不确定性",
      "## 可引用时间点"
    ].join("\n")
  };

  fields.outputTemplate.value = templates[name] || templates.study;
}

async function testProfile() {
  saveCurrentProfileValuesOnly();
  setStatus(fields.apiStatus, t("options.status.testing"), "");

  const response = await chrome.runtime.sendMessage({
    type: "VCS_TEST_API",
    profile: getActiveProfile()
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
    settings
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
  fields.historyCount.textContent = `${history.length} / ${HISTORY_LIMIT}`;

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
  normalized.saveHistory = importedVersion < 2 ? true : normalized.saveHistory !== false;
  normalized.promptTemplate = String(normalized.promptTemplate || DEFAULT_SETTINGS.promptTemplate);
  normalized.outputTemplate = String(normalized.outputTemplate || DEFAULT_SETTINGS.outputTemplate);
  normalized.redactTerms = String(normalized.redactTerms || "");
  normalized.chunkSize = clampNumber(normalized.chunkSize, 12000, 2000, 50000);
  normalized.chunkOverlap = clampNumber(normalized.chunkOverlap, 600, 0, 5000);

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
  const fallback = profilePreset(index === 1 ? "openai" : index === 2 ? "claude" : "deepseek");
  const temperature = importedVersion < 3 && Number(profile?.temperature) === 0.2
    ? 1
    : profile?.temperature;
  return {
    ...fallback,
    ...(profile || {}),
    id: String(profile?.id || fallback.id || `profile-${index + 1}`),
    name: String(profile?.name || fallback.name || `API ${index + 1}`),
    provider: String(profile?.provider || fallback.provider || "openai-compatible"),
    endpoint: String(profile?.endpoint || fallback.endpoint || ""),
    apiKey: String(profile?.apiKey || ""),
    model: String(profile?.model || fallback.model || ""),
    temperature: clampNumber(temperature, fallback.temperature ?? 1, 0, 2),
    maxTokens: clampNumber(profile?.maxTokens, fallback.maxTokens, 256, 32000)
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
  setOptionText(fields.provider, "openai-compatible", locale.t("options.api.provider.openai"));
  setOptionText(fields.provider, "anthropic", locale.t("options.api.provider.anthropic"));
  setOptionText(fields.provider, "gemini", locale.t("options.api.provider.gemini"));
  setOptionText(fields.provider, "ollama", locale.t("options.api.provider.ollama"));
  setFieldLabel(fields.endpoint, locale.t("options.api.endpoint"));
  setFieldLabel(fields.apiKey, locale.t("options.api.apiKey"));
  setFieldLabel(fields.model, locale.t("options.api.model"));
  fields.model.placeholder = locale.t("options.api.modelPlaceholder");
  setFieldLabel(fields.temperature, locale.t("options.api.temperature"));
  setFieldLabel(fields.maxTokens, locale.t("options.api.maxTokens"));
  setText("#saveProfile", locale.t("options.api.saveProfile"));
  setText("#testProfile", locale.t("options.api.testProfile"));

  setText("#prompt .section__head h2", locale.t("options.nav.prompt"));
  setText("#prompt .section__head p", locale.t("options.prompt.description"));
  setFieldLabel(fields.promptTemplate, locale.t("options.prompt.promptTemplate"));
  setFieldLabel(fields.outputTemplate, locale.t("options.prompt.outputTemplate"));
  setTemplateText("study", locale.t("options.prompt.study.title"), locale.t("options.prompt.study.body"));
  setTemplateText("meeting", locale.t("options.prompt.meeting.title"), locale.t("options.prompt.meeting.body"));
  setTemplateText("research", locale.t("options.prompt.research.title"), locale.t("options.prompt.research.body"));

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

function setTemplateText(name, title, body) {
  const template = document.querySelector(`.template[data-template='${name}']`);
  if (!template) {
    return;
  }
  template.querySelector("strong").textContent = title;
  template.querySelector("span").textContent = body;
}

function setStatus(element, message, tone) {
  element.textContent = message;
  element.dataset.tone = tone || "";
  if (message) {
    window.setTimeout(() => {
      if (element.textContent === message) {
        element.textContent = "";
        element.dataset.tone = "";
      }
    }, 5000);
  }
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
