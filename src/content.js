(() => {
  const PANEL_ID = "vcs-root";
  const DEFAULT_SETTINGS = {
    theme: "auto",
    language: "中文（简体）",
    activeProfileId: "deepseek",
    panelEnabled: true,
    includeTimestamps: true
  };

  const state = {
    settings: DEFAULT_SETTINGS,
    mounted: false,
    collapsed: false,
    platform: null,
    title: "",
    tracks: [],
    selectedTrackId: "",
    transcript: "",
    lastSummary: "",
    status: "正在检测视频字幕",
    statusTone: "neutral",
    progress: null
  };

  let root = null;
  let shadow = null;
  let lastUrl = location.href;
  let refreshTimer = null;

  init();

  async function init() {
    state.settings = await loadSettings();
    if (state.settings.panelEnabled === false) {
      return;
    }

    maybeMount();
    observeNavigation();
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "VCS_GET_STATUS") {
        sendResponse({
          ok: true,
          payload: {
            mounted: state.mounted,
            platform: state.platform?.name || "Unknown",
            tracks: state.tracks.length,
            title: state.title
          }
        });
        return true;
      }

      if (message?.type === "VCS_TOGGLE_PANEL") {
        if (!state.mounted) {
          maybeMount(true);
        }
        state.collapsed = !state.collapsed;
        render();
        sendResponse({ ok: true });
        return true;
      }

      if (message?.type === "VCS_SUMMARIZE_NOW") {
        summarize().then(
          () => sendResponse({ ok: true }),
          (error) => sendResponse({ ok: false, error: error.message })
        );
        return true;
      }

      if (message?.type === "VCS_PROGRESS") {
        const progress = message.progress;
        setStatus(progress?.label || "正在处理", "busy", progress);
        return false;
      }

      return false;
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.vcsSettings) {
        state.settings = {
          ...DEFAULT_SETTINGS,
          ...changes.vcsSettings.newValue
        };
        applyTheme();
        render();
      }
    });
  }

  async function loadSettings() {
    const result = await chrome.storage.local.get("vcsSettings");
    return {
      ...DEFAULT_SETTINGS,
      ...(result.vcsSettings || {})
    };
  }

  function observeNavigation() {
    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        scheduleRefresh();
      } else if (!state.mounted && shouldShowPanel()) {
        scheduleRefresh();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        scheduleRefresh();
      }
    }, 1000);
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      state.tracks = [];
      state.transcript = "";
      state.lastSummary = "";
      maybeMount();
      refreshTracks();
    }, 450);
  }

  function shouldShowPanel() {
    const platform = detectPlatform();
    return Boolean(platform || document.querySelector("video"));
  }

  function maybeMount(force = false) {
    if (!force && !shouldShowPanel()) {
      return;
    }

    const wasMounted = state.mounted;
    if (!root) {
      root = document.createElement("div");
      root.id = PANEL_ID;
      root.dataset.extensionId = chrome.runtime.id;
      document.documentElement.appendChild(root);
      shadow = root.attachShadow({ mode: "open" });
    }

    state.mounted = true;
    render();
    if (!wasMounted) {
      refreshTracks();
    }
  }

  async function refreshTracks() {
    state.platform = detectPlatform() || {
      id: "generic",
      name: "Generic Video",
      kind: "generic"
    };
    state.title = getVideoTitle();
    state.status = "正在读取字幕轨道";
    state.statusTone = "busy";
    state.progress = null;
    render();

    try {
      const tracks = await getTracksForPlatform(state.platform);
      state.tracks = tracks;
      state.selectedTrackId = tracks[0]?.id || "";
      state.status = tracks.length
        ? `已发现 ${tracks.length} 条字幕轨道`
        : "没有发现可直接读取的字幕，可粘贴字幕后总结";
      state.statusTone = tracks.length ? "done" : "neutral";
    } catch (error) {
      state.tracks = [];
      state.status = `字幕读取失败：${error.message}`;
      state.statusTone = "error";
    }

    render();
  }

  function detectPlatform() {
    const host = location.hostname.replace(/^www\./, "");
    if (host.includes("youtube.com") || host === "youtu.be") {
      return { id: "youtube", name: "YouTube", kind: "youtube" };
    }
    if (host.includes("bilibili.com")) {
      return { id: "bilibili", name: "Bilibili", kind: "bilibili" };
    }
    if (host.includes("vimeo.com")) {
      return { id: "vimeo", name: "Vimeo", kind: "generic" };
    }
    if (host.includes("coursera.org")) {
      return { id: "coursera", name: "Coursera", kind: "generic" };
    }
    if (host.includes("ted.com")) {
      return { id: "ted", name: "TED", kind: "generic" };
    }
    if (document.querySelector("video")) {
      return { id: "generic", name: "Generic Video", kind: "generic" };
    }
    return null;
  }

  async function getTracksForPlatform(platform) {
    if (platform.kind === "youtube") {
      const tracks = getYouTubeTracks();
      if (tracks.length) {
        return tracks;
      }
    }

    if (platform.kind === "bilibili") {
      const tracks = await getBilibiliTracks();
      if (tracks.length) {
        return tracks;
      }
    }

    const htmlTracks = getHtml5Tracks();
    if (htmlTracks.length) {
      return htmlTracks;
    }

    const visibleTranscript = getVisibleTranscript();
    if (visibleTranscript) {
      return [
        {
          id: "visible-transcript",
          label: "页面可见字幕 / Transcript",
          language: "auto",
          source: "visible",
          text: visibleTranscript
        }
      ];
    }

    return [];
  }

  function getYouTubeTracks() {
    const response = getJsonAssignment("ytInitialPlayerResponse");
    const captionTracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    return captionTracks.map((track, index) => ({
      id: `youtube-${index}`,
      label: getLabelText(track.name) || track.languageCode || `Caption ${index + 1}`,
      language: track.languageCode || "auto",
      source: "youtube",
      url: track.baseUrl
    }));
  }

  async function getBilibiliTracks() {
    const initialState = getJsonAssignment("__INITIAL_STATE__") || {};
    const videoData = initialState.videoData || initialState.videoInfo || {};
    const bvid = videoData.bvid || initialState.bvid || getBvidFromUrl();
    const aid = videoData.aid || initialState.aid;
    const cid = videoData.cid || initialState.cid || getCidFromPage(initialState);

    if (!cid || (!bvid && !aid)) {
      return [];
    }

    const api = new URL("https://api.bilibili.com/x/player/v2");
    api.searchParams.set("cid", cid);
    if (bvid) {
      api.searchParams.set("bvid", bvid);
    } else {
      api.searchParams.set("aid", aid);
    }

    const response = await extensionFetch(api.toString());
    const data = JSON.parse(response.text);
    const subtitles = data?.data?.subtitle?.subtitles || [];

    return subtitles
      .filter((item) => item.subtitle_url)
      .map((item, index) => ({
        id: `bilibili-${index}`,
        label: item.lan_doc || item.lan || `Subtitle ${index + 1}`,
        language: item.lan || "auto",
        source: "bilibili",
        url: normalizeUrl(item.subtitle_url)
      }));
  }

  function getHtml5Tracks() {
    return [...document.querySelectorAll("video track[src], track[kind='subtitles'][src], track[kind='captions'][src]")]
      .filter((track) => track.src)
      .map((track, index) => ({
        id: `html5-${index}`,
        label: track.label || track.srclang || track.kind || `Track ${index + 1}`,
        language: track.srclang || "auto",
        source: "html5",
        url: track.src
      }));
  }

  async function loadSelectedTranscript() {
    const manual = getManualTranscript();
    if (manual) {
      return manual;
    }

    const track = state.tracks.find((item) => item.id === state.selectedTrackId) || state.tracks[0];
    if (!track) {
      const visibleTranscript = getVisibleTranscript();
      if (visibleTranscript) {
        return visibleTranscript;
      }
      throw new Error("没有可用字幕。你可以在面板底部粘贴字幕文本。");
    }

    if (track.text) {
      return track.text;
    }

    if (track.source === "youtube") {
      const url = addQueryParam(track.url, "fmt", "json3");
      const response = await extensionFetch(url);
      return parseYouTubeTranscript(response.text);
    }

    if (track.source === "bilibili") {
      const response = await extensionFetch(track.url);
      return parseBilibiliTranscript(response.text);
    }

    if (track.source === "html5") {
      const response = await extensionFetch(track.url);
      return parseTextTrack(response.text);
    }

    if (track.source === "visible") {
      return track.text;
    }

    throw new Error(`不支持的字幕来源：${track.source}`);
  }

  async function extensionFetch(url) {
    const response = await chrome.runtime.sendMessage({
      type: "VCS_FETCH_TEXT",
      url
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Fetch failed.");
    }

    return response.payload;
  }

  async function summarize() {
    try {
      setStatus("正在准备字幕", "busy");
      const transcript = await loadSelectedTranscript();
      state.transcript = transcript;
      render();

      setStatus("正在请求 AI 总结", "busy");
      const response = await chrome.runtime.sendMessage({
        type: "VCS_SUMMARIZE",
        payload: {
          title: state.title,
          platform: state.platform?.name || "Unknown",
          url: location.href,
          transcript
        }
      });

      if (!response?.ok) {
        throw new Error(response?.error || "总结失败。");
      }

      state.lastSummary = response.payload.text;
      setStatus(`完成：${response.payload.provider} / ${response.payload.model}`, "done");
      render();
    } catch (error) {
      setStatus(error.message, "error");
      render();
    }
  }

  function getManualTranscript() {
    return shadow?.querySelector("#vcs-manual")?.value.trim() || "";
  }

  function setStatus(message, tone = "neutral", progress = null) {
    state.status = message;
    state.statusTone = tone;
    state.progress = progress;
    const status = shadow?.querySelector("#vcs-status");
    if (status) {
      status.textContent = message;
      status.dataset.tone = tone;
    }
    const bar = shadow?.querySelector("#vcs-progress-bar");
    if (bar) {
      const percent = progress?.total ? Math.round((progress.current / progress.total) * 100) : 0;
      bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    }
  }

  function render() {
    if (!shadow) {
      return;
    }

    const trackOptions = state.tracks.map((track) => {
      const selected = track.id === state.selectedTrackId ? "selected" : "";
      return `<option value="${escapeHtml(track.id)}" ${selected}>${escapeHtml(track.label)}</option>`;
    }).join("");
    const activeProfile = getActiveProfileLabel();
    const progressWidth = state.progress?.total
      ? Math.round((state.progress.current / state.progress.total) * 100)
      : 0;
    const summarizeLabel = state.statusTone === "busy" ? "Summarizing..." : "Ask AI to Summarize";

    shadow.innerHTML = `
      <style>${getPanelCss()}</style>
      <aside class="vcs-panel ${state.collapsed ? "is-collapsed" : ""}" data-theme="${getTheme()}" data-tone="${escapeHtml(state.statusTone)}">
        <header class="vcs-header">
          <div class="vcs-brand">
            <div class="vcs-mark" aria-hidden="true"><span>AI</span></div>
            <div>
              <div class="vcs-title">Video Caption AI</div>
              <div class="vcs-subtitle">${escapeHtml(state.platform?.name || "Video page")}</div>
            </div>
          </div>
          <div class="vcs-actions">
            <button id="vcs-refresh" class="vcs-icon-button" title="重新检测字幕" aria-label="重新检测字幕">${refreshIcon()}</button>
            <button id="vcs-options" class="vcs-icon-button" title="打开设置" aria-label="打开设置">${settingsIcon()}</button>
            <button id="vcs-collapse" class="vcs-icon-button" title="折叠面板" aria-label="折叠面板">${chevronIcon()}</button>
          </div>
        </header>

        <div class="vcs-collapsed-tab">
          <button id="vcs-expand" type="button">AI Summary</button>
        </div>

        <section class="vcs-body">
          <div class="vcs-chip-row" aria-label="视频摘要状态">
            <span class="vcs-chip">${escapeHtml(state.platform?.name || "Video")}</span>
            <span class="vcs-chip">${state.tracks.length ? `${state.tracks.length} tracks` : "manual ready"}</span>
            <span class="vcs-chip">${escapeHtml(activeProfile)}</span>
          </div>

          <button id="vcs-summarize" class="vcs-primary" type="button">
            <span class="vcs-primary-glow" aria-hidden="true"></span>
            <span>${escapeHtml(summarizeLabel)}</span>
          </button>

          <div class="vcs-status-wrap">
            <div id="vcs-status" class="vcs-status" data-tone="${escapeHtml(state.statusTone)}">${escapeHtml(state.status)}</div>
            <div class="vcs-progress"><span id="vcs-progress-bar" style="width:${progressWidth}%"></span></div>
          </div>

          <label class="vcs-label" for="vcs-track">Transcript</label>
          <div class="vcs-row">
            <select id="vcs-track" class="vcs-select" ${state.tracks.length ? "" : "disabled"}>
              ${trackOptions || "<option>未发现字幕轨道</option>"}
            </select>
            <button id="vcs-copy-transcript" class="vcs-tool-button" type="button" title="复制字幕">${copyIcon()}</button>
          </div>

          <div class="vcs-meta">
            <span title="${escapeHtml(state.title)}">${escapeHtml(state.title || "Untitled video")}</span>
          </div>

          <details class="vcs-details">
            <summary>手动粘贴字幕</summary>
            <textarea id="vcs-manual" class="vcs-textarea" placeholder="如果当前平台无法自动读取字幕，可以把字幕或转写文本粘贴到这里。"></textarea>
          </details>

          <details class="vcs-details" ${state.transcript ? "open" : ""}>
            <summary>字幕预览</summary>
            <textarea id="vcs-preview" class="vcs-textarea" readonly>${escapeHtml(state.transcript)}</textarea>
          </details>

          <section class="vcs-result" ${state.lastSummary ? "" : "hidden"}>
            <div class="vcs-result-head">
              <span>Summary</span>
              <button id="vcs-copy-summary" class="vcs-tool-button" type="button" title="复制总结">${copyIcon()}</button>
            </div>
            <article id="vcs-summary">${markdownToHtml(state.lastSummary)}</article>
          </section>
        </section>
      </aside>
    `;

    bindEvents();
    applyTheme();
  }

  function bindEvents() {
    shadow.querySelector("#vcs-refresh")?.addEventListener("click", refreshTracks);
    shadow.querySelector("#vcs-options")?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "VCS_OPEN_OPTIONS" });
    });
    shadow.querySelector("#vcs-collapse")?.addEventListener("click", () => {
      state.collapsed = true;
      render();
    });
    shadow.querySelector("#vcs-expand")?.addEventListener("click", () => {
      state.collapsed = false;
      render();
    });
    shadow.querySelector("#vcs-track")?.addEventListener("change", (event) => {
      state.selectedTrackId = event.target.value;
    });
    shadow.querySelector("#vcs-summarize")?.addEventListener("click", summarize);
    shadow.querySelector("#vcs-copy-transcript")?.addEventListener("click", async () => {
      const text = state.transcript || await loadSelectedTranscript();
      state.transcript = text;
      await navigator.clipboard.writeText(text);
      setStatus("字幕已复制", "done");
      render();
    });
    shadow.querySelector("#vcs-copy-summary")?.addEventListener("click", async () => {
      await navigator.clipboard.writeText(state.lastSummary || "");
      setStatus("总结已复制", "done");
    });
  }

  function applyTheme() {
    const panel = shadow?.querySelector(".vcs-panel");
    if (panel) {
      panel.dataset.theme = getTheme();
    }
  }

  function getTheme() {
    if (state.settings.theme === "dark") {
      return "dark";
    }
    if (state.settings.theme === "light") {
      return "light";
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function getActiveProfileLabel() {
    const profiles = Array.isArray(state.settings.profiles) ? state.settings.profiles : [];
    const profile = profiles.find((item) => item.id === state.settings.activeProfileId) || profiles[0];
    if (!profile) {
      return "AI model";
    }
    return profile.model || profile.name || "AI model";
  }

  function getVideoTitle() {
    if (state.platform?.kind === "youtube") {
      return document.querySelector("h1.ytd-watch-metadata yt-formatted-string")?.textContent?.trim()
        || document.querySelector("h1.title")?.textContent?.trim()
        || document.title.replace(/ - YouTube$/, "").trim();
    }

    if (state.platform?.kind === "bilibili") {
      const initialState = getJsonAssignment("__INITIAL_STATE__") || {};
      return initialState.videoData?.title
        || document.querySelector(".video-title")?.textContent?.trim()
        || document.title.replace(/_哔哩哔哩_bilibili$/, "").trim();
    }

    return document.querySelector("h1")?.textContent?.trim() || document.title.trim();
  }

  function getJsonAssignment(name) {
    for (const script of document.scripts) {
      const text = script.textContent || "";
      const markerIndex = text.indexOf(name);
      if (markerIndex === -1) {
        continue;
      }
      const equalsIndex = text.indexOf("=", markerIndex);
      if (equalsIndex === -1) {
        continue;
      }
      const json = extractBalancedJson(text, equalsIndex + 1);
      if (!json) {
        continue;
      }
      try {
        return JSON.parse(json);
      } catch (_error) {
        continue;
      }
    }
    return null;
  }

  function extractBalancedJson(text, startIndex) {
    const firstBrace = text.indexOf("{", startIndex);
    if (firstBrace === -1) {
      return "";
    }

    let depth = 0;
    let inString = false;
    let quote = "";
    let escaped = false;

    for (let index = firstBrace; index < text.length; index += 1) {
      const char = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          inString = false;
          quote = "";
        }
        continue;
      }

      if (char === "\"" || char === "'") {
        inString = true;
        quote = char;
        continue;
      }

      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          return text.slice(firstBrace, index + 1);
        }
      }
    }

    return "";
  }

  function getBvidFromUrl() {
    const match = location.pathname.match(/\/video\/(BV[\w]+)/i);
    return match?.[1] || "";
  }

  function getCidFromPage(initialState) {
    const pages = initialState.videoData?.pages || [];
    const page = pages.find((item) => String(item.page) === new URLSearchParams(location.search).get("p"));
    return page?.cid || pages[0]?.cid || "";
  }

  function getVisibleTranscript() {
    const selectors = [
      "[class*='transcript' i]",
      "[id*='transcript' i]",
      "[class*='subtitle' i]",
      "[class*='caption' i]",
      "[aria-label*='Transcript' i]",
      "[aria-label*='字幕' i]"
    ];

    const candidates = [];
    for (const selector of selectors) {
      try {
        candidates.push(...document.querySelectorAll(selector));
      } catch (_error) {
        // Some pages use selectors unsupported by the current browser.
      }
    }

    const text = candidates
      .filter((element) => !root?.contains(element) && isVisible(element))
      .map((element) => element.innerText || element.textContent || "")
      .map((value) => value.trim())
      .filter((value) => value.length > 120)
      .sort((a, b) => b.length - a.length)[0];

    return text || "";
  }

  function parseYouTubeTranscript(text) {
    try {
      const json = JSON.parse(text);
      const lines = (json.events || [])
        .filter((event) => Array.isArray(event.segs))
        .map((event) => {
          const start = formatSeconds((event.tStartMs || 0) / 1000);
          const content = event.segs.map((seg) => seg.utf8 || "").join("").replace(/\s+/g, " ").trim();
          return content ? `[${start}] ${content}` : "";
        })
        .filter(Boolean);
      if (lines.length) {
        return lines.join("\n");
      }
    } catch (_error) {
      // Fall back to XML parsing below.
    }

    const xml = new DOMParser().parseFromString(text, "text/xml");
    const lines = [...xml.querySelectorAll("text")]
      .map((node) => {
        const start = formatSeconds(Number(node.getAttribute("start")) || 0);
        const content = node.textContent.replace(/\s+/g, " ").trim();
        return content ? `[${start}] ${content}` : "";
      })
      .filter(Boolean);
    return lines.join("\n");
  }

  function parseBilibiliTranscript(text) {
    const json = JSON.parse(text);
    const lines = (json.body || [])
      .map((item) => {
        const start = formatSeconds(Number(item.from) || 0);
        const content = String(item.content || "").replace(/\s+/g, " ").trim();
        return content ? `[${start}] ${content}` : "";
      })
      .filter(Boolean);
    return lines.join("\n");
  }

  function parseTextTrack(text) {
    const clean = text.replace(/^\uFEFF/, "").replace(/\r/g, "");
    const blocks = clean.split(/\n{2,}/);
    const lines = [];

    for (const block of blocks) {
      const rows = block.split("\n").map((row) => row.trim()).filter(Boolean);
      const timing = rows.find((row) => row.includes("-->"));
      if (!timing) {
        continue;
      }
      const startText = timing.split("-->")[0].trim();
      const start = formatSeconds(parseTimestamp(startText));
      const content = rows
        .slice(rows.indexOf(timing) + 1)
        .join(" ")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (content) {
        lines.push(`[${start}] ${content}`);
      }
    }

    return lines.join("\n") || clean;
  }

  function parseTimestamp(value) {
    const parts = value.replace(",", ".").split(":").map(Number);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return Number(value) || 0;
  }

  function formatSeconds(totalSeconds) {
    const total = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours) {
      return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${minutes}:${pad(seconds)}`;
  }

  function addQueryParam(url, key, value) {
    const next = new URL(url, location.href);
    next.searchParams.set(key, value);
    return next.toString();
  }

  function normalizeUrl(url) {
    if (url.startsWith("//")) {
      return `${location.protocol}${url}`;
    }
    return new URL(url, location.href).toString();
  }

  function getLabelText(label) {
    if (!label) {
      return "";
    }
    if (label.simpleText) {
      return label.simpleText;
    }
    if (Array.isArray(label.runs)) {
      return label.runs.map((run) => run.text || "").join("");
    }
    return "";
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function markdownToHtml(markdown) {
    const lines = String(markdown || "").split("\n");
    const html = [];
    let paragraph = [];
    let inList = false;

    const flushParagraph = () => {
      if (paragraph.length) {
        html.push(`<p>${paragraph.join("<br>")}</p>`);
        paragraph = [];
      }
    };

    const closeList = () => {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line) {
        flushParagraph();
        closeList();
        continue;
      }

      if (line.startsWith("### ")) {
        flushParagraph();
        closeList();
        html.push(`<h4>${escapeHtml(line.slice(4))}</h4>`);
        continue;
      }

      if (line.startsWith("## ")) {
        flushParagraph();
        closeList();
        html.push(`<h3>${escapeHtml(line.slice(3))}</h3>`);
        continue;
      }

      if (line.startsWith("- ")) {
        flushParagraph();
        if (!inList) {
          html.push("<ul>");
          inList = true;
        }
        html.push(`<li>${escapeHtml(line.slice(2))}</li>`);
        continue;
      }

      closeList();
      paragraph.push(escapeHtml(line));
    }

    flushParagraph();
    closeList();
    return html.join("");
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function refreshIcon() {
    return "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M20 6v5h-5'/><path d='M4 18v-5h5'/><path d='M6.1 9A7 7 0 0 1 18 6.4L20 11'/><path d='M17.9 15A7 7 0 0 1 6 17.6L4 13'/></svg>";
  }

  function settingsIcon() {
    return "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z'/><path d='M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z'/></svg>";
  }

  function chevronIcon() {
    return "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='m18 15-6-6-6 6'/></svg>";
  }

  function copyIcon() {
    return "<svg viewBox='0 0 24 24' aria-hidden='true'><rect x='9' y='9' width='13' height='13' rx='2'/><path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'/></svg>";
  }

  function getPanelCss() {
    return `
      :host { all: initial; }
      * { box-sizing: border-box; }
      .vcs-panel {
        --bg: rgba(248, 250, 252, 0.72);
        --surface: rgba(255, 255, 255, 0.86);
        --surface-strong: rgba(255, 255, 255, 0.96);
        --text: #111827;
        --muted: #647084;
        --line: rgba(137, 150, 171, 0.34);
        --line-strong: rgba(91, 109, 138, 0.42);
        --primary: #5b5ff5;
        --primary-strong: #4238c9;
        --cyan: #0e9f9a;
        --good: #087f6f;
        --bad: #bf2f45;
        --shadow: 0 28px 90px rgba(15, 23, 42, 0.24), 0 8px 24px rgba(15, 23, 42, 0.12);
        position: fixed;
        top: 80px;
        right: 18px;
        z-index: 2147483647;
        width: min(430px, calc(100vw - 36px));
        max-height: calc(100vh - 112px);
        overflow: hidden;
        color: var(--text);
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0.9)),
          radial-gradient(circle at 16% 0%, rgba(91, 95, 245, 0.16), transparent 28%),
          var(--surface);
        border: 1px solid var(--line);
        border-radius: 16px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(22px) saturate(1.25);
        -webkit-backdrop-filter: blur(22px) saturate(1.25);
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        animation: vcs-panel-in 280ms cubic-bezier(.2,.8,.2,1);
        transform-origin: top right;
      }
      .vcs-panel::before {
        content: "";
        position: absolute;
        inset: 0 0 auto;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(91, 95, 245, 0.72), rgba(14, 159, 154, 0.72), transparent);
        pointer-events: none;
      }
      .vcs-panel[data-theme="dark"] {
        --bg: rgba(16, 22, 33, 0.74);
        --surface: rgba(19, 25, 38, 0.86);
        --surface-strong: rgba(23, 31, 46, 0.96);
        --text: #f6f8fb;
        --muted: #a9b3c3;
        --line: rgba(148, 163, 184, 0.22);
        --line-strong: rgba(148, 163, 184, 0.34);
        --primary: #8b8cff;
        --primary-strong: #7470f8;
        --cyan: #28d7cb;
        --good: #36d5bf;
        --bad: #fb7185;
        --shadow: 0 32px 96px rgba(0, 0, 0, 0.46), 0 10px 32px rgba(0, 0, 0, 0.28);
        background:
          linear-gradient(180deg, rgba(18, 24, 37, 0.72), rgba(17, 24, 39, 0.92)),
          radial-gradient(circle at 16% 0%, rgba(139, 140, 255, 0.2), transparent 30%),
          var(--surface);
      }
      .vcs-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 15px 15px 13px;
        border-bottom: 1px solid var(--line);
        background:
          linear-gradient(180deg, var(--surface-strong), var(--bg));
      }
      .vcs-brand {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .vcs-mark {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        flex: 0 0 auto;
        color: #fff;
        background:
          linear-gradient(145deg, rgba(255, 255, 255, 0.2), transparent 42%),
          linear-gradient(135deg, var(--primary), var(--cyan));
        border: 1px solid rgba(255, 255, 255, 0.34);
        border-radius: 12px;
        box-shadow: 0 10px 28px rgba(91, 95, 245, 0.28);
        font-weight: 780;
        letter-spacing: 0;
      }
      .vcs-mark span {
        transform: translateY(-.5px);
      }
      .vcs-title {
        color: var(--text);
        font-size: 14.5px;
        font-weight: 760;
        white-space: nowrap;
      }
      .vcs-subtitle, .vcs-meta {
        color: var(--muted);
        font-size: 12px;
        min-width: 0;
      }
      .vcs-actions, .vcs-row, .vcs-result-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .vcs-icon-button, .vcs-tool-button {
        display: inline-grid;
        place-items: center;
        width: 32px;
        height: 32px;
        padding: 0;
        color: var(--muted);
        background: rgba(255, 255, 255, 0.34);
        border: 1px solid var(--line);
        border-radius: 10px;
        cursor: pointer;
        transition: transform 150ms ease, border-color 150ms ease, background 150ms ease, color 150ms ease;
      }
      .vcs-icon-button:hover, .vcs-tool-button:hover {
        color: var(--text);
        background: rgba(91, 95, 245, 0.1);
        border-color: var(--line-strong);
        transform: translateY(-1px);
      }
      .vcs-icon-button:active, .vcs-tool-button:active {
        transform: translateY(0) scale(0.98);
      }
      svg {
        width: 17px;
        height: 17px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .vcs-body {
        display: grid;
        gap: 13px;
        max-height: calc(100vh - 178px);
        overflow: auto;
        padding: 15px;
        background: linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.18));
      }
      .vcs-body::-webkit-scrollbar,
      #vcs-summary::-webkit-scrollbar,
      .vcs-textarea::-webkit-scrollbar {
        width: 10px;
        height: 10px;
      }
      .vcs-body::-webkit-scrollbar-thumb,
      #vcs-summary::-webkit-scrollbar-thumb,
      .vcs-textarea::-webkit-scrollbar-thumb {
        background: rgba(100, 112, 132, 0.26);
        border: 3px solid transparent;
        border-radius: 999px;
        background-clip: padding-box;
      }
      .vcs-chip-row {
        display: flex;
        gap: 7px;
        overflow: hidden;
      }
      .vcs-chip {
        min-width: 0;
        max-width: 142px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding: 5px 8px;
        color: var(--muted);
        background: rgba(255, 255, 255, 0.42);
        border: 1px solid var(--line);
        border-radius: 999px;
        font-size: 11.5px;
        font-weight: 680;
      }
      .vcs-primary {
        position: relative;
        display: grid;
        place-items: center;
        width: 100%;
        height: 46px;
        overflow: hidden;
        color: #fff;
        background:
          linear-gradient(135deg, var(--primary), var(--primary-strong) 56%, var(--cyan));
        border: 0;
        border-radius: 12px;
        box-shadow: 0 14px 32px rgba(91, 95, 245, 0.28);
        font-size: 14px;
        font-weight: 760;
        cursor: pointer;
        transition: transform 160ms ease, box-shadow 160ms ease, filter 160ms ease;
      }
      .vcs-primary span:last-child {
        position: relative;
        z-index: 1;
      }
      .vcs-primary-glow {
        position: absolute;
        inset: 0;
        background: linear-gradient(100deg, transparent 0%, rgba(255,255,255,.34) 42%, transparent 70%);
        transform: translateX(-120%);
        animation: vcs-shine 4.4s ease-in-out infinite;
      }
      .vcs-primary:hover {
        transform: translateY(-1px);
        box-shadow: 0 18px 40px rgba(91, 95, 245, 0.34);
        filter: saturate(1.04);
      }
      .vcs-primary:active {
        transform: translateY(0) scale(0.99);
      }
      .vcs-status-wrap {
        display: grid;
        gap: 7px;
        padding: 10px 11px;
        background: rgba(255, 255, 255, 0.36);
        border: 1px solid var(--line);
        border-radius: 12px;
      }
      .vcs-status {
        color: var(--muted);
        min-height: 20px;
        font-size: 12.5px;
      }
      .vcs-status[data-tone="busy"] { color: var(--primary); }
      .vcs-status[data-tone="done"] { color: var(--good); }
      .vcs-status[data-tone="error"] { color: var(--bad); }
      .vcs-progress {
        position: relative;
        height: 4px;
        overflow: hidden;
        background: rgba(91, 95, 245, 0.1);
        border-radius: 999px;
      }
      .vcs-progress span {
        display: block;
        width: 0;
        height: 100%;
        background: linear-gradient(90deg, var(--primary), var(--cyan), var(--good));
        border-radius: inherit;
        transition: width 220ms ease;
      }
      .vcs-panel[data-tone="busy"] .vcs-progress span {
        width: 45% !important;
        animation: vcs-indeterminate 1.25s ease-in-out infinite;
      }
      .vcs-label {
        color: var(--text);
        font-size: 12px;
        font-weight: 740;
      }
      .vcs-select {
        width: 100%;
        min-width: 0;
        height: 38px;
        padding: 0 11px;
        color: var(--text);
        background: var(--surface-strong);
        border: 1px solid var(--line);
        border-radius: 10px;
        outline: none;
      }
      .vcs-select:focus,
      .vcs-textarea:focus {
        border-color: rgba(14, 159, 154, 0.62);
        box-shadow: 0 0 0 3px rgba(14, 159, 154, 0.12);
      }
      .vcs-meta span {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vcs-details {
        border: 1px solid var(--line);
        border-radius: 12px;
        background: var(--bg);
        transition: border-color 160ms ease, background 160ms ease;
      }
      .vcs-details[open] {
        border-color: var(--line-strong);
        background: rgba(255, 255, 255, 0.42);
      }
      .vcs-details summary {
        padding: 10px 12px;
        color: var(--text);
        font-size: 12.5px;
        font-weight: 730;
        cursor: pointer;
        list-style: none;
      }
      .vcs-details summary::-webkit-details-marker { display: none; }
      .vcs-details summary::after {
        content: "";
        float: right;
        width: 8px;
        height: 8px;
        margin-top: 5px;
        border-right: 1.8px solid var(--muted);
        border-bottom: 1.8px solid var(--muted);
        transform: rotate(45deg);
        transition: transform 160ms ease;
      }
      .vcs-details[open] summary::after {
        transform: rotate(225deg) translate(-3px, -3px);
      }
      .vcs-textarea {
        display: block;
        width: calc(100% - 20px);
        min-height: 120px;
        margin: 0 10px 10px;
        padding: 10px;
        resize: vertical;
        color: var(--text);
        background: var(--surface-strong);
        border: 1px solid var(--line);
        border-radius: 10px;
        outline: none;
        font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .vcs-result {
        display: grid;
        gap: 10px;
        border-top: 1px solid var(--line);
        padding-top: 12px;
        animation: vcs-result-in 260ms ease;
      }
      .vcs-result[hidden] { display: none; }
      .vcs-result-head {
        justify-content: space-between;
        font-weight: 760;
      }
      #vcs-summary {
        color: var(--text);
        background: var(--surface-strong);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 13px;
        max-height: 340px;
        overflow: auto;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.42);
      }
      #vcs-summary h3, #vcs-summary h4 {
        margin: 13px 0 7px;
        font-size: 14px;
        line-height: 1.35;
      }
      #vcs-summary p {
        margin: 0 0 10px;
      }
      #vcs-summary ul {
        margin: 0 0 10px;
        padding-left: 18px;
      }
      .vcs-collapsed-tab { display: none; }
      .vcs-panel.is-collapsed {
        width: auto;
        border-radius: 999px;
        background: transparent;
        border-color: transparent;
        box-shadow: none;
        animation: vcs-tab-in 220ms ease;
      }
      .vcs-panel.is-collapsed .vcs-header,
      .vcs-panel.is-collapsed .vcs-body {
        display: none;
      }
      .vcs-panel.is-collapsed .vcs-collapsed-tab {
        display: block;
      }
      .vcs-collapsed-tab button {
        height: 42px;
        padding: 0 17px;
        color: #fff;
        background: linear-gradient(135deg, var(--primary), var(--cyan));
        border: 0;
        border-radius: 999px;
        font-weight: 760;
        cursor: pointer;
        box-shadow: 0 16px 34px rgba(91, 95, 245, 0.36);
      }
      @keyframes vcs-panel-in {
        from { opacity: 0; transform: translate3d(10px, -8px, 0) scale(.985); }
        to { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
      }
      @keyframes vcs-result-in {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes vcs-tab-in {
        from { opacity: .35; transform: translateX(8px) scale(.96); }
        to { opacity: 1; transform: translateX(0) scale(1); }
      }
      @keyframes vcs-shine {
        0%, 52% { transform: translateX(-120%); }
        72%, 100% { transform: translateX(120%); }
      }
      @keyframes vcs-indeterminate {
        0% { transform: translateX(-85%); }
        52% { transform: translateX(80%); }
        100% { transform: translateX(180%); }
      }
      @media (prefers-reduced-motion: reduce) {
        .vcs-panel,
        .vcs-result,
        .vcs-primary-glow,
        .vcs-panel[data-tone="busy"] .vcs-progress span {
          animation: none;
        }
        .vcs-primary,
        .vcs-icon-button,
        .vcs-tool-button {
          transition: none;
        }
      }
      @media (max-width: 720px) {
        .vcs-panel {
          top: auto;
          right: 10px;
          bottom: 10px;
          width: calc(100vw - 20px);
          max-height: min(78vh, 680px);
        }
        .vcs-body {
          max-height: calc(78vh - 66px);
        }
      }
    `;
  }
})();
