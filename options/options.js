const DEFAULT_SETTINGS = {
  theme: "auto",
  language: "中文（简体）",
  panelEnabled: true,
  activeProfileId: "deepseek",
  profiles: [
    profilePreset("deepseek"),
    profilePreset("openai"),
    profilePreset("claude")
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
  saveHistory: false
};

let settings = structuredClone(DEFAULT_SETTINGS);

const fields = {
  language: document.querySelector("#language"),
  panelEnabled: document.querySelector("#panelEnabled"),
  activeProfile: document.querySelector("#activeProfile"),
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
  apiStatus: document.querySelector("#apiStatus"),
  saveStatus: document.querySelector("#saveStatus")
};

init();

async function init() {
  const result = await chrome.storage.local.get("vcsSettings");
  settings = deepMerge(DEFAULT_SETTINGS, result.vcsSettings || {});
  hydrateForm();
  bindEvents();
}

function bindEvents() {
  document.querySelector("#saveAll").addEventListener("click", saveAll);
  document.querySelector("#saveProfile").addEventListener("click", saveCurrentProfile);
  document.querySelector("#addProfile").addEventListener("click", addProfile);
  document.querySelector("#deleteProfile").addEventListener("click", deleteProfile);
  document.querySelector("#testProfile").addEventListener("click", testProfile);
  document.querySelector("#exportSettings").addEventListener("click", exportSettings);
  document.querySelector("#importSettings").addEventListener("click", importSettings);
  document.querySelector("#resetSettings").addEventListener("click", resetSettings);

  fields.activeProfile.addEventListener("change", () => {
    settings.activeProfileId = fields.activeProfile.value;
    renderProfileFields();
  });

  document.querySelectorAll("input[name='theme']").forEach((input) => {
    input.addEventListener("change", () => {
      settings.theme = input.value;
    });
  });

  document.querySelectorAll(".preset").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });

  document.querySelectorAll(".template").forEach((button) => {
    button.addEventListener("click", () => applyTemplate(button.dataset.template));
  });
}

function hydrateForm() {
  document.querySelector(`input[name='theme'][value='${settings.theme || "auto"}']`).checked = true;
  fields.language.value = settings.language || "";
  fields.panelEnabled.checked = settings.panelEnabled !== false;
  fields.promptTemplate.value = settings.promptTemplate || "";
  fields.outputTemplate.value = settings.outputTemplate || "";
  fields.includeTimestamps.checked = settings.includeTimestamps !== false;
  fields.saveHistory.checked = Boolean(settings.saveHistory);
  fields.redactTerms.value = settings.redactTerms || "";
  fields.chunkSize.value = settings.chunkSize || 12000;
  fields.chunkOverlap.value = settings.chunkOverlap || 600;
  renderProfileSelect();
  renderProfileFields();
}

function renderProfileSelect() {
  fields.activeProfile.innerHTML = settings.profiles.map((profile) => {
    const selected = profile.id === settings.activeProfileId ? "selected" : "";
    return `<option value="${escapeHtml(profile.id)}" ${selected}>${escapeHtml(profile.name || profile.id)}</option>`;
  }).join("");
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
  fields.temperature.value = profile.temperature ?? 0.2;
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
  profile.temperature = Number(fields.temperature.value || 0.2);
  profile.maxTokens = Number(fields.maxTokens.value || 4096);
  renderProfileSelect();
  saveAll("API 配置已保存");
}

async function saveAll(message = "设置已保存") {
  settings.theme = document.querySelector("input[name='theme']:checked")?.value || "auto";
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

  await chrome.storage.local.set({ vcsSettings: settings });
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
  profile.temperature = Number(fields.temperature.value || 0.2);
  profile.maxTokens = Number(fields.maxTokens.value || 4096);
}

function addProfile() {
  const profile = {
    id: `custom-${Date.now()}`,
    name: "Custom API",
    provider: "openai-compatible",
    endpoint: "https://api.example.com/v1/chat/completions",
    apiKey: "",
    model: "custom-model",
    temperature: 0.2,
    maxTokens: 4096
  };
  settings.profiles.push(profile);
  settings.activeProfileId = profile.id;
  renderProfileSelect();
  renderProfileFields();
}

function deleteProfile() {
  if (settings.profiles.length <= 1) {
    setStatus(fields.apiStatus, "至少保留一个 API 配置。", "error");
    return;
  }

  const index = settings.profiles.findIndex((profile) => profile.id === settings.activeProfileId);
  if (index >= 0) {
    settings.profiles.splice(index, 1);
  }
  settings.activeProfileId = settings.profiles[0].id;
  renderProfileSelect();
  renderProfileFields();
}

function applyPreset(name) {
  const preset = profilePreset(name);
  const profile = getActiveProfile();
  Object.assign(profile, {
    ...preset,
    id: profile.id,
    apiKey: profile.apiKey || preset.apiKey
  });
  renderProfileFields();
}

function profilePreset(name) {
  const presets = {
    deepseek: {
      id: "deepseek",
      name: "DeepSeek",
      provider: "openai-compatible",
      endpoint: "https://api.deepseek.com/v1/chat/completions",
      apiKey: "",
      model: "deepseek-chat",
      temperature: 0.2,
      maxTokens: 4096
    },
    openai: {
      id: "openai",
      name: "OpenAI / ChatGPT",
      provider: "openai-compatible",
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: "",
      model: "gpt-4o-mini",
      temperature: 0.2,
      maxTokens: 4096
    },
    claude: {
      id: "claude",
      name: "Claude",
      provider: "anthropic",
      endpoint: "https://api.anthropic.com/v1/messages",
      apiKey: "",
      model: "claude-sonnet-4-5",
      temperature: 0.2,
      maxTokens: 4096
    },
    gemini: {
      id: "gemini",
      name: "Gemini",
      provider: "gemini",
      endpoint: "",
      apiKey: "",
      model: "gemini-1.5-pro",
      temperature: 0.2,
      maxTokens: 4096
    },
    kimi: {
      id: "kimi",
      name: "Kimi (Moonshot)",
      provider: "openai-compatible",
      endpoint: "https://api.moonshot.cn/v1/chat/completions",
      apiKey: "",
      model: "moonshot-v1-32k",
      temperature: 0.2,
      maxTokens: 4096
    },
    qwen: {
      id: "qwen",
      name: "通义千问",
      provider: "openai-compatible",
      endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      apiKey: "",
      model: "qwen-plus",
      temperature: 0.2,
      maxTokens: 4096
    },
    glm: {
      id: "glm",
      name: "智谱 GLM",
      provider: "openai-compatible",
      endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      apiKey: "",
      model: "glm-4-plus",
      temperature: 0.2,
      maxTokens: 4096
    },
    mimo: {
      id: "mimo",
      name: "小米 MiMo (本地)",
      provider: "openai-compatible",
      endpoint: "http://localhost:11434/v1/chat/completions",
      apiKey: "",
      model: "mimo",
      temperature: 0.2,
      maxTokens: 4096
    },
    ollama: {
      id: "ollama",
      name: "Ollama Local",
      provider: "ollama",
      endpoint: "http://localhost:11434/v1/chat/completions",
      apiKey: "",
      model: "llama3.1",
      temperature: 0.2,
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
  setStatus(fields.apiStatus, "正在测试连接...", "");

  const response = await chrome.runtime.sendMessage({
    type: "VCS_TEST_API",
    profile: getActiveProfile()
  });

  if (response?.ok) {
    setStatus(fields.apiStatus, `连接成功：${response.payload.text}`, "ok");
  } else {
    setStatus(fields.apiStatus, response?.error || "连接失败。", "error");
  }
}

async function exportSettings() {
  await saveAll("设置已保存，可导出");
  const json = JSON.stringify(settings, null, 2);
  await navigator.clipboard.writeText(json);
  setStatus(fields.saveStatus, "配置 JSON 已复制。", "ok");
}

async function importSettings() {
  try {
    const imported = JSON.parse(fields.importText.value);
    settings = deepMerge(DEFAULT_SETTINGS, imported);
    hydrateForm();
    await chrome.storage.local.set({ vcsSettings: settings });
    setStatus(fields.saveStatus, "配置已导入。", "ok");
  } catch (error) {
    setStatus(fields.saveStatus, `导入失败：${error.message}`, "error");
  }
}

async function resetSettings() {
  settings = structuredClone(DEFAULT_SETTINGS);
  hydrateForm();
  await chrome.storage.local.set({ vcsSettings: settings });
  setStatus(fields.saveStatus, "已恢复默认设置。", "ok");
}

function getActiveProfile() {
  return settings.profiles.find((profile) => profile.id === settings.activeProfileId) || settings.profiles[0];
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
