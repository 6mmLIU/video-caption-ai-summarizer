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
    embedded: false,
    collapsed: true,
    platform: null,
    title: "",
    tracks: [],
    selectedTrackId: "",
    transcript: "",
    lastSummary: "",
    status: "正在读取字幕",
    statusTone: "neutral",
    progress: null,
    refreshing: false,
    copyingTranscript: false,
    copyingSummary: false
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
        if (!shouldShowPanel()) {
          sendResponse({ ok: false, error: "当前不是视频播放页，面板不会自动显示。" });
          return true;
        }
        if (!state.mounted) {
          maybeMount();
        }
        state.collapsed = !state.collapsed;
        render();
        sendResponse({ ok: true });
        return true;
      }

      if (message?.type === "VCS_SUMMARIZE_NOW") {
        if (!shouldShowPanel()) {
          sendResponse({ ok: false, error: "当前不是视频播放页。" });
          return true;
        }
        if (!state.mounted) {
          maybeMount();
        }
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
      } else if (state.mounted && shouldShowPanel()) {
        placeRoot();
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
      state.platform = null;
      state.collapsed = true;
      if (shouldShowPanel()) {
        const wasMounted = state.mounted;
        maybeMount();
        if (wasMounted) {
          refreshTracks();
        }
      } else {
        unmount();
      }
    }, 450);
  }

  function shouldShowPanel() {
    return Boolean(detectPlatform());
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
      shadow = root.attachShadow({ mode: "open" });
    }

    placeRoot();

    state.mounted = true;
    render();
    if (!wasMounted) {
      refreshTracks();
    }
  }

  function unmount() {
    if (root?.parentElement) {
      root.remove();
    }
    state.mounted = false;
    state.embedded = false;
    state.platform = null;
  }

  function placeRoot() {
    const target = findEmbedTarget();
    if (target && root.parentElement !== target) {
      if (target === document.documentElement) {
        target.appendChild(root);
      } else {
        target.insertBefore(root, target.firstChild);
      }
      state.embedded = target !== document.documentElement;
    } else if (!root.parentElement) {
      document.documentElement.appendChild(root);
      state.embedded = false;
    }
  }

  function findEmbedTarget() {
    const host = location.hostname.replace(/^www\./, "");
    if (host.includes("youtube.com")) {
      return document.querySelector("#secondary-inner")
        || document.querySelector("#secondary")
        || document.documentElement;
    }
    if (host.includes("bilibili.com")) {
      return document.querySelector(".right-container-inner")
        || document.querySelector(".right-container")
        || document.querySelector("#reco_list")
        || document.documentElement;
    }
    return document.documentElement;
  }

  async function refreshTracks() {
    const refreshStartedAt = performance.now();
    state.platform = detectPlatform() || {
      id: "generic",
      name: "Generic Video",
      kind: "generic"
    };
    state.title = getVideoTitle();
    state.status = "正在读取字幕轨道";
    state.statusTone = "busy";
    state.progress = null;
    state.refreshing = true;
    render();

    try {
      const tracks = await getTracksForPlatform(state.platform);
      state.tracks = tracks;
      state.selectedTrackId = chooseDefaultTrackId(tracks);
      state.status = tracks.length
        ? `已发现 ${tracks.length} 条字幕轨道`
        : "没有发现可直接读取的字幕，可粘贴字幕后总结";
      state.statusTone = tracks.length ? "done" : "neutral";
    } catch (error) {
      state.tracks = [];
      state.status = `字幕读取失败：${error.message}`;
      state.statusTone = "error";
    } finally {
      const remainingAnimationMs = 650 - (performance.now() - refreshStartedAt);
      if (remainingAnimationMs > 0) {
        await delay(remainingAnimationMs);
      }
      state.refreshing = false;
    }

    render();
  }

  function delay(ms) {
    return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
  }

  function detectPlatform() {
    const host = location.hostname.replace(/^www\./, "");
    if (host.includes("youtube.com") || host === "youtu.be") {
      if (location.pathname === "/watch" && new URLSearchParams(location.search).has("v")) {
        return { id: "youtube", name: "YouTube", kind: "youtube" };
      }
      if (location.pathname.startsWith("/shorts/")) {
        return { id: "youtube", name: "YouTube Shorts", kind: "youtube" };
      }
      return null;
    }
    if (host.includes("bilibili.com")) {
      if (location.pathname.includes("/video/") || location.pathname.includes("/bangumi/play/")) {
        return { id: "bilibili", name: "Bilibili", kind: "bilibili" };
      }
      return null;
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
    if (getVisibleVideoElement()) {
      return { id: "generic", name: "Generic Video", kind: "generic" };
    }
    return null;
  }

  function getVisibleVideoElement() {
    return [...document.querySelectorAll("video")]
      .find((video) => {
        const rect = video.getBoundingClientRect();
        return isVisible(video) && rect.width >= 240 && rect.height >= 120;
      }) || null;
  }

  async function getTracksForPlatform(platform) {
    if (platform.kind === "youtube") {
      const tracks = await getYouTubeTracks();
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

  function chooseDefaultTrackId(tracks) {
    if (!tracks.length) {
      return "";
    }

    const outputLanguage = String(state.settings.language || "").toLowerCase();
    const wantsChinese = /中文|chinese|zh|简体|繁體/.test(outputLanguage);
    const preferred = wantsChinese
      ? ["zh-hans", "zh-cn", "zh", "chinese", "中文", "简体", "繁體", "zh-hant", "zh-tw", "en", "english"]
      : ["en", "english"];

    for (const needle of preferred) {
      const match = tracks.find((track) => {
        const haystack = `${track.language || ""} ${track.label || ""}`.toLowerCase();
        return haystack.includes(needle);
      });
      if (match) {
        return match.id;
      }
    }

    return tracks[0].id;
  }

  async function getYouTubeTracks() {
    const scriptsText = getPageScriptsText();
    const response = getJsonAssignment("ytInitialPlayerResponse") || await fetchYouTubePlayerResponse();
    let captionTracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

    if (!captionTracks.length) {
      captionTracks = extractYouTubeCaptionTracks(scriptsText);
    }

    if (!captionTracks.length) {
      const watchHtml = await fetchYouTubeWatchHtml();
      captionTracks = extractYouTubeCaptionTracks(watchHtml);
    }

    return captionTracks
      .filter((track) => track?.baseUrl)
      .map((track, index) => ({
        id: `youtube-${index}`,
        label: getLabelText(track.name) || track.languageCode || `Caption ${index + 1}`,
        language: track.languageCode || "auto",
        source: "youtube",
        url: normalizeUrl(track.baseUrl)
      }));
  }

  async function fetchYouTubePlayerResponse() {
    const html = await fetchYouTubeWatchHtml();
    return getJsonAssignmentFromText(html, "ytInitialPlayerResponse");
  }

  async function fetchYouTubeWatchHtml() {
    const videoId = getYouTubeVideoId();
    if (!videoId) {
      return "";
    }

    const url = new URL("https://www.youtube.com/watch");
    url.searchParams.set("v", videoId);
    url.searchParams.set("has_verified", "1");
    url.searchParams.set("bpctr", "9999999999");

    try {
      const response = await extensionFetch(url.toString());
      return response.text || "";
    } catch (_error) {
      return "";
    }
  }

  function getYouTubeVideoId() {
    const host = location.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      return location.pathname.split("/").filter(Boolean)[0] || "";
    }
    if (location.pathname.startsWith("/shorts/")) {
      return location.pathname.split("/").filter(Boolean)[1] || "";
    }
    return new URLSearchParams(location.search).get("v") || "";
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
      const transcript = await loadYouTubeTrackTranscript(track);
      if (transcript) {
        return transcript;
      }

      for (const fallbackTrack of state.tracks.filter((item) => item.source === "youtube" && item.id !== track.id)) {
        const fallbackTranscript = await loadYouTubeTrackTranscript(fallbackTrack);
        if (fallbackTranscript) {
          state.selectedTrackId = fallbackTrack.id;
          return fallbackTranscript;
        }
      }

      const visibleTranscript = getVisibleTranscript();
      if (visibleTranscript) {
        return visibleTranscript;
      }

      throw new Error("已找到字幕轨道，但 YouTube 返回了空字幕内容。请换一条字幕轨，或打开 YouTube 转写文稿后再试。");
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

  async function loadYouTubeTrackTranscript(track) {
    const sourceUrls = uniqueValues([
      ...getYouTubeRuntimeTimedTextUrls(track),
      track.url
    ]);
    const formats = ["json3", "srv3", "vtt", ""];

    for (const sourceUrl of sourceUrls) {
      const candidateUrls = buildYouTubeTimedTextUrls(sourceUrl, formats);
      for (const { url, format } of candidateUrls) {
        try {
          const response = await extensionFetch(url);
          const transcript = format === "vtt"
            ? parseTextTrack(response.text)
            : parseYouTubeTranscript(response.text) || parseTextTrack(response.text);
          if (transcript.trim()) {
            return transcript.trim();
          }
        } catch (_error) {
          // Try the next runtime URL, format, or fallback track.
        }
      }
    }

    const transcriptPanelText = await loadYouTubeTranscriptPanelText();
    if (transcriptPanelText) {
      return transcriptPanelText;
    }

    return "";
  }

  function getYouTubeRuntimeTimedTextUrls(track) {
    const trackUrl = safeUrl(track?.url);
    const wantedLanguage = trackUrl?.searchParams.get("lang") || track?.language || "";
    const wantedName = trackUrl?.searchParams.get("name") || "";
    const resources = performance.getEntriesByType("resource")
      .filter((entry) => typeof entry.name === "string" && entry.name.includes("/api/timedtext"))
      .map((entry, index) => ({
        url: entry.name,
        startTime: entry.startTime || index,
        score: scoreYouTubeTimedTextUrl(entry.name, wantedLanguage, wantedName)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.startTime - a.startTime);

    return resources.map((entry) => entry.url);
  }

  function scoreYouTubeTimedTextUrl(url, wantedLanguage, wantedName) {
    const parsed = safeUrl(url);
    if (!parsed) {
      return 0;
    }

    let score = 1;
    const language = parsed.searchParams.get("lang") || "";
    const name = parsed.searchParams.get("name") || "";
    if (parsed.searchParams.has("pot")) {
      score += 100;
    }
    if (parsed.searchParams.get("fmt") === "json3") {
      score += 20;
    }
    if (wantedLanguage && language.toLowerCase() === wantedLanguage.toLowerCase()) {
      score += 40;
    }
    if (wantedName && name === wantedName) {
      score += 20;
    }
    return score;
  }

  function buildYouTubeTimedTextUrls(sourceUrl, formats) {
    const urls = [];
    const original = safeUrl(sourceUrl);
    if (!original) {
      return urls;
    }

    urls.push({
      url: addYouTubeClientParams(original.toString()),
      format: original.searchParams.get("fmt") || ""
    });

    for (const format of formats) {
      const url = format ? addQueryParam(sourceUrl, "fmt", format) : sourceUrl;
      urls.push({
        url: addYouTubeClientParams(url),
        format
      });
    }

    const seen = new Set();
    return urls.filter((item) => {
      if (seen.has(item.url)) {
        return false;
      }
      seen.add(item.url);
      return true;
    });
  }

  function addYouTubeClientParams(url) {
    const parsed = safeUrl(url);
    if (!parsed || !parsed.hostname.includes("youtube.com") || !parsed.pathname.includes("/api/timedtext")) {
      return url;
    }

    const version = getYouTubeClientVersion();
    const params = {
      xorb: "2",
      xobt: "3",
      xovt: "3",
      cbrand: "apple",
      cbr: "Chrome",
      c: "WEB",
      cver: version,
      cplayer: "UNIPLAYER",
      cos: "Macintosh",
      cosver: "10_15_7",
      cplatform: "DESKTOP"
    };

    for (const [key, value] of Object.entries(params)) {
      if (value && !parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, value);
      }
    }

    return parsed.toString();
  }

  function getYouTubeClientVersion() {
    try {
      return window.ytcfg?.get?.("INNERTUBE_CLIENT_VERSION") || "2.20260428.00.00";
    } catch (_error) {
      return "2.20260428.00.00";
    }
  }

  async function loadYouTubeTranscriptPanelText() {
    const existing = getYouTubeTranscriptPanelText();
    if (existing) {
      return existing;
    }

    const opened = await openYouTubeTranscriptPanel();
    if (!opened) {
      return "";
    }

    await waitForCondition(() => Boolean(getYouTubeTranscriptPanelText()), 8000, 250);
    return getYouTubeTranscriptPanelText();
  }

  async function openYouTubeTranscriptPanel() {
    const transcriptTexts = [
      "内容转文字",
      "转写文稿",
      "文字转写",
      "Show transcript",
      "Transcript"
    ];

    let button = findClickableByText(transcriptTexts);
    if (button) {
      clickElement(button);
      return true;
    }

    const expandButton = findClickableByText(["...更多", "显示更多", "Show more"]);
    if (expandButton) {
      clickElement(expandButton);
      await delay(450);
      button = findClickableByText(transcriptTexts);
      if (button) {
        clickElement(button);
        return true;
      }
    }

    return false;
  }

  function findClickableByText(texts) {
    const normalizedNeedles = texts.map(normalizeSearchText).filter(Boolean);
    const elements = [
      ...document.querySelectorAll("button, ytd-button-renderer, tp-yt-paper-button, a[role='button'], yt-button-shape")
    ];

    return elements.find((element) => {
      const value = normalizeSearchText([
        element.getAttribute("aria-label") || "",
        element.innerText || "",
        element.textContent || ""
      ].join(" "));
      return normalizedNeedles.some((needle) => value.includes(needle));
    }) || null;
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function clickElement(element) {
    const target = element.querySelector("button, a, tp-yt-paper-button") || element;
    target.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window
    }));
  }

  function getYouTubeTranscriptPanelText() {
    const segments = [...document.querySelectorAll("ytd-transcript-segment-renderer")]
      .map(parseYouTubeTranscriptSegment)
      .filter(Boolean);

    if (segments.length >= 3) {
      return uniqueValues(segments).join("\n");
    }

    const transcriptContainer = document.querySelector(
      "ytd-transcript-renderer, ytd-transcript-search-panel-renderer, ytd-transcript-segment-list-renderer"
    );
    if (!transcriptContainer) {
      return "";
    }

    const text = normalizeTranscriptPanelText(transcriptContainer.innerText || transcriptContainer.textContent || "");
    return text.length > 120 ? text : "";
  }

  function parseYouTubeTranscriptSegment(segment) {
    const lines = String(segment.innerText || segment.textContent || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      return "";
    }

    const timeIndex = lines.findIndex((line) => isTimeLabel(line));
    const time = timeIndex >= 0 ? lines[timeIndex] : "";
    const content = lines
      .filter((_line, index) => index !== timeIndex)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!content) {
      return "";
    }

    return time ? `[${time}] ${content}` : content;
  }

  function normalizeTranscriptPanelText(text) {
    const lines = String(text || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const output = [];

    for (let index = 0; index < lines.length; index += 1) {
      if (!isTimeLabel(lines[index])) {
        continue;
      }
      const time = lines[index];
      const contentParts = [];
      for (let next = index + 1; next < lines.length && !isTimeLabel(lines[next]); next += 1) {
        contentParts.push(lines[next]);
      }
      const content = contentParts.join(" ").replace(/\s+/g, " ").trim();
      if (content) {
        output.push(`[${time}] ${content}`);
      }
    }

    return uniqueValues(output).join("\n");
  }

  function isTimeLabel(value) {
    return /^\d{1,2}:\d{2}(?::\d{2})?$/.test(String(value || "").trim());
  }

  async function waitForCondition(predicate, timeoutMs, intervalMs) {
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      if (predicate()) {
        return true;
      }
      await delay(intervalMs);
    }
    return false;
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
    const summarizeLabel = state.statusTone === "busy" ? "正在解析…" : "解析字幕";

    const trackCount = state.tracks.length
      ? `字幕 · ${state.tracks.length}`
      : "无字幕轨";
    const embedClass = state.embedded ? "is-embedded" : "is-floating";

    shadow.innerHTML = `
      <style>${getPanelCss()}</style>
      <aside class="vcs-panel ${state.collapsed ? "is-collapsed" : ""} ${embedClass}" data-theme="${getTheme()}" data-tone="${escapeHtml(state.statusTone)}">
        <button id="vcs-expand" class="vcs-collapsed-toggle" type="button" title="展开字幕摘要" aria-label="展开字幕摘要">
          <span class="vcs-collapsed-icon">${expandIcon()}</span>
          <span class="vcs-collapsed-title">字幕摘要</span>
        </button>

        <header class="vcs-header">
          <div class="vcs-brand">
            <div class="vcs-seal" aria-hidden="true"><span>AI</span></div>
            <div class="vcs-brand-text">
              <div class="vcs-title">字幕摘要</div>
              <div class="vcs-subtitle">${escapeHtml(state.platform?.name || "video")} · ${escapeHtml(activeProfile)}</div>
            </div>
          </div>
          <div class="vcs-actions">
            <button id="vcs-refresh" class="vcs-icon-button ${state.refreshing ? "is-spinning" : ""}" data-motion="spin" title="重新检测字幕" aria-label="重新检测">${refreshIcon()}</button>
            <button id="vcs-options" class="vcs-icon-button" data-motion="gear" title="打开设置" aria-label="设置">${settingsIcon()}</button>
            <button id="vcs-collapse" class="vcs-icon-button vcs-collapse-button" title="折叠面板" aria-label="折叠面板">${collapseIcon()}</button>
          </div>
        </header>

        <section class="vcs-body">
          <div class="vcs-meta-line">
            <span class="vcs-meta-title" title="${escapeHtml(state.title)}">${escapeHtml(state.title || "未命名视频")}</span>
          </div>

          <div class="vcs-status-wrap">
            <div id="vcs-status" class="vcs-status" data-tone="${escapeHtml(state.statusTone)}">${escapeHtml(state.status)}</div>
            <div class="vcs-progress" data-tone="${escapeHtml(state.statusTone)}"><span id="vcs-progress-bar" style="width:${progressWidth}%"></span></div>
          </div>

          <button id="vcs-summarize" class="vcs-primary" type="button">
            <span>${escapeHtml(summarizeLabel)}</span>
          </button>

          <div class="vcs-track-row">
            <span class="vcs-track-label">${escapeHtml(trackCount)}</span>
            <select id="vcs-track" class="vcs-select" ${state.tracks.length ? "" : "disabled"}>
              ${trackOptions || "<option>未发现字幕轨道</option>"}
            </select>
            <button id="vcs-copy-transcript" class="vcs-tool-button ${state.copyingTranscript ? "is-busy" : ""}" type="button" title="复制字幕" aria-label="复制字幕">${state.copyingTranscript ? loadingIcon() : copyIcon()}</button>
          </div>

          <details class="vcs-details">
            <summary>手动粘贴字幕</summary>
            <textarea id="vcs-manual" class="vcs-textarea" placeholder="若当前页面无法自动读取，可在此粘贴字幕原文。"></textarea>
          </details>

          <details class="vcs-details" ${state.transcript ? "open" : ""}>
            <summary>字幕预览</summary>
            <textarea id="vcs-preview" class="vcs-textarea" readonly>${escapeHtml(state.transcript)}</textarea>
          </details>

          <section class="vcs-result" ${state.lastSummary ? "" : "hidden"}>
            <div class="vcs-result-head">
              <span class="vcs-result-title">摘要</span>
              <button id="vcs-copy-summary" class="vcs-tool-button ${state.copyingSummary ? "is-busy" : ""}" type="button" title="复制摘要" aria-label="复制摘要">${state.copyingSummary ? loadingIcon() : copyIcon()}</button>
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
    shadow.querySelector("#vcs-copy-transcript")?.addEventListener("click", copyTranscript);
    shadow.querySelector("#vcs-copy-summary")?.addEventListener("click", copySummary);
  }

  async function copyTranscript() {
    if (state.copyingTranscript) {
      return;
    }

    state.copyingTranscript = true;
    setStatus("正在复制字幕", "busy");
    render();

    try {
      const text = state.transcript || await loadSelectedTranscript();
      const cleanText = text.trim();
      if (!cleanText) {
        throw new Error("没有可复制的字幕内容。");
      }
      state.transcript = cleanText;
      await copyTextToClipboard(cleanText);
      setStatus(`字幕已复制（${cleanText.length} 字符）`, "done");
    } catch (error) {
      setStatus(`复制失败：${error.message}`, "error");
    } finally {
      state.copyingTranscript = false;
      render();
    }
  }

  async function copySummary() {
    if (state.copyingSummary) {
      return;
    }

    state.copyingSummary = true;
    setStatus("正在复制摘要", "busy");
    render();

    try {
      const text = (state.lastSummary || "").trim();
      if (!text) {
        throw new Error("还没有可复制的摘要。");
      }
      await copyTextToClipboard(text);
      setStatus("摘要已复制", "done");
    } catch (error) {
      setStatus(`复制失败：${error.message}`, "error");
    } finally {
      state.copyingSummary = false;
      render();
    }
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (_error) {
        // Fall back to the selection-based path below.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.documentElement.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");
    textarea.remove();

    if (!copied) {
      throw new Error("浏览器拒绝写入剪贴板。");
    }
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
      const value = getJsonAssignmentFromText(script.textContent || "", name);
      if (value) {
        return value;
      }
    }
    return null;
  }

  function getPageScriptsText() {
    return [...document.scripts]
      .map((script) => script.textContent || "")
      .filter(Boolean)
      .join("\n");
  }

  function extractYouTubeCaptionTracks(text) {
    if (!text) {
      return [];
    }

    let searchIndex = 0;
    while (searchIndex < text.length) {
      const keyIndex = text.indexOf('"captionTracks"', searchIndex);
      if (keyIndex === -1) {
        break;
      }

      const arrayText = extractBalancedArray(text, keyIndex);
      if (arrayText) {
        try {
          const tracks = JSON.parse(arrayText);
          if (Array.isArray(tracks) && tracks.some((track) => track?.baseUrl)) {
            return tracks;
          }
        } catch (_error) {
          // Keep scanning in case the first match is not the player caption list.
        }
      }

      searchIndex = keyIndex + 15;
    }

    return [];
  }

  function getJsonAssignmentFromText(text, name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`${escapedName}\\s*=\\s*`, "m"),
      new RegExp(`"${escapedName}"\\s*:\\s*`, "m")
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (!match) {
        continue;
      }
      const json = extractBalancedJson(text, match.index + match[0].length);
      if (!json) {
        continue;
      }
      try {
        return JSON.parse(json);
      } catch (_error) {
        // Try the next pattern.
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

  function extractBalancedArray(text, startIndex) {
    const firstBracket = text.indexOf("[", startIndex);
    if (firstBracket === -1) {
      return "";
    }

    const stack = [];
    let inString = false;
    let quote = "";
    let escaped = false;

    for (let index = firstBracket; index < text.length; index += 1) {
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

      if (char === "[") {
        stack.push("]");
      } else if (char === "{") {
        stack.push("}");
      } else if (char === "]" || char === "}") {
        if (stack.pop() !== char) {
          return "";
        }
        if (!stack.length) {
          return text.slice(firstBracket, index + 1);
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

  function safeUrl(url) {
    try {
      return new URL(url, location.href);
    } catch (_error) {
      return null;
    }
  }

  function uniqueValues(values) {
    return [...new Set(values.filter(Boolean))];
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

  function collapseIcon() {
    return "<svg viewBox='0 0 24 24' aria-hidden='true'><rect x='4' y='5' width='16' height='14' rx='1'/><path d='M15 5v14'/><path d='M10 9l-3 3 3 3'/></svg>";
  }

  function expandIcon() {
    return "<svg viewBox='0 0 24 24' aria-hidden='true'><rect x='4' y='5' width='16' height='14' rx='1'/><path d='M9 5v14'/><path d='M14 9l3 3-3 3'/></svg>";
  }

  function copyIcon() {
    return "<svg viewBox='0 0 24 24' aria-hidden='true'><rect x='9' y='9' width='13' height='13' rx='2'/><path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'/></svg>";
  }

  function loadingIcon() {
    return "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M12 3a9 9 0 1 0 9 9'/></svg>";
  }

  function getPanelCss() {
    return `
      :host { all: initial; display: block; }
      * { box-sizing: border-box; }

      .vcs-panel {
        --washi: #f7f7f7;
        --washi-soft: #f1f1f1;
        --paper: #ffffff;
        --sumi: #0f0f0f;
        --sumi-soft: #3f3f3f;
        --nezumi: #606060;
        --haijiro: #dedede;
        --haijiro-soft: #eeeeee;
        --rikyu: #0f0f0f;
        --shu: #0f0f0f;
        --good: #107c41;
        --bad: #cc0000;

        --sans: -apple-system, BlinkMacSystemFont, "Roboto", "Arial", "PingFang SC", "Hiragino Sans", "Microsoft YaHei", sans-serif;
        --serif: var(--sans);

        position: relative;
        display: block;
        width: 100%;
        margin: 0 0 16px;
        color: var(--sumi);
        background: var(--paper);
        border: 1px solid var(--haijiro);
        border-radius: 6px;
        font: 13px/1.7 var(--sans);
        letter-spacing: 0;
        overflow: hidden;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
        transform-origin: top right;
        animation: vcs-panel-in 180ms ease both;
      }

      .vcs-panel.is-floating {
        position: fixed;
        top: 84px;
        right: 20px;
        width: 380px;
        max-height: calc(100vh - 120px);
        z-index: 2147483647;
        margin: 0;
      }

      .vcs-panel[data-theme="dark"] {
        --washi: #181818;
        --washi-soft: #202020;
        --paper: #0f0f0f;
        --sumi: #f1f1f1;
        --sumi-soft: #d0d0d0;
        --nezumi: #a0a0a0;
        --haijiro: #303030;
        --haijiro-soft: #242424;
        --rikyu: #ffffff;
        --shu: #ffffff;
        --good: #64d884;
        --bad: #ff6b6b;
      }

      .vcs-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px 12px;
        border-bottom: 1px solid var(--haijiro);
      }

      .vcs-brand {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }

      .vcs-seal {
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        color: var(--paper);
        background: var(--shu);
        border-radius: 4px;
        font: 700 12px/1 var(--sans);
        letter-spacing: 0;
        user-select: none;
      }
      .vcs-panel[data-theme="dark"] .vcs-seal {
        color: var(--paper);
        background: var(--sumi);
      }
      .vcs-seal span { transform: translateY(0.5px); }

      .vcs-brand-text { min-width: 0; }
      .vcs-title {
        color: var(--sumi);
        font: 650 14px/1.3 var(--sans);
        letter-spacing: 0;
        white-space: nowrap;
      }
      .vcs-subtitle {
        color: var(--nezumi);
        font-size: 11px;
        line-height: 1.4;
        letter-spacing: 0;
        margin-top: 2px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 220px;
      }

      .vcs-actions {
        display: flex;
        align-items: center;
        gap: 2px;
      }

      .vcs-icon-button, .vcs-tool-button {
        display: inline-grid;
        place-items: center;
        width: 26px;
        height: 26px;
        padding: 0;
        color: var(--nezumi);
        background: transparent;
        border: 0;
        border-radius: 4px;
        cursor: pointer;
        transition: color 180ms ease, background 180ms ease, transform 180ms ease;
      }
      .vcs-icon-button:hover, .vcs-tool-button:hover {
        color: var(--sumi);
        background: var(--washi-soft);
        transform: translateY(-1px);
      }
      .vcs-icon-button:active, .vcs-tool-button:active,
      .vcs-primary:active, .vcs-collapsed-toggle:active {
        transform: translateY(0) scale(0.98);
      }
      .vcs-icon-button.is-spinning svg {
        animation: vcs-spin 720ms cubic-bezier(0.2, 0.8, 0.2, 1) infinite;
        transform-origin: 50% 50%;
      }
      .vcs-tool-button.is-busy svg {
        animation: vcs-spin 760ms linear infinite;
        transform-origin: 50% 50%;
      }
      .vcs-icon-button[data-motion="gear"]:hover svg {
        transform: rotate(38deg);
      }
      .vcs-collapse-button:hover svg {
        transform: translateX(-1px);
      }

      svg {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
        transition: transform 180ms ease;
      }

      .vcs-body {
        display: grid;
        gap: 14px;
        padding: 16px;
        max-height: 78vh;
        overflow: auto;
      }
      .vcs-panel.is-floating .vcs-body {
        max-height: calc(100vh - 200px);
      }

      .vcs-body::-webkit-scrollbar,
      #vcs-summary::-webkit-scrollbar,
      .vcs-textarea::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      .vcs-body::-webkit-scrollbar-thumb,
      #vcs-summary::-webkit-scrollbar-thumb,
      .vcs-textarea::-webkit-scrollbar-thumb {
        background: var(--haijiro);
        border-radius: 0;
      }

      .vcs-meta-line {
        font-size: 12px;
        color: var(--sumi-soft);
        line-height: 1.5;
      }
      .vcs-meta-title {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--sans);
        letter-spacing: 0;
      }

      .vcs-status-wrap {
        display: grid;
        gap: 8px;
      }
      .vcs-status {
        color: var(--nezumi);
        font-size: 12px;
        letter-spacing: 0;
        min-height: 18px;
      }
      .vcs-status[data-tone="busy"] { color: var(--rikyu); }
      .vcs-status[data-tone="done"] { color: var(--good); }
      .vcs-status[data-tone="error"] { color: var(--bad); }

      .vcs-progress {
        position: relative;
        height: 2px;
        border-radius: 2px;
        overflow: hidden;
        background: var(--haijiro);
      }
      .vcs-progress span {
        display: block;
        width: 0;
        height: 100%;
        background: var(--rikyu);
        transition: width 280ms ease;
      }
      .vcs-progress[data-tone="done"] span { background: var(--good); }
      .vcs-progress[data-tone="error"] span { background: var(--bad); width: 100% !important; }
      .vcs-panel[data-tone="busy"] .vcs-progress span {
        width: 35% !important;
        animation: vcs-indeterminate 1.6s ease-in-out infinite;
      }

      .vcs-primary {
        width: 100%;
        height: 40px;
        color: var(--paper);
        background: var(--sumi);
        border: 1px solid var(--sumi);
        border-radius: 4px;
        font: 650 13px/1 var(--sans);
        letter-spacing: 0;
        cursor: pointer;
        transition: background 180ms ease, color 180ms ease, transform 180ms ease;
      }
      .vcs-primary:hover {
        background: #000000;
        border-color: #000000;
        transform: translateY(-1px);
      }
      .vcs-panel[data-theme="dark"] .vcs-primary {
        background: var(--sumi);
        color: var(--paper);
      }
      .vcs-panel[data-theme="dark"] .vcs-primary:hover {
        background: #ffffff;
        border-color: #ffffff;
        color: #0f0f0f;
      }

      .vcs-track-row {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 8px;
        padding-top: 4px;
        border-top: 1px solid var(--haijiro-soft);
      }
      .vcs-track-label {
        font-size: 11px;
        color: var(--nezumi);
        letter-spacing: 0;
        font-family: var(--sans);
      }
      .vcs-select {
        width: 100%;
        min-width: 0;
        height: 28px;
        padding: 0 6px;
        color: var(--sumi);
        background: transparent;
        border: 0;
        border-bottom: 1px solid var(--haijiro);
        border-radius: 0;
        outline: none;
        font-family: var(--sans);
        font-size: 12px;
      }
      .vcs-select:focus { border-bottom-color: var(--rikyu); }

      .vcs-details {
        border: 0;
        border-top: 1px solid var(--haijiro-soft);
        padding-top: 8px;
        background: transparent;
      }
      .vcs-details summary {
        padding: 4px 0;
        color: var(--sumi-soft);
        font: 550 12px/1.5 var(--sans);
        letter-spacing: 0;
        cursor: pointer;
        list-style: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .vcs-details summary::-webkit-details-marker { display: none; }
      .vcs-details summary::after {
        content: "＋";
        color: var(--nezumi);
        font-size: 12px;
        line-height: 1;
        font-weight: 400;
        transition: transform 200ms ease;
      }
      .vcs-details[open] summary::after { content: "－"; }
      .vcs-details summary:hover { color: var(--sumi); }

      .vcs-textarea {
        display: block;
        width: 100%;
        min-height: 110px;
        margin-top: 8px;
        padding: 10px;
        resize: vertical;
        color: var(--sumi);
        background: var(--washi);
        border: 1px solid var(--haijiro);
        border-radius: 4px;
        outline: none;
        font: 12px/1.7 var(--sans);
      }
      .vcs-textarea:focus { border-color: var(--rikyu); }

      .vcs-result {
        display: grid;
        gap: 10px;
        padding-top: 12px;
        border-top: 1px solid var(--sumi);
        margin-top: 4px;
      }
      .vcs-result[hidden] { display: none; }

      .vcs-result-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .vcs-result-title {
        font: 650 13px/1 var(--sans);
        letter-spacing: 0;
        color: var(--sumi);
      }

      #vcs-summary {
        color: var(--sumi);
        background: transparent;
        max-height: 360px;
        overflow: auto;
        font: 13px/1.85 var(--sans);
        letter-spacing: 0;
      }
      #vcs-summary h3, #vcs-summary h4 {
        margin: 16px 0 6px;
        font: 650 13px/1.5 var(--sans);
        letter-spacing: 0;
        color: var(--sumi);
        padding-bottom: 4px;
        border-bottom: 1px solid var(--haijiro-soft);
      }
      #vcs-summary h3:first-child, #vcs-summary h4:first-child { margin-top: 0; }
      #vcs-summary p { margin: 0 0 10px; color: var(--sumi-soft); }
      #vcs-summary ul { margin: 0 0 10px; padding-left: 18px; color: var(--sumi-soft); }
      #vcs-summary li { margin-bottom: 4px; }

      .vcs-collapsed-toggle {
        display: none;
        grid-template-columns: 22px auto;
        align-items: center;
        gap: 8px;
        width: 136px;
        min-height: 36px;
        padding: 0 10px 0 8px;
        color: var(--sumi);
        background: var(--paper);
        border: 1px solid var(--haijiro);
        border-radius: 4px;
        cursor: pointer;
        font: 650 12px/1 var(--sans);
        letter-spacing: 0;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.12);
        transform-origin: top right;
        animation: vcs-tab-in 180ms ease both;
        transition: border-color 180ms ease, transform 180ms ease, box-shadow 180ms ease;
      }
      .vcs-collapsed-toggle:hover {
        border-color: var(--sumi);
        transform: translateY(-1px);
        box-shadow: 0 14px 30px rgba(0, 0, 0, 0.16);
      }
      .vcs-collapsed-toggle:hover svg {
        transform: translateX(1px);
      }
      .vcs-collapsed-icon {
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        color: var(--paper);
        background: var(--sumi);
        border-radius: 3px;
      }
      .vcs-collapsed-title {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .vcs-panel.is-collapsed {
        width: auto;
        background: transparent;
        border: 0;
        overflow: visible;
      }
      .vcs-panel.is-collapsed .vcs-header,
      .vcs-panel.is-collapsed .vcs-body {
        display: none;
      }
      .vcs-panel.is-collapsed .vcs-collapsed-toggle {
        display: grid;
      }
      .vcs-panel.is-floating.is-collapsed {
        top: 84px;
        right: 20px;
      }

      @keyframes vcs-indeterminate {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(280%); }
      }

      @keyframes vcs-spin {
        100% { transform: rotate(360deg); }
      }

      @keyframes vcs-panel-in {
        0% { opacity: 0; transform: translateX(12px) scale(0.985); }
        100% { opacity: 1; transform: translateX(0) scale(1); }
      }

      @keyframes vcs-tab-in {
        0% { opacity: 0; transform: translateX(10px); }
        100% { opacity: 1; transform: translateX(0); }
      }

      @media (prefers-reduced-motion: reduce) {
        .vcs-panel[data-tone="busy"] .vcs-progress span { animation: none; }
        .vcs-icon-button.is-spinning svg { animation: none; }
        .vcs-tool-button.is-busy svg { animation: none; }
        .vcs-panel, .vcs-collapsed-toggle { animation: none; }
        .vcs-primary, .vcs-icon-button, .vcs-tool-button, .vcs-collapsed-toggle { transition: none; }
      }

      @media (max-width: 1100px) {
        .vcs-panel.is-floating {
          top: auto;
          right: 16px;
          bottom: 16px;
          width: min(360px, calc(100vw - 32px));
        }
      }
    `;
  }
})();
