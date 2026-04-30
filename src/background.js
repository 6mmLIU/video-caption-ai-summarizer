import "./i18n.js";

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
      id: "custom",
      name: "我的 API 配置",
      provider: "openai-compatible",
      endpoint: "https://api.deepseek.com/v1/chat/completions",
      apiKey: "",
      accessToken: "",
      model: "",
      temperature: 1,
      maxTokens: 4096
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
const DEFAULT_REQUEST_TIMEOUT_MS = DEFAULT_SETTINGS.requestTimeoutSeconds * 1000;
const HISTORY_LIMIT = 30;

function i18n(settings) {
  return globalThis.VCS_I18N.create(settings);
}

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
    return fetchText(message.url, sender);
  }

  if (message.type === "VCS_SUMMARIZE") {
    return summarizeTranscript(message.payload, sender, {
      stream: Boolean(message.stream),
      streamId: message.streamId || ""
    });
  }

  if (message.type === "VCS_TEST_API") {
    const settings = await getSettings();
    const locale = i18n(settings);
    const profile = normalizeProfile(message.profile || getActiveProfile(settings), 0, DEFAULT_SETTINGS.settingsVersion);
    const testOptions = {
      i18n: locale,
      timeoutMs: getRequestTimeoutMs(settings)
    };
    if (message.stream) {
      testOptions.onDelta = () => {};
    }
    const text = await callModel(profile, [
      {
        role: "system",
        content: "You are a concise API health check responder."
      },
      {
        role: "user",
        content: "Reply with exactly: OK"
      }
    ], testOptions);
    return { text };
  }

  if (message.type === "VCS_OPEN_OPTIONS") {
    await chrome.runtime.openOptionsPage();
    return { opened: true };
  }

  throw new Error(`Unknown message type: ${message.type}`);
}

async function fetchText(url, sender) {
  const locale = i18n(await getSettings());
  const safeUrl = validateCaptionFetchUrl(url, sender, locale);
  if (!safeUrl?.href) {
    throw new Error(locale.t("background.error.fetchUrlMissing"));
  }

  const fetchOptions = {
    credentials: shouldIncludeFetchCredentials(safeUrl, sender) ? "include" : "omit",
    cache: "no-store",
    headers: {
      "Accept": "application/json,text/vtt,text/plain,text/xml,*/*"
    }
  };

  const senderUrl = parseUrl(sender?.tab?.url);
  if (senderUrl?.protocol === "https:" && safeUrl.protocol === "https:") {
    fetchOptions.referrer = senderUrl.href;
    fetchOptions.referrerPolicy = "strict-origin-when-cross-origin";
  }

  const response = await fetch(safeUrl.href, fetchOptions);

  if (!response.ok) {
    throw new Error(locale.t("background.error.fetchFailed", {
      status: response.status,
      statusText: response.statusText
    }));
  }

  return {
    url: response.url,
    contentType: response.headers.get("content-type") || "",
    text: await response.text()
  };
}

async function summarizeTranscript(payload, sender, options = {}) {
  const settings = await getSettings();
  const locale = i18n(settings);
  const profile = getActiveProfile(settings);
  validateProfile(profile, locale);
  const streamId = options.streamId || "";
  const streamNotifier = options.stream && streamId
    ? createSummaryStreamNotifier(sender, streamId)
    : null;
  const streamDelta = streamNotifier
    ? (delta) => streamNotifier.push(delta)
    : null;

  const title = payload?.title || "Untitled video";
  const platform = payload?.platform || "Unknown platform";
  const url = payload?.url || "";
  const transcript = sanitizeTranscript(payload?.transcript || "", settings);

  if (!transcript.trim()) {
    throw new Error(locale.t("background.error.noTranscript"));
  }

  const chunks = chunkTranscript(
    transcript,
    Number(settings.chunkSize) || DEFAULT_SETTINGS.chunkSize,
    Number(settings.chunkOverlap) || DEFAULT_SETTINGS.chunkOverlap
  );
  const timeoutMs = getRequestTimeoutMs(settings);
  const timeoutSeconds = Math.round(timeoutMs / 1000);

  if (chunks.length === 1) {
    await notifyProgress(sender, {
      label: locale.t("background.progress.requestModel", { seconds: timeoutSeconds }),
      current: 1,
      total: 1
    });
    const text = await callModel(profile, buildSummaryMessages(settings, {
      title,
      platform,
      url,
      transcript: chunks[0],
      chunkLabel: ""
    }), { onDelta: streamDelta, i18n: locale, timeoutMs });
    streamNotifier?.flush();
    await maybeSaveHistory(settings, {
      title,
      platform,
      url,
      summary: text,
      model: getModelDisplayName(profile, locale),
      provider: getProviderDisplayName(profile, locale)
    });
    return {
      text,
      chunks: 1,
      model: getModelDisplayName(profile, locale),
      provider: getProviderDisplayName(profile, locale)
    };
  }

  const chunkSummaries = [];
  for (let index = 0; index < chunks.length; index += 1) {
    await notifyProgress(sender, {
      label: locale.t("background.progress.extractChunk", { current: index + 1, total: chunks.length }),
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
          uiLanguage: settings.uiLanguage,
          transcript: chunks[index],
          outputTemplate: [
            `这是第 ${index + 1}/${chunks.length} 段字幕。`,
            "请输出该段的结构化笔记，保留重要时间点。"
          ].join("\n")
        })
      }
    ], { i18n: locale, timeoutMs });
    chunkSummaries.push(`### ${locale.language === "en" ? "Chunk" : "分段"} ${index + 1}/${chunks.length}\n${chunkSummary}`);
  }

  await notifyProgress(sender, {
    label: locale.t("background.progress.mergeChunks"),
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
        uiLanguage: settings.uiLanguage,
        transcript: chunkSummaries.join("\n\n"),
        outputTemplate: settings.outputTemplate
      })
    }
  ], { onDelta: streamDelta, i18n: locale, timeoutMs });
  streamNotifier?.flush();

  await maybeSaveHistory(settings, {
    title,
    platform,
    url,
    summary: finalText,
    model: getModelDisplayName(profile, locale),
    provider: getProviderDisplayName(profile, locale)
  });
  return {
    text: finalText,
    chunks: chunks.length,
    model: getModelDisplayName(profile, locale),
    provider: getProviderDisplayName(profile, locale)
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
        uiLanguage: settings.uiLanguage,
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

function validateProfile(profile, locale = i18n(DEFAULT_SETTINGS)) {
  if (!profile) {
    throw new Error(locale.t("background.error.noProfile"));
  }
  if (!profile.provider) {
    throw new Error(locale.t("background.error.noProvider"));
  }
  const supportedProviders = ["proxy", "openai-compatible", "anthropic", "gemini", "ollama"];
  if (!supportedProviders.includes(profile.provider)) {
    throw new Error(locale.t("background.error.unsupportedProvider", { provider: profile.provider }));
  }
  if (!profile.apiKey && !profile.accessToken && !["proxy", "ollama"].includes(profile.provider)) {
    throw new Error(locale.t("background.error.noApiKey"));
  }
  if (!profile.model && !["proxy"].includes(profile.provider)) {
    throw new Error(locale.t("background.error.noModel"));
  }
  if (!getModelEndpoint(profile)) {
    throw new Error(locale.t("background.error.noEndpoint"));
  }
  assertSafeModelEndpoint(getModelEndpoint(profile), locale);
}

async function callModel(profile, messages, options = {}) {
  if (profile.provider === "proxy") {
    return callSecureProxy(profile, messages, options);
  }
  if (profile.provider === "openai-compatible" || profile.provider === "ollama") {
    return callOpenAICompatible(profile, messages, options);
  }
  if (profile.provider === "anthropic") {
    return callAnthropic(profile, messages, options);
  }
  if (profile.provider === "gemini") {
    return callGemini(profile, messages, options);
  }
  const locale = options.i18n || i18n(DEFAULT_SETTINGS);
  throw new Error(locale.t("background.error.unsupportedProvider", { provider: profile.provider }));
}

async function callSecureProxy(profile, messages, options = {}) {
  const locale = options.i18n || i18n(DEFAULT_SETTINGS);
  const wantsStream = typeof options.onDelta === "function";
  const headers = {
    "Content-Type": "application/json",
    "X-Video-Caption-AI": "extension"
  };

  if (profile.accessToken) {
    headers.Authorization = `Bearer ${profile.accessToken}`;
  }

  const response = await fetchModel(getModelEndpoint(profile), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: profile.model || undefined,
      messages,
      temperature: toNumber(profile.temperature, 1),
      max_tokens: toNumber(profile.maxTokens, 4096),
      stream: wantsStream
    })
  }, profile, locale, { timeoutMs: options.timeoutMs });

  if (wantsStream) {
    return readOpenAICompatibleStream(response, profile, options.onDelta, locale);
  }

  return readProxyJsonText(response, profile, locale);
}

async function callOpenAICompatible(profile, messages, options = {}) {
  const locale = options.i18n || i18n(DEFAULT_SETTINGS);
  const wantsStream = typeof options.onDelta === "function";
  const headers = {
    "Content-Type": "application/json"
  };

  const apiKey = getProfileApiKey(profile);
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const body = {
    model: profile.model,
    messages,
    max_tokens: toNumber(profile.maxTokens, 4096),
    stream: wantsStream
  };

  if (shouldDisableKimiThinking(profile)) {
    body.thinking = { type: "disabled" };
  } else {
    body.temperature = toNumber(profile.temperature, 1);
  }

  const response = await fetchModel(getModelEndpoint(profile), {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  }, profile, locale, { timeoutMs: options.timeoutMs });

  if (wantsStream) {
    return readOpenAICompatibleStream(response, profile, options.onDelta, locale);
  }

  const data = await readJsonResponse(response, profile, locale);
  const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text;
  if (!content) {
    throw new Error(locale.t("background.error.openaiNoText"));
  }
  return content.trim();
}

async function callAnthropic(profile, messages, options = {}) {
  const locale = options.i18n || i18n(DEFAULT_SETTINGS);
  const wantsStream = typeof options.onDelta === "function";
  const systemMessage = messages.find((message) => message.role === "system")?.content || "";
  const userMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content
    }));

  const response = await fetchModel(getModelEndpoint(profile), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": getProfileApiKey(profile),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: profile.model,
      max_tokens: toNumber(profile.maxTokens, 4096),
      temperature: toNumber(profile.temperature, 1),
      stream: wantsStream,
      system: systemMessage,
      messages: userMessages.length ? userMessages : [{ role: "user", content: "OK" }]
    })
  }, profile, locale, { timeoutMs: options.timeoutMs });

  if (wantsStream) {
    return readAnthropicStream(response, profile, options.onDelta, locale);
  }

  const data = await readJsonResponse(response, profile, locale);
  const content = Array.isArray(data?.content)
    ? data.content.map((part) => part.text || "").join("")
    : "";
  if (!content) {
    throw new Error(locale.t("background.error.anthropicNoText"));
  }
  return content.trim();
}

async function callGemini(profile, messages, options = {}) {
  const locale = options.i18n || i18n(DEFAULT_SETTINGS);
  const wantsStream = typeof options.onDelta === "function";
  const url = new URL(getModelEndpoint(profile));
  if (wantsStream && url.pathname.includes(":generateContent")) {
    url.pathname = url.pathname.replace(":generateContent", ":streamGenerateContent");
    url.searchParams.set("alt", "sse");
  }
  const apiKey = getProfileApiKey(profile);
  if (apiKey && !url.searchParams.has("key")) {
    url.searchParams.set("key", apiKey);
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
  }, profile, locale, { timeoutMs: options.timeoutMs });

  if (wantsStream) {
    return readGeminiStream(response, profile, options.onDelta, locale);
  }

  const data = await readJsonResponse(response, profile, locale);
  const content = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("");
  if (!content) {
    throw new Error(locale.t("background.error.geminiNoText"));
  }
  return content.trim();
}

async function readOpenAICompatibleStream(response, profile, onDelta, locale = i18n(DEFAULT_SETTINGS)) {
  let content = "";
  await readSseEvents(response, profile, async ({ data }) => {
    if (data === "[DONE]") {
      return false;
    }

    const chunk = parseStreamJson(data, profile, response.url, locale);
    const delta = chunk?.choices?.[0]?.delta?.content
      || chunk?.choices?.[0]?.message?.content
      || chunk?.choices?.[0]?.text
      || "";
    if (delta) {
      content += delta;
      onDelta(delta);
    }
    return true;
  }, locale);

  if (!content.trim()) {
    throw new Error(locale.t("background.error.openaiStreamNoText"));
  }
  return content.trim();
}

async function readAnthropicStream(response, profile, onDelta, locale = i18n(DEFAULT_SETTINGS)) {
  let content = "";
  await readSseEvents(response, profile, async ({ data }) => {
    if (data === "[DONE]") {
      return false;
    }

    const chunk = parseStreamJson(data, profile, response.url, locale);
    if (chunk?.type === "error") {
      throw new Error(locale.t("background.error.http", {
        target: getApiTargetLabel(profile, response.url),
        status: "stream",
        message: chunk.error?.message || "stream error"
      }));
    }

    const delta = chunk?.delta?.text || "";
    if (delta) {
      content += delta;
      onDelta(delta);
    }
    return true;
  }, locale);

  if (!content.trim()) {
    throw new Error(locale.t("background.error.anthropicStreamNoText"));
  }
  return content.trim();
}

async function readGeminiStream(response, profile, onDelta, locale = i18n(DEFAULT_SETTINGS)) {
  let content = "";
  await readSseEvents(response, profile, async ({ data }) => {
    if (data === "[DONE]") {
      return false;
    }

    const chunk = parseStreamJson(data, profile, response.url, locale);
    const delta = chunk?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("") || "";
    if (delta) {
      content += delta;
      onDelta(delta);
    }
    return true;
  }, locale);

  if (!content.trim()) {
    throw new Error(locale.t("background.error.geminiStreamNoText"));
  }
  return content.trim();
}

async function readSseEvents(response, profile, onEvent, locale = i18n(DEFAULT_SETTINGS)) {
  if (!response.ok) {
    await readJsonResponse(response, profile, locale);
    return;
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    throw new Error(locale.t("background.error.streamUnsupported", {
      target: getApiTargetLabel(profile, response.url)
    }));
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const result = await consumeSseBuffer(buffer, onEvent);
    if (result.done) {
      return;
    }
    buffer = result.buffer;
  }

  buffer += decoder.decode();
  const remaining = buffer.trim();
  if (remaining) {
    await consumeSseBlock(remaining, onEvent);
  }
}

async function consumeSseBuffer(input, onEvent) {
  let buffer = input.replace(/\r\n/g, "\n");
  let boundary = buffer.indexOf("\n\n");

  while (boundary >= 0) {
    const block = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    const shouldContinue = await consumeSseBlock(block, onEvent);
    if (!shouldContinue) {
      return { buffer, done: true };
    }
    boundary = buffer.indexOf("\n\n");
  }

  return { buffer, done: false };
}

async function consumeSseBlock(block, onEvent) {
  const lines = String(block || "").split("\n");
  let event = "message";
  const data = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice(6).trim() || event;
      continue;
    }
    if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
    }
  }

  if (data.length) {
    return await onEvent({ event, data: data.join("\n") }) !== false;
  }
  return true;
}

function parseStreamJson(data, profile, endpoint, locale = i18n(DEFAULT_SETTINGS)) {
  try {
    return JSON.parse(data);
  } catch (_error) {
    throw new Error(locale.t("background.error.invalidStreamJson", {
      target: getApiTargetLabel(profile, endpoint),
      text: String(data).slice(0, 240)
    }));
  }
}

async function fetchModel(url, options, profile, locale = i18n(DEFAULT_SETTINGS), requestOptions = {}) {
  assertSafeModelEndpoint(url, locale);
  const controller = new AbortController();
  const timeoutMs = normalizeTimeoutMs(requestOptions.timeoutMs);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    const target = getApiTargetLabel(profile, url);
    if (error?.name === "AbortError") {
      throw new Error(locale.t("background.error.timeout", {
        seconds: Math.round(timeoutMs / 1000),
        target
      }));
    }
    if (error instanceof TypeError || error?.name === "TypeError") {
      throw new Error(locale.t("background.error.network", {
        target,
        message: error.message || "Failed to fetch"
      }));
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readJsonResponse(response, profile, locale = i18n(DEFAULT_SETTINGS)) {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(locale.t("background.error.nonJson", {
      target: getApiTargetLabel(profile, response.url),
      text: text.slice(0, 240)
    }));
  }

  if (!response.ok) {
    const message = data?.error?.message || data?.message || response.statusText;
    throw new Error(readableHttpError({ status: response.status, message, locale }));
  }

  return data;
}

function readableHttpError({ status, message, locale = i18n(DEFAULT_SETTINGS) }) {
  const text = String(message || "");
  if (isRiskControlMessage(text)) {
    return locale.t("background.error.highRisk");
  }
  return locale.t("background.error.http", {
    status,
    message: text || "Request failed"
  });
}

function isRiskControlMessage(message) {
  return /high risk|risk control|rejected because|安全|风控|风险|敏感/i.test(String(message || ""));
}

async function readProxyJsonText(response, profile, locale = i18n(DEFAULT_SETTINGS)) {
  const data = await readJsonResponse(response, profile, locale);
  const content = data?.text
    || data?.summary
    || data?.output
    || data?.choices?.[0]?.message?.content
    || data?.choices?.[0]?.text;
  if (!content) {
    throw new Error(locale.t("background.error.proxyNoText"));
  }
  return String(content).trim();
}

function getModelEndpoint(profile) {
  if (profile?.provider === "gemini" && !profile.endpoint) {
    const model = profile.model || "gemini-pro";
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  }
  if (profile?.provider === "anthropic" && !profile.endpoint) {
    return "https://api.anthropic.com/v1/messages";
  }
  return profile?.endpoint || "";
}

function getProfileApiKey(profile) {
  return String(profile?.apiKey || profile?.accessToken || "");
}

function getModelDisplayName(profile, locale = i18n(DEFAULT_SETTINGS)) {
  return profile?.model || profile?.name || locale.t("background.label.defaultModel");
}

function getProviderDisplayName(profile, locale = i18n(DEFAULT_SETTINGS)) {
  const key = {
    proxy: "background.provider.proxy",
    "openai-compatible": "background.provider.openai",
    anthropic: "background.provider.anthropic",
    gemini: "background.provider.gemini",
    ollama: "background.provider.ollama"
  }[profile?.provider];
  return key ? locale.t(key) : profile?.provider || "";
}

function shouldDisableKimiThinking(profile) {
  const model = String(profile?.model || "").toLowerCase();
  const endpoint = String(profile?.endpoint || "").toLowerCase();
  return endpoint.includes("moonshot") && (model === "kimi-k2.6" || model === "kimi-k2.5");
}

function getRequestTimeoutMs(settings) {
  return normalizeTimeoutMs(Number(settings?.requestTimeoutSeconds) * 1000);
}

function normalizeTimeoutMs(value) {
  return clampNumber(value, DEFAULT_REQUEST_TIMEOUT_MS, 30000, 600000);
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

function validateCaptionFetchUrl(rawUrl, sender, locale = i18n(DEFAULT_SETTINGS)) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return null;
  }

  let url = null;
  try {
    url = new URL(rawUrl);
  } catch (_error) {
    throw new Error(locale.t("background.error.fetchUrlMissing"));
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(locale.t("background.error.unsafeFetchUrl"));
  }

  const senderUrl = parseUrl(sender?.tab?.url);
  const sameSenderHost = senderUrl?.hostname && normalizeHostname(senderUrl.hostname) === normalizeHostname(url.hostname);
  if (url.protocol === "http:" && !sameSenderHost && !isLoopbackHostname(url.hostname)) {
    throw new Error(locale.t("background.error.unsafeFetchUrl"));
  }
  if (isPrivateNetworkHostname(url.hostname) && !sameSenderHost) {
    throw new Error(locale.t("background.error.privateFetchUrl"));
  }

  return url;
}

function shouldIncludeFetchCredentials(url, sender) {
  const senderUrl = parseUrl(sender?.tab?.url);
  if (!senderUrl?.hostname || !url?.hostname) {
    return false;
  }

  const senderHost = normalizeHostname(senderUrl.hostname);
  const targetHost = normalizeHostname(url.hostname);
  if (senderHost === targetHost) {
    return true;
  }

  const senderSite = getCredentialSite(senderHost);
  return Boolean(senderSite && senderSite === getCredentialSite(targetHost));
}

function getCredentialSite(hostname) {
  const host = normalizeHostname(hostname);
  const sites = [
    "bilibili.com",
    "youtube.com",
    "vimeo.com",
    "ted.com"
  ];
  return sites.find((site) => host === site || host.endsWith(`.${site}`)) || "";
}

function assertSafeModelEndpoint(rawUrl, locale = i18n(DEFAULT_SETTINGS)) {
  const url = parseUrl(rawUrl);
  if (!url) {
    throw new Error(locale.t("background.error.noEndpoint"));
  }
  if (url.protocol === "https:") {
    return;
  }
  if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) {
    return;
  }
  throw new Error(locale.t("background.error.unsafeEndpoint"));
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

function isPrivateNetworkHostname(hostname) {
  const host = normalizeHostname(hostname);
  if (isLoopbackHostname(host) || host === "0.0.0.0" || host.endsWith(".local")) {
    return true;
  }

  const parts = host.split(".").map((part) => Number(part));
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return parts[0] === 10
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
  }

  return host.startsWith("fc")
    || host.startsWith("fd")
    || host.startsWith("fe80:");
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
    output = output.split(term).join(i18n(settings).t("background.redacted"));
  }

  if (!settings.includeTimestamps) {
    output = output.replace(/^\s*\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*/gm, "");
  }

  return output;
}

function renderTemplate(template, variables) {
  const locale = i18n({ uiLanguage: variables?.uiLanguage });
  const source = template || DEFAULT_SETTINGS.promptTemplate;
  const withOutput = source.includes("{{outputTemplate}}")
    ? source
    : `${source}\n\n${locale.t("background.render.outputRequirement")}\n{{outputTemplate}}`;

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

function createSummaryStreamNotifier(sender, streamId) {
  let buffer = "";
  let timer = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const delta = buffer;
    buffer = "";
    if (delta) {
      notifySummaryStream(sender, { streamId, delta });
    }
  };

  return {
    push(delta) {
      buffer += String(delta || "");
      if (!timer) {
        timer = setTimeout(flush, 16);
      }
    },
    flush
  };
}

async function notifySummaryStream(sender, event) {
  const tabId = sender?.tab?.id;
  if (!tabId || !event?.streamId || !event.delta) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "VCS_SUMMARY_STREAM",
      streamId: event.streamId,
      delta: event.delta
    });
  } catch (_error) {
    // The tab may have navigated while the model request was streaming.
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
  normalized.uiLanguage = globalThis.VCS_I18N.normalizeUiLanguage(normalized.uiLanguage);
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
  normalized.chunkSize = clampNumber(normalized.chunkSize, DEFAULT_SETTINGS.chunkSize, 2000, 50000);
  normalized.chunkOverlap = clampNumber(normalized.chunkOverlap, DEFAULT_SETTINGS.chunkOverlap, 0, 5000);
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
  const rawProvider = String(source.provider || DEFAULT_SETTINGS.profiles[0].provider || "openai-compatible");
  const isLocalOpenAI = rawProvider === "ollama"
    || (rawProvider === "openai-compatible" && isLoopbackEndpoint(source.endpoint));
  const supportedProviders = ["proxy", "openai-compatible", "anthropic", "gemini", "ollama"];
  const provider = isLocalOpenAI
    ? "ollama"
    : (supportedProviders.includes(rawProvider) ? rawProvider : "openai-compatible");
  const fallback = getProviderFallback(provider);
  const temperature = importedVersion < 3 && Number(source.temperature) === 0.2
    ? 1
    : source.temperature;

  return {
    id: String(source.id || fallback.id || `profile-${index + 1}`),
    name: String(source.name || fallback.name || `Profile ${index + 1}`),
    provider,
    endpoint: String(source.endpoint || fallback.endpoint || ""),
    apiKey: String(source.apiKey || (!["proxy", "ollama"].includes(provider) ? source.accessToken || "" : "")),
    accessToken: String(provider === "proxy" ? source.accessToken || "" : ""),
    model: String(source.model || fallback.model || ""),
    temperature: clampNumber(temperature, 1, 0, 2),
    maxTokens: clampNumber(source.maxTokens, 4096, 256, 32000)
  };
}

function getProviderFallback(provider) {
  const fallbacks = {
    proxy: {
      id: "proxy",
      name: "专用服务",
      provider: "proxy",
      endpoint: ""
    },
    "openai-compatible": DEFAULT_SETTINGS.profiles[0],
    anthropic: {
      id: "claude",
      name: "Claude",
      provider: "anthropic",
      endpoint: "https://api.anthropic.com/v1/messages"
    },
    gemini: {
      id: "gemini",
      name: "Gemini",
      provider: "gemini",
      endpoint: ""
    },
    ollama: {
      id: "ollama",
      name: "Ollama Local",
      provider: "ollama",
      endpoint: "http://localhost:11434/v1/chat/completions"
    }
  };
  return fallbacks[provider] || DEFAULT_SETTINGS.profiles[0];
}

function isLoopbackEndpoint(endpoint) {
  const url = parseUrl(endpoint);
  return Boolean(url && url.protocol === "http:" && isLoopbackHostname(url.hostname));
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
