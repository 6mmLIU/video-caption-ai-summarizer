const DEFAULT_SETTINGS = {
  settingsVersion: 3,
  theme: "auto",
  language: "中文（简体）",
  panelEnabled: true,
  activeProfileId: "custom",
  profiles: [
    {
      id: "custom",
      name: "我的 API 配置",
      provider: "openai-compatible",
      endpoint: "https://api.deepseek.com/v1/chat/completions",
      apiKey: "",
      model: "",
      temperature: 1,
      maxTokens: 4096
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
const MODEL_REQUEST_TIMEOUT_MS = 60000;
const HISTORY_LIMIT = 30;

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get("vcsSettings");
  if (!existing.vcsSettings) {
    await chrome.storage.local.set({ vcsSettings: DEFAULT_SETTINGS });
  } else {
    await chrome.storage.local.set({ vcsSettings: normalizeSettings(existing.vcsSettings) });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => sendResponse({ ok: false, error: readableError(error) }));
  return true;
});

async function handleMessage(message, sender) {
  if (!message || !message.type) {
    throw new Error("Empty extension message.");
  }

  if (message.type === "VCS_FETCH_TEXT") {
    return fetchText(message.url);
  }

  if (message.type === "VCS_SUMMARIZE") {
    return summarizeTranscript(message.payload, sender);
  }

  if (message.type === "VCS_TEST_API") {
    const settings = await getSettings();
    const profile = message.profile || getActiveProfile(settings);
    const text = await callModel(profile, [
      {
        role: "system",
        content: "You are a concise API health check responder."
      },
      {
        role: "user",
        content: "Reply with exactly: OK"
      }
    ]);
    return { text };
  }

  if (message.type === "VCS_OPEN_OPTIONS") {
    await chrome.runtime.openOptionsPage();
    return { opened: true };
  }

  throw new Error(`Unknown message type: ${message.type}`);
}

async function fetchText(url) {
  if (!url || typeof url !== "string") {
    throw new Error("Missing fetch URL.");
  }

  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    headers: {
      "Accept": "application/json,text/vtt,text/plain,text/xml,*/*"
    }
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }

  return {
    url: response.url,
    contentType: response.headers.get("content-type") || "",
    text: await response.text()
  };
}

async function summarizeTranscript(payload, sender) {
  const settings = await getSettings();
  const profile = getActiveProfile(settings);
  validateProfile(profile);

  const title = payload?.title || "Untitled video";
  const platform = payload?.platform || "Unknown platform";
  const url = payload?.url || "";
  const transcript = sanitizeTranscript(payload?.transcript || "", settings);

  if (!transcript.trim()) {
    throw new Error("No transcript text was found.");
  }

  const chunks = chunkTranscript(
    transcript,
    Number(settings.chunkSize) || DEFAULT_SETTINGS.chunkSize,
    Number(settings.chunkOverlap) || DEFAULT_SETTINGS.chunkOverlap
  );

  if (chunks.length === 1) {
    await notifyProgress(sender, {
      label: "正在请求模型（最多 60 秒）",
      current: 1,
      total: 1
    });
    const text = await callModel(profile, buildSummaryMessages(settings, {
      title,
      platform,
      url,
      transcript: chunks[0],
      chunkLabel: ""
    }));
    await maybeSaveHistory(settings, { title, platform, url, summary: text, model: profile.model, provider: profile.provider });
    return {
      text,
      chunks: 1,
      model: profile.model,
      provider: profile.provider
    };
  }

  const chunkSummaries = [];
  for (let index = 0; index < chunks.length; index += 1) {
    await notifyProgress(sender, {
      label: `正在提炼第 ${index + 1}/${chunks.length} 段字幕`,
      current: index + 1,
      total: chunks.length + 1
    });

    const chunkSummary = await callModel(profile, [
      {
        role: "system",
        content: [
          "你是一个视频字幕分段整理助手。",
          "只提取该段字幕中的事实、观点、术语、人物、结论和可引用时间点。",
          "不要编造没有出现在字幕中的信息。"
        ].join("\n")
      },
      {
        role: "user",
        content: renderTemplate(settings.promptTemplate, {
          title,
          platform,
          url,
          language: settings.language,
          transcript: chunks[index],
          outputTemplate: [
            `这是第 ${index + 1}/${chunks.length} 段字幕。`,
            "请输出该段的结构化笔记，保留重要时间点。"
          ].join("\n")
        })
      }
    ]);
    chunkSummaries.push(`### 分段 ${index + 1}/${chunks.length}\n${chunkSummary}`);
  }

  await notifyProgress(sender, {
    label: "正在合并分段总结",
    current: chunks.length + 1,
    total: chunks.length + 1
  });

  const finalText = await callModel(profile, [
    {
      role: "system",
      content: [
        "你是一个擅长把分段字幕笔记合成为完整视频总结的中文研究助理。",
        "请合并重复信息，保留重要时间点和上下文，不要编造。"
      ].join("\n")
    },
    {
      role: "user",
      content: renderTemplate(settings.promptTemplate, {
        title,
        platform,
        url,
        language: settings.language,
        transcript: chunkSummaries.join("\n\n"),
        outputTemplate: settings.outputTemplate
      })
    }
  ]);

  await maybeSaveHistory(settings, { title, platform, url, summary: finalText, model: profile.model, provider: profile.provider });
  return {
    text: finalText,
    chunks: chunks.length,
    model: profile.model,
    provider: profile.provider
  };
}

function buildSummaryMessages(settings, variables) {
  return [
    {
      role: "system",
      content: [
        "你是一个可靠的视频字幕总结助手。",
        "只依据用户提供的字幕内容回答。遇到字幕不完整时，请明确说明不确定性。"
      ].join("\n")
    },
    {
      role: "user",
      content: renderTemplate(settings.promptTemplate, {
        ...variables,
        language: settings.language,
        outputTemplate: settings.outputTemplate
      })
    }
  ];
}

async function getSettings() {
  const result = await chrome.storage.local.get("vcsSettings");
  return normalizeSettings(result.vcsSettings);
}

function getActiveProfile(settings) {
  const profiles = Array.isArray(settings.profiles) ? settings.profiles : [];
  return profiles.find((profile) => profile.id === settings.activeProfileId) || profiles[0];
}

function validateProfile(profile) {
  if (!profile) {
    throw new Error("No API profile is configured.");
  }
  if (!profile.provider) {
    throw new Error("The active API profile has no provider.");
  }
  if (!profile.apiKey && profile.provider !== "ollama") {
    throw new Error("The active API profile has no API key.");
  }
  if (!profile.model) {
    throw new Error("The active API profile has no model.");
  }
  if (!profile.endpoint && profile.provider !== "gemini") {
    throw new Error("The active API profile has no endpoint.");
  }
}

async function callModel(profile, messages) {
  if (profile.provider === "openai-compatible" || profile.provider === "ollama") {
    return callOpenAICompatible(profile, messages);
  }
  if (profile.provider === "anthropic") {
    return callAnthropic(profile, messages);
  }
  if (profile.provider === "gemini") {
    return callGemini(profile, messages);
  }
  throw new Error(`Unsupported provider: ${profile.provider}`);
}

async function callOpenAICompatible(profile, messages) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (profile.apiKey) {
    headers.Authorization = `Bearer ${profile.apiKey}`;
  }

  const body = {
    model: profile.model,
    messages,
    max_tokens: toNumber(profile.maxTokens, 4096),
    stream: false
  };

  if (shouldDisableKimiThinking(profile)) {
    body.thinking = { type: "disabled" };
  } else {
    body.temperature = toNumber(profile.temperature, 1);
  }

  const response = await fetchModel(profile.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  }, profile);

  const data = await readJsonResponse(response, profile);
  const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text;
  if (!content) {
    throw new Error("The OpenAI-compatible response did not contain text.");
  }
  return content.trim();
}

async function callAnthropic(profile, messages) {
  const systemMessage = messages.find((message) => message.role === "system")?.content || "";
  const userMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content
    }));

  const endpoint = profile.endpoint || "https://api.anthropic.com/v1/messages";
  const response = await fetchModel(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": profile.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: profile.model,
      max_tokens: toNumber(profile.maxTokens, 4096),
      temperature: toNumber(profile.temperature, 1),
      system: systemMessage,
      messages: userMessages.length ? userMessages : [{ role: "user", content: "OK" }]
    })
  }, profile);

  const data = await readJsonResponse(response, profile);
  const content = Array.isArray(data?.content)
    ? data.content.map((part) => part.text || "").join("")
    : "";
  if (!content) {
    throw new Error("The Anthropic response did not contain text.");
  }
  return content.trim();
}

async function callGemini(profile, messages) {
  const base = profile.endpoint || `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(profile.model)}:generateContent`;
  const url = new URL(base);
  if (profile.apiKey && !url.searchParams.has("key")) {
    url.searchParams.set("key", profile.apiKey);
  }

  const text = messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join("\n\n");

  const response = await fetchModel(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text }]
        }
      ],
      generationConfig: {
        temperature: toNumber(profile.temperature, 1),
        maxOutputTokens: toNumber(profile.maxTokens, 4096)
      }
    })
  }, profile);

  const data = await readJsonResponse(response, profile);
  const content = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("");
  if (!content) {
    throw new Error("The Gemini response did not contain text.");
  }
  return content.trim();
}

async function fetchModel(url, options, profile) {
  const controller = new AbortController();
  const timeoutMs = MODEL_REQUEST_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    const target = getApiTargetLabel(profile, url);
    if (error?.name === "AbortError") {
      throw new Error(`模型请求超时（${Math.round(timeoutMs / 1000)} 秒，${target}）。请检查接口地址、模型名/API Key，或换用更快的模型。`);
    }
    if (error instanceof TypeError || error?.name === "TypeError") {
      throw new Error(`模型网络请求失败（${target}）：${error.message || "Failed to fetch"}。通常是接口地址无法连接、证书/CORS 被拦截，或当前网络访问不了该服务。`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readJsonResponse(response, profile) {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`模型接口返回了非 JSON 内容（${getApiTargetLabel(profile, response.url)}）：${text.slice(0, 240)}`);
  }

  if (!response.ok) {
    const message = data?.error?.message || data?.message || response.statusText;
    throw new Error(`模型接口返回错误（${getApiTargetLabel(profile, response.url)}）：HTTP ${response.status} ${message}`);
  }

  return data;
}

function shouldDisableKimiThinking(profile) {
  const model = String(profile?.model || "").toLowerCase();
  const endpoint = String(profile?.endpoint || "").toLowerCase();
  return endpoint.includes("moonshot") && (model === "kimi-k2.6" || model === "kimi-k2.5");
}

function getApiTargetLabel(profile, endpoint) {
  let host = "";
  try {
    host = new URL(endpoint).host;
  } catch (_error) {
    host = endpoint || "unknown endpoint";
  }
  const model = profile?.model || "unknown model";
  return `${model} @ ${host}`;
}

function chunkTranscript(text, size, overlap) {
  const normalized = text.replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length <= size) {
    return [normalized];
  }

  const lines = normalized.split(/\n+/);
  const chunks = [];
  let current = "";

  for (const line of lines) {
    if (current.length + line.length + 1 > size && current.trim()) {
      chunks.push(current.trim());
      current = current.slice(Math.max(0, current.length - overlap));
    }
    current += `${line}\n`;
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

function sanitizeTranscript(text, settings) {
  let output = String(text || "").replace(/\u0000/g, "").trim();
  const terms = String(settings.redactTerms || "")
    .split(/[\n,]/)
    .map((term) => term.trim())
    .filter(Boolean);

  for (const term of terms) {
    output = output.split(term).join("[已隐藏]");
  }

  if (!settings.includeTimestamps) {
    output = output.replace(/^\s*\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*/gm, "");
  }

  return output;
}

function renderTemplate(template, variables) {
  const source = template || DEFAULT_SETTINGS.promptTemplate;
  const withOutput = source.includes("{{outputTemplate}}")
    ? source
    : `${source}\n\n输出格式要求：\n{{outputTemplate}}`;

  return withOutput.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    return variables[key] == null ? "" : String(variables[key]);
  });
}

async function notifyProgress(sender, progress) {
  const tabId = sender?.tab?.id;
  if (!tabId) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "VCS_PROGRESS",
      progress
    });
  } catch (_error) {
    // The tab may have navigated while the model request was running.
  }
}

async function maybeSaveHistory(settings, item) {
  if (!settings.saveHistory) {
    return;
  }

  const result = await chrome.storage.local.get("vcsHistory");
  const history = Array.isArray(result.vcsHistory) ? result.vcsHistory : [];
  history.unshift({
    id: `summary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...item,
    createdAt: new Date().toISOString()
  });
  await chrome.storage.local.set({ vcsHistory: history.slice(0, HISTORY_LIMIT) });
}

function normalizeSettings(input) {
  const normalized = deepMerge(DEFAULT_SETTINGS, input || {});
  const importedVersion = Number(input?.settingsVersion || 0);
  normalized.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
  normalized.theme = ["auto", "light", "dark"].includes(normalized.theme) ? normalized.theme : DEFAULT_SETTINGS.theme;
  normalized.language = String(normalized.language || "").trim() || DEFAULT_SETTINGS.language;
  normalized.panelEnabled = normalized.panelEnabled !== false;
  normalized.includeTimestamps = normalized.includeTimestamps !== false;
  normalized.includeTitleAndUrl = normalized.includeTitleAndUrl !== false;
  normalized.saveHistory = importedVersion < 2 ? true : normalized.saveHistory !== false;
  normalized.promptTemplate = String(normalized.promptTemplate || DEFAULT_SETTINGS.promptTemplate);
  normalized.outputTemplate = String(normalized.outputTemplate || DEFAULT_SETTINGS.outputTemplate);
  normalized.redactTerms = String(normalized.redactTerms || "");
  normalized.chunkSize = clampNumber(normalized.chunkSize, DEFAULT_SETTINGS.chunkSize, 2000, 50000);
  normalized.chunkOverlap = clampNumber(normalized.chunkOverlap, DEFAULT_SETTINGS.chunkOverlap, 0, 5000);

  if (!Array.isArray(normalized.profiles) || !normalized.profiles.length) {
    normalized.profiles = structuredClone(DEFAULT_SETTINGS.profiles);
  }
  normalized.profiles = normalized.profiles.map((profile, index) => {
    const temperature = importedVersion < 3 && Number(profile?.temperature) === 0.2
      ? 1
      : profile?.temperature;
    return {
      id: String(profile?.id || `profile-${index + 1}`),
      name: String(profile?.name || profile?.id || `API ${index + 1}`),
      provider: String(profile?.provider || "openai-compatible"),
      endpoint: String(profile?.endpoint || ""),
      apiKey: String(profile?.apiKey || ""),
      model: String(profile?.model || ""),
      temperature: clampNumber(temperature, 1, 0, 2),
      maxTokens: clampNumber(profile?.maxTokens, 4096, 256, 32000)
    };
  });
  if (!normalized.profiles.some((profile) => profile.id === normalized.activeProfileId)) {
    normalized.activeProfileId = normalized.profiles[0].id;
  }

  return normalized;
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

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readableError(error) {
  if (!error) {
    return "Unknown error";
  }
  return error.message || String(error);
}
