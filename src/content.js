(() => {
  if (window.__VCS_CONTENT_LOADED__) {
    return;
  }
  window.__VCS_CONTENT_LOADED__ = true;

  const PANEL_ID = "vcs-root";
  const PAGE_STYLE_ID = "vcs-page-polish";
  const AI_MARK_URL = chrome.runtime.getURL("icons/ai-mark.png");
  const DEFAULT_SETTINGS = {
    settingsVersion: 4,
    theme: "auto",
    uiLanguage: "zh-CN",
    language: "中文（简体）",
    activeProfileId: "custom",
    panelEnabled: true,
    includeTimestamps: true,
    saveHistory: true
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
    status: "",
    statusTone: "neutral",
    progress: null,
    refreshing: false,
    previewLoading: false,
    copyingTranscript: false,
    copyingSummary: false,
    summaryCollapsed: false,
    summaryStreaming: false,
    summaryStreamId: ""
  };

  let root = null;
  let shadow = null;
  let lastUrl = location.href;
  let lastPageKey = getPageKey();
  let refreshRunId = 0;
  let transcriptRunId = 0;
  let refreshTimer = null;
  let statusSwapTimer = null;
  let previewPromise = null;
  let activeVideo = null;
  let lastActiveTranscriptIndex = -1;
  let transcriptPanelCloseTimer = null;
  let summaryScrollFrame = null;
  let summaryTargetText = "";

  init();

  function i18n() {
    return globalThis.VCS_I18N.create(state.settings);
  }

  function t(key, variables) {
    return i18n().t(key, variables);
  }

  async function init() {
    state.settings = await loadSettings();
    state.status = t("content.status.readingCaptions");
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
          sendResponse({ ok: false, error: t("content.status.currentNotVideoPanel") });
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
          sendResponse({ ok: false, error: t("content.status.currentNotVideo") });
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
        setStatus(progress?.label || t("content.status.processing"), "busy", progress);
        sendResponse({ ok: true });
        return false;
      }

      if (message?.type === "VCS_SUMMARY_STREAM") {
        appendSummaryStreamDelta(message.streamId, message.delta);
        sendResponse({ ok: true });
        return false;
      }

      return false;
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.vcsSettings) {
        state.settings = normalizeSettings(changes.vcsSettings.newValue);
        if (state.settings.panelEnabled === false) {
          unmount();
          return;
        }
        if (!state.mounted && shouldShowPanel()) {
          maybeMount();
          return;
        }
        applyTheme();
        render();
      }
    });

    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (state.settings.theme === "auto" && state.mounted) {
        applyTheme();
      }
    });
  }

  async function loadSettings() {
    const result = await chrome.storage.local.get("vcsSettings");
    return normalizeSettings(result.vcsSettings);
  }

  function observeNavigation() {
    const observer = new MutationObserver(() => {
      if (hasPageContextChanged()) {
        scheduleRefresh();
      } else if (!state.mounted && shouldShowPanel()) {
        scheduleRefresh();
      } else if (state.mounted && shouldShowPanel()) {
        placeRoot();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(() => {
      if (hasPageContextChanged()) {
        scheduleRefresh();
      }
    }, 1000);
  }

  function hasPageContextChanged() {
    const nextUrl = location.href;
    const nextPageKey = getPageKey();
    if (nextUrl !== lastUrl || nextPageKey !== lastPageKey) {
      lastUrl = nextUrl;
      lastPageKey = nextPageKey;
      return true;
    }
    return false;
  }

  function getPageKey() {
    const host = location.hostname.replace(/^www\./, "");
    if (host.includes("youtube.com") || host === "youtu.be") {
      return `youtube:${getYouTubeVideoId() || location.pathname}`;
    }
    if (host.includes("bilibili.com")) {
      const pageNumber = new URLSearchParams(location.search).get("p") || "1";
      return `bilibili:${getBvidFromUrl() || location.pathname}:${pageNumber}`;
    }
    return `${location.origin}${location.pathname}${location.search}`;
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshRunId += 1;
      transcriptRunId += 1;
      previewPromise = null;
      state.tracks = [];
      state.selectedTrackId = "";
      state.transcript = "";
      state.lastSummary = "";
      resetSummaryStream();
      state.platform = null;
      state.previewLoading = false;
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

    applyPagePolish();

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
    clearTimeout(transcriptPanelCloseTimer);
    resetSummaryStream();
    endYouTubeTranscriptProbe();
    removePagePolish();
    unbindVideoSync();
    state.mounted = false;
    state.embedded = false;
    state.platform = null;
  }

  function placeRoot() {
    const target = findEmbedTarget();
    const before = target ? getRootInsertBefore(target) : null;
    if (target && target !== document.documentElement && (root.parentElement !== target || root.nextSibling !== before)) {
      target.insertBefore(root, before);
      state.embedded = true;
    } else if (target && root.parentElement !== target) {
      if (target === document.documentElement) {
        target.appendChild(root);
      } else {
        target.insertBefore(root, before);
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

  function getRootInsertBefore(target) {
    if (!target || target === document.documentElement) {
      return null;
    }
    if (isBilibiliPage()) {
      return getBilibiliPanelInsertBefore(target);
    }
    return target.firstElementChild === root ? root.nextSibling : target.firstChild;
  }

  function getBilibiliPanelInsertBefore(target) {
    const children = [...target.children].filter((child) => child !== root);
    const authorCard = children.find(isBilibiliAuthorCard) || children[0];
    let next = authorCard?.nextSibling || null;
    while (next === root) {
      next = next.nextSibling;
    }
    return next;
  }

  function isBilibiliAuthorCard(element) {
    const value = `${element.id || ""} ${element.className || ""}`.toLowerCase();
    if (/(^|\s)(up|owner|author|user|member|staff)(-|_|$|\s)/i.test(value)) {
      return true;
    }
    return Boolean(element.querySelector?.([
      "[class*='up-info' i]",
      "[class*='up-name' i]",
      "[class*='owner' i]",
      "[class*='author' i]",
      "[class*='avatar' i]",
      "[data-v-][class*='up' i]"
    ].join(",")));
  }

  function isBilibiliPage() {
    return location.hostname.replace(/^www\./, "").includes("bilibili.com");
  }

  async function refreshTracks() {
    const refreshId = ++refreshRunId;
    const pageKey = getPageKey();
    const refreshStartedAt = performance.now();
    transcriptRunId += 1;
    previewPromise = null;
    state.platform = detectPlatform() || {
      id: "generic",
      name: "Generic Video",
      kind: "generic"
    };
    if (state.platform.kind === "youtube") {
      scheduleCloseYouTubeTranscriptPanel({ attempts: 4, delayMs: 120 });
    }
    state.title = getVideoTitle();
    state.tracks = [];
    state.selectedTrackId = "";
    state.transcript = "";
    state.status = t("content.status.readingTracks");
    state.statusTone = "busy";
    state.progress = null;
    state.refreshing = true;
    lastActiveTranscriptIndex = -1;
    render();

    try {
      const tracks = await getTracksForPlatform(state.platform);
      if (!isCurrentRefresh(refreshId, pageKey)) {
        return;
      }
      state.tracks = tracks;
      state.selectedTrackId = chooseDefaultTrackId(tracks);
      state.status = tracks.length
        ? t("content.status.foundTracks", { count: tracks.length })
        : t("content.status.noTracks");
      state.statusTone = tracks.length ? "done" : "neutral";
    } catch (error) {
      if (!isCurrentRefresh(refreshId, pageKey)) {
        return;
      }
      state.tracks = [];
      state.selectedTrackId = "";
      state.status = t("content.status.trackReadFailed", { message: error.message });
      state.statusTone = "error";
    } finally {
      const remainingAnimationMs = 650 - (performance.now() - refreshStartedAt);
      if (remainingAnimationMs > 0) {
        await delay(remainingAnimationMs);
      }
      if (!isCurrentRefresh(refreshId, pageKey)) {
        return;
      }
      state.refreshing = false;
      render();
      if (state.tracks.length) {
        hydrateTranscriptPreview({ silent: true, pageKey }).catch(() => {});
      }
    }
  }

  function isCurrentRefresh(refreshId, pageKey) {
    return refreshId === refreshRunId && pageKey === getPageKey();
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
          label: t("content.label.pageVisibleTranscript"),
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
    const videoId = getYouTubeVideoId();
    const response = getCurrentYouTubePlayerResponse(videoId)
      || await fetchYouTubePlayerResponse(videoId)
      || getJsonAssignment("ytInitialPlayerResponse", (value) => isYouTubePlayerResponseForVideo(value, videoId));
    let captionTracks = getYouTubeCaptionTracksFromResponse(response, videoId);

    if (!captionTracks.length) {
      captionTracks = extractYouTubeCaptionTracks(getPageScriptsText(), videoId);
    }

    if (!captionTracks.length) {
      const watchHtml = await fetchYouTubeWatchHtml(videoId);
      captionTracks = extractYouTubeCaptionTracks(watchHtml, videoId);
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

  function getCurrentYouTubePlayerResponse(videoId) {
    const candidates = [
      () => globalThis.ytInitialPlayerResponse,
      () => document.querySelector("ytd-watch-flexy")?.playerResponse,
      () => document.querySelector("ytd-watch-flexy")?.playerData?.playerResponse,
      () => document.querySelector("#movie_player")?.getPlayerResponse?.()
    ];

    for (const readCandidate of candidates) {
      try {
        const value = readCandidate();
        if (isYouTubePlayerResponseForVideo(value, videoId)) {
          return value;
        }
      } catch (_error) {
        // Page-owned player objects are not always accessible from the content script.
      }
    }
    return null;
  }

  async function fetchYouTubePlayerResponse(videoId = getYouTubeVideoId()) {
    const html = await fetchYouTubeWatchHtml(videoId);
    const response = getJsonAssignmentFromText(html, "ytInitialPlayerResponse");
    return isYouTubePlayerResponseForVideo(response, videoId) ? response : null;
  }

  async function fetchYouTubeWatchHtml(videoId = getYouTubeVideoId()) {
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

  function getYouTubeCaptionTracksFromResponse(response, videoId) {
    if (!isYouTubePlayerResponseForVideo(response, videoId)) {
      return [];
    }
    return filterYouTubeCaptionTracksForVideo(
      response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [],
      videoId
    );
  }

  function isYouTubePlayerResponseForVideo(response, videoId) {
    if (!response || typeof response !== "object") {
      return false;
    }
    if (!videoId) {
      return true;
    }

    const responseVideoId = response.videoDetails?.videoId || response.videoDetails?.externalVideoId || "";
    if (responseVideoId && responseVideoId === videoId) {
      return true;
    }

    const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    return filterYouTubeCaptionTracksForVideo(tracks, videoId).length > 0;
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
    const playInfo = getJsonAssignment("__playinfo__") || {};
    const pageTracks = normalizeBilibiliSubtitleTracks([
      ...collectBilibiliSubtitleItems(initialState),
      ...collectBilibiliSubtitleItems(playInfo)
    ]);

    if (pageTracks.length) {
      return pageTracks;
    }

    const identity = getBilibiliVideoIdentity(initialState);
    const apiUrls = getBilibiliPlayerApiUrls(identity);
    for (const url of apiUrls) {
      try {
        const response = await extensionFetch(url);
        const data = JSON.parse(response.text);
        const tracks = normalizeBilibiliSubtitleTracks(collectBilibiliSubtitleItems(data));
        if (tracks.length) {
          return tracks;
        }
      } catch (_error) {
        // Bilibili may reject unsigned or stale player API URLs. Try the next source.
      }
    }

    return [];
  }

  function collectBilibiliSubtitleItems(value, depth = 0, output = []) {
    if (!value || depth > 8) {
      return output;
    }

    if (Array.isArray(value)) {
      if (value.some(isBilibiliSubtitleItem)) {
        output.push(...value.filter(isBilibiliSubtitleItem));
        return output;
      }
      value.forEach((item) => collectBilibiliSubtitleItems(item, depth + 1, output));
      return output;
    }

    if (typeof value !== "object") {
      return output;
    }

    for (const [key, child] of Object.entries(value)) {
      if (/^(subtitle|subtitles|subtitleList|subtitle_list|list|data|result|videoData|videoInfo|epInfo)$/i.test(key)) {
        collectBilibiliSubtitleItems(child, depth + 1, output);
      } else if (depth < 3 && child && typeof child === "object") {
        collectBilibiliSubtitleItems(child, depth + 1, output);
      }
    }

    return output;
  }

  function isBilibiliSubtitleItem(item) {
    return Boolean(
      item
      && typeof item === "object"
      && (item.subtitle_url || item.url)
      && (item.lan || item.lan_doc || item.id)
    );
  }

  function normalizeBilibiliSubtitleTracks(items) {
    const seen = new Set();
    return items
      .map((item, index) => {
        const url = normalizeBilibiliSubtitleUrl(item.subtitle_url || item.url || "");
        if (!url || seen.has(url)) {
          return null;
        }
        seen.add(url);
        return {
          item,
          index,
          url
        };
      })
      .filter(Boolean)
      .map(({ item, index, url }) => ({
        id: `bilibili-${index}`,
        label: item.lan_doc || item.lan || `Subtitle ${index + 1}`,
        language: item.lan || "auto",
        source: "bilibili",
        url
      }));
  }

  function normalizeBilibiliSubtitleUrl(url) {
    const value = String(url || "").trim();
    if (!value) {
      return "";
    }
    return normalizeUrl(value);
  }

  function getBilibiliVideoIdentity(initialState) {
    const videoData = initialState.videoData || initialState.videoInfo || {};
    const epInfo = initialState.epInfo || {};
    const idsFromText = getBilibiliIdsFromText(getPageScriptsText());
    return {
      bvid: videoData.bvid || initialState.bvid || idsFromText.bvid || getBvidFromUrl(),
      aid: videoData.aid || initialState.aid || idsFromText.aid,
      cid: videoData.cid || epInfo.cid || initialState.cid || getCidFromPage(initialState) || idsFromText.cid || getBilibiliCidFromRuntimeUrls()
    };
  }

  function getBilibiliPlayerApiUrls(identity) {
    const urls = [];
    urls.push(...getBilibiliRuntimePlayerApiUrls(identity.cid));

    if (identity.cid && (identity.bvid || identity.aid)) {
      for (const pathname of ["/x/player/v2", "/x/player/wbi/v2"]) {
        const api = new URL(`https://api.bilibili.com${pathname}`);
        api.searchParams.set("cid", identity.cid);
        if (identity.bvid) {
          api.searchParams.set("bvid", identity.bvid);
        } else {
          api.searchParams.set("aid", identity.aid);
        }
        urls.push(api.toString());
      }
    }

    return uniqueValues(urls);
  }

  function getBilibiliRuntimePlayerApiUrls(cid = "") {
    return performance.getEntriesByType("resource")
      .map((entry) => entry.name || "")
      .filter(Boolean)
      .filter((url) => {
        const parsed = safeUrl(url);
        if (!parsed || !parsed.hostname.includes("bilibili.com")) {
          return false;
        }
        const isPlayerApi = parsed.pathname.includes("/x/player/v2")
          || parsed.pathname.includes("/x/player/wbi/v2");
        if (!isPlayerApi || !parsed.searchParams.has("cid")) {
          return false;
        }
        return !cid || parsed.searchParams.get("cid") === String(cid);
      });
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
    const track = state.tracks.find((item) => item.id === state.selectedTrackId) || state.tracks[0];
    if (!track) {
      const visibleTranscript = getVisibleTranscript();
      if (visibleTranscript) {
        return visibleTranscript;
      }
      throw new Error(t("content.error.noCaptions"));
    }

    if (track.text) {
      return track.text;
    }

    if (track.source === "youtube") {
      const transcript = await loadYouTubeTrackTranscript(track);
      if (transcript) {
        return transcript;
      }

      throw new Error(t("content.error.emptyYouTube"));
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

    throw new Error(t("content.error.unsupportedTrack", { source: track.source }));
  }

  async function loadYouTubeTrackTranscript(track) {
    const sourceUrls = uniqueValues([
      track.url,
      ...getYouTubeRuntimeTimedTextUrls(track)
    ]);

    const transcript = await fetchYouTubeTranscriptFromSourceUrls(sourceUrls);
    if (transcript) {
      return transcript;
    }

    const translatedTranscript = await loadYouTubeTranslatedTrackTranscript(track);
    if (translatedTranscript) {
      return translatedTranscript;
    }

    const transcriptPanelText = await loadYouTubeTranscriptPanelText();
    if (transcriptPanelText && transcriptMatchesTrackLanguage(track, transcriptPanelText)) {
      return transcriptPanelText;
    }

    return "";
  }

  async function fetchYouTubeTranscriptFromSourceUrls(sourceUrls) {
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
          // Try the next runtime URL or format.
        }
      }
    }

    return "";
  }

  async function loadYouTubeTranslatedTrackTranscript(track) {
    const targetLanguage = getYouTubeTranslationTargetLanguage(track);
    if (!targetLanguage) {
      return "";
    }

    const sourceUrls = state.tracks
      .filter((sourceTrack) => sourceTrack.source === "youtube" && sourceTrack.id !== track.id)
      .flatMap((sourceTrack) => [
        sourceTrack.url,
        ...getYouTubeRuntimeTimedTextUrls(sourceTrack)
      ])
      .map((url) => addYouTubeTranslationParam(url, targetLanguage));
    const transcript = await fetchYouTubeTranscriptFromSourceUrls(uniqueValues(sourceUrls));
    return transcript && transcriptMatchesTrackLanguage(track, transcript) ? transcript : "";
  }

  function getYouTubeTranslationTargetLanguage(track) {
    const trackUrl = safeUrl(track?.url);
    return trackUrl?.searchParams.get("lang") || track?.language || "";
  }

  function addYouTubeTranslationParam(url, targetLanguage) {
    const parsed = safeUrl(url);
    if (!parsed || !targetLanguage) {
      return "";
    }
    parsed.searchParams.set("tlang", targetLanguage);
    return parsed.toString();
  }

  function getYouTubeRuntimeTimedTextUrls(track) {
    const trackUrl = safeUrl(track?.url);
    const wantedTrack = getYouTubeTimedTextTrackIdentity(track, trackUrl);
    const currentVideoId = getYouTubeVideoId();
    const resources = performance.getEntriesByType("resource")
      .filter((entry) => typeof entry.name === "string" && entry.name.includes("/api/timedtext"))
      .map((entry, index) => {
        const scopedUrl = scopeYouTubeRuntimeTimedTextUrlToTrack(entry.name, trackUrl);
        return {
          originalUrl: entry.name,
          url: scopedUrl,
          startTime: entry.startTime || index,
          score: scoreYouTubeTimedTextUrl(scopedUrl, wantedTrack)
        };
      })
      .filter((entry) => entry.score > 0
        && isYouTubeTimedTextUrlForVideo(entry.originalUrl, currentVideoId)
        && isYouTubeTimedTextUrlForVideo(entry.url, currentVideoId))
      .sort((a, b) => b.score - a.score || b.startTime - a.startTime);

    return resources.map((entry) => entry.url);
  }

  function getYouTubeTimedTextTrackIdentity(track, trackUrl = safeUrl(track?.url)) {
    return {
      language: trackUrl?.searchParams.get("lang") || track?.language || "",
      name: trackUrl?.searchParams.get("name") || "",
      kind: trackUrl?.searchParams.get("kind") || ""
    };
  }

  function scopeYouTubeRuntimeTimedTextUrlToTrack(runtimeUrl, trackUrl) {
    const runtime = safeUrl(runtimeUrl);
    if (!runtime || !trackUrl) {
      return runtimeUrl;
    }

    const scoped = new URL(trackUrl.toString());
    const transferableParams = [
      "pot",
      "c",
      "cver",
      "cplayer",
      "cplatform",
      "cbrand",
      "cbr",
      "cos",
      "cosver",
      "xorb",
      "xobt",
      "xovt"
    ];

    for (const key of transferableParams) {
      const value = runtime.searchParams.get(key);
      if (value) {
        scoped.searchParams.set(key, value);
      }
    }

    const runtimeFormat = runtime.searchParams.get("fmt");
    if (runtimeFormat) {
      scoped.searchParams.set("fmt", runtimeFormat);
    }

    return scoped.toString();
  }

  function isYouTubeTimedTextUrlForVideo(url, videoId) {
    const urlVideoId = getYouTubeUrlVideoId(url);
    return !videoId || !urlVideoId || urlVideoId === videoId;
  }

  function scoreYouTubeTimedTextUrl(url, wantedTrack) {
    const parsed = safeUrl(url);
    if (!parsed) {
      return 0;
    }

    let score = 1;
    const language = normalizeYouTubeTimedTextParam(parsed.searchParams.get("lang") || "");
    const name = parsed.searchParams.get("name") || "";
    const kind = normalizeYouTubeTimedTextParam(parsed.searchParams.get("kind") || "");
    const wantedLanguage = normalizeYouTubeTimedTextParam(wantedTrack.language);
    const wantedName = wantedTrack.name || "";
    const wantedKind = normalizeYouTubeTimedTextParam(wantedTrack.kind);

    if (wantedLanguage) {
      if (language !== wantedLanguage) {
        return 0;
      }
      score += 40;
    }
    if (wantedName) {
      if (name !== wantedName) {
        return 0;
      }
      score += 20;
    }
    if (wantedKind) {
      if (kind !== wantedKind) {
        return 0;
      }
      score += 8;
    }
    if (parsed.searchParams.has("pot")) {
      score += 100;
    }
    if (parsed.searchParams.get("fmt") === "json3") {
      score += 20;
    }
    return score;
  }

  function normalizeYouTubeTimedTextParam(value) {
    return String(value || "").trim().toLowerCase();
  }

  function transcriptMatchesTrackLanguage(track, transcript) {
    const expected = getTrackLanguageFamily(track);
    const actual = detectTranscriptLanguageFamily(transcript);
    return !expected || !actual || expected === actual;
  }

  function getTrackLanguageFamily(track) {
    const value = normalizeSearchText(`${track?.language || ""} ${track?.label || ""}`);
    if (/(^|[^a-z])zh([^a-z]|$)|chinese|中文|汉语|漢語|普通话|國語|国语|简体|繁体|繁體/.test(value)) {
      return "zh";
    }
    if (/(^|[^a-z])en([^a-z]|$)|english|英语|英文/.test(value)) {
      return "en";
    }
    return "";
  }

  function detectTranscriptLanguageFamily(transcript) {
    const sample = getTranscriptTextLines(transcript)
      .slice(0, 40)
      .join(" ");
    const cjkCount = (sample.match(/[\u3400-\u9fff]/g) || []).length;
    const latinWordCount = (sample.match(/[a-z][a-z']+/gi) || []).length;

    if (cjkCount >= 8 && cjkCount >= latinWordCount) {
      return "zh";
    }
    if (latinWordCount >= 10 && cjkCount < latinWordCount * 0.25) {
      return "en";
    }
    if (cjkCount >= 4) {
      return "zh";
    }
    if (latinWordCount >= 6) {
      return "en";
    }
    return "";
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
      beginYouTubeTranscriptProbe();
      scheduleCloseYouTubeTranscriptPanel();
      return existing;
    }

    beginYouTubeTranscriptProbe();
    const opened = await openYouTubeTranscriptPanel();
    if (!opened) {
      endYouTubeTranscriptProbe();
      return "";
    }

    try {
      await waitForCondition(() => Boolean(getYouTubeTranscriptPanelText()), 8000, 250);
      return getYouTubeTranscriptPanelText();
    } finally {
      scheduleCloseYouTubeTranscriptPanel();
    }
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

  function beginYouTubeTranscriptProbe() {
    document.documentElement.dataset.vcsTranscriptProbe = "true";
  }

  function endYouTubeTranscriptProbe() {
    delete document.documentElement.dataset.vcsTranscriptProbe;
  }

  function scheduleCloseYouTubeTranscriptPanel(options = {}) {
    const attempts = options.attempts ?? 12;
    const delayMs = options.delayMs ?? 180;
    let count = 0;

    clearTimeout(transcriptPanelCloseTimer);

    const tick = () => {
      const panel = getYouTubeTranscriptPanelElement();
      if (!panel) {
        endYouTubeTranscriptProbe();
        return;
      }

      closeYouTubeTranscriptPanel(panel);
      count += 1;

      if (count >= attempts) {
        suppressYouTubeTranscriptPanel(panel);
        endYouTubeTranscriptProbe();
        return;
      }

      transcriptPanelCloseTimer = window.setTimeout(tick, delayMs);
    };

    transcriptPanelCloseTimer = window.setTimeout(tick, delayMs);
  }

  function closeYouTubeTranscriptPanel(panel = null) {
    const targetPanel = panel || getYouTubeTranscriptPanelElement();
    if (!targetPanel) {
      return false;
    }

    const closeButton = findTranscriptCloseButton(targetPanel);
    if (!closeButton) {
      return false;
    }

    clickElement(closeButton);
    return true;
  }

  function suppressYouTubeTranscriptPanel(panel = null) {
    const targetPanel = panel || getYouTubeTranscriptPanelElement();
    if (!targetPanel) {
      return false;
    }

    const container = targetPanel.closest?.("ytd-engagement-panel-section-list-renderer") || targetPanel;
    container.dataset.vcsSuppressed = "true";
    container.setAttribute("hidden", "");
    container.style.display = "none";
    return true;
  }

  function getYouTubeTranscriptPanelElement() {
    const element = document.querySelector([
      "ytd-engagement-panel-section-list-renderer[target-id*='transcript' i]",
      "ytd-engagement-panel-section-list-renderer[visibility='ENGAGEMENT_PANEL_VISIBILITY_EXPANDED'] ytd-transcript-renderer",
      "ytd-transcript-renderer",
      "ytd-transcript-search-panel-renderer"
    ].join(","));
    return element?.closest?.("ytd-engagement-panel-section-list-renderer") || element;
  }

  function findTranscriptCloseButton(panel) {
    const container = panel.closest?.("ytd-engagement-panel-section-list-renderer") || panel;
    const buttons = [
      ...container.querySelectorAll("button, tp-yt-paper-icon-button, yt-icon-button, ytd-button-renderer")
    ];
    const closeWords = ["关闭", "關閉", "隐藏", "隱藏", "收起", "close", "dismiss", "hide"];

    return buttons.find((button) => {
      const value = normalizeSearchText([
        button.id || "",
        button.className || "",
        button.getAttribute("aria-label") || "",
        button.getAttribute("title") || "",
        button.getAttribute("tooltip") || "",
        button.textContent || ""
      ].join(" "));
      return closeWords.some((word) => value.includes(word));
    }) || null;
  }

  function getYouTubeTranscriptPanelText() {
    const segments = [...document.querySelectorAll([
      "ytd-transcript-segment-renderer",
      "ytd-transcript-segment-list-renderer [role='button']",
      "ytd-transcript-segment-list-renderer yt-formatted-string",
      "[target-id*='transcript' i] [role='button']"
    ].join(","))]
      .map(parseYouTubeTranscriptSegment)
      .filter(Boolean);

    if (segments.length >= 3) {
      return uniqueValues(segments).join("\n");
    }

    const transcriptContainers = [
      ...document.querySelectorAll([
        "ytd-transcript-renderer",
        "ytd-transcript-search-panel-renderer",
        "ytd-transcript-segment-list-renderer",
        "ytd-engagement-panel-section-list-renderer[target-id*='transcript' i]",
        "ytd-engagement-panel-section-list-renderer[visibility='ENGAGEMENT_PANEL_VISIBILITY_EXPANDED']",
        "[aria-label*='转写' i]",
        "[aria-label*='transcript' i]"
      ].join(","))
    ].filter((element) => !root?.contains(element));

    for (const container of transcriptContainers) {
      const text = normalizeTranscriptPanelText(container.innerText || container.textContent || "");
      if (text.length > 80) {
        return text;
      }
    }

    return "";
  }

  function parseYouTubeTranscriptSegment(segment) {
    const lines = getTranscriptTextLines(segment.innerText || segment.textContent || "");

    if (!lines.length) {
      return "";
    }

    const inline = lines.map(parseTimeContentLine).find((item) => item);
    if (inline) {
      return `[${inline.time}] ${inline.content}`;
    }

    const timeIndex = lines.findIndex((line) => isTimeLabel(line));
    const time = timeIndex >= 0 ? lines[timeIndex] : "";
    const content = lines
      .filter((_line, index) => index !== timeIndex)
      .filter((line) => !/^(转写文稿|搜索转写内容|Transcript|Search transcript)$/i.test(line))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!content) {
      return "";
    }

    return time ? `[${time}] ${content}` : content;
  }

  function normalizeTranscriptPanelText(text) {
    const lines = getTranscriptTextLines(text);
    const output = [];

    for (let index = 0; index < lines.length; index += 1) {
      const inline = parseTimeContentLine(lines[index]);
      if (inline) {
        output.push(`[${inline.time}] ${inline.content}`);
        continue;
      }

      if (!isTimeLabel(lines[index])) {
        continue;
      }
      const time = lines[index];
      const contentParts = [];
      for (let next = index + 1; next < lines.length && !isTimeLabel(lines[next]) && !parseTimeContentLine(lines[next]); next += 1) {
        contentParts.push(lines[next]);
      }
      const content = contentParts
        .filter((line) => !/^(转写文稿|搜索转写内容|Transcript|Search transcript)$/i.test(line))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (content) {
        output.push(`[${time}] ${content}`);
      }
    }

    return uniqueValues(output).join("\n");
  }

  function isTimeLabel(value) {
    return /^\d{1,2}:\d{2}(?::\d{2})?$/.test(String(value || "").trim());
  }

  function parseTimeContentLine(value) {
    const match = String(value || "")
      .trim()
      .match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*(.+)$/);
    if (!match) {
      return null;
    }

    const content = match[2]
      .replace(/\s+/g, " ")
      .trim();
    return content ? { time: match[1], content } : null;
  }

  function getTranscriptTextLines(text) {
    return String(text || "")
      .replace(/\r/g, "\n")
      .split(/\n+/)
      .flatMap(splitPackedTranscriptLine)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function splitPackedTranscriptLine(line) {
    const value = String(line || "").trim();
    const matches = [...value.matchAll(/\d{1,2}:\d{2}(?::\d{2})?/g)];
    if (matches.length < 2) {
      return [value];
    }

    const chunks = [];
    if (matches[0].index > 0) {
      chunks.push(value.slice(0, matches[0].index));
    }
    for (let index = 0; index < matches.length; index += 1) {
      const start = matches[index].index;
      const end = matches[index + 1]?.index ?? value.length;
      chunks.push(value.slice(start, end));
    }
    return chunks;
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
      setStatus(t("content.status.preparing"), "busy");
      const transcript = await hydrateTranscriptPreview();
      const streamId = `summary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      beginSummaryStream(streamId);

      setStatus(t("content.status.requestingSummary"), "busy");
      const response = await chrome.runtime.sendMessage({
        type: "VCS_SUMMARIZE",
        stream: true,
        streamId,
        payload: {
          title: state.title,
          platform: state.platform?.name || "Unknown",
          url: location.href,
          transcript
        }
      });

      if (!response?.ok) {
        throw new Error(response?.error || t("content.status.summaryFailed"));
      }

      await finishSummaryStream(response.payload.text || "");
      setStatus(t("content.status.complete", {
        provider: response.payload.provider,
        model: response.payload.model
      }), "done");
    } catch (error) {
      stopSummaryStream();
      setStatus(error.message, "error");
      render();
    }
  }

  function beginSummaryStream(streamId) {
    summaryTargetText = "";
    state.lastSummary = "";
    state.summaryCollapsed = false;
    state.summaryStreaming = true;
    state.summaryStreamId = streamId;
    render();
  }

  function appendSummaryStreamDelta(streamId, delta) {
    if (!delta || !state.summaryStreaming || streamId !== state.summaryStreamId) {
      return;
    }

    const shouldRevealSummary = !state.lastSummary && !summaryTargetText;
    summaryTargetText += String(delta);
    if (shouldRevealSummary) {
      revealSummaryOutput();
    }
    state.lastSummary = summaryTargetText;
    updateSummaryArticle();
  }

  async function finishSummaryStream(finalText) {
    const cleanText = String(finalText || "").trim();
    const hadSummaryOutput = Boolean(state.lastSummary || summaryTargetText);
    if (cleanText && summaryTargetText.trim() !== cleanText) {
      summaryTargetText = cleanText;
    }
    if (summaryTargetText && state.lastSummary !== summaryTargetText) {
      state.lastSummary = summaryTargetText;
    }
    if (!hadSummaryOutput && summaryTargetText) {
      revealSummaryOutput();
    }

    state.summaryStreaming = false;
    state.summaryStreamId = "";
    cancelSummaryFollowScroll();
    syncSummaryOutputState();
    updateSummaryArticle();
  }

  function stopSummaryStream() {
    state.summaryStreaming = false;
    state.summaryStreamId = "";
    summaryTargetText = state.lastSummary || summaryTargetText;
    cancelSummaryFollowScroll();
  }

  function resetSummaryStream() {
    state.summaryStreaming = false;
    state.summaryStreamId = "";
    summaryTargetText = "";
    state.summaryCollapsed = false;
    cancelSummaryFollowScroll();
  }

  function updateSummaryArticle() {
    const article = shadow?.querySelector("#vcs-summary");
    if (!article) {
      return;
    }

    article.innerHTML = markdownToHtml(state.lastSummary);
    const details = shadow?.querySelector(".vcs-summary-details");
    if (state.summaryStreaming && details && !details.hidden) {
      placeSummaryCursor(article);
      requestSummaryFollowScroll();
    }
  }

  function revealSummaryOutput() {
    const details = shadow?.querySelector(".vcs-summary-details");
    if (!details) {
      render();
      return;
    }

    details.hidden = false;
    details.open = !state.summaryCollapsed;
    syncSummaryOutputState();
  }

  function syncSummaryOutputState() {
    const details = shadow?.querySelector(".vcs-summary-details");
    if (!details) {
      return;
    }

    const hasSummaryOutput = Boolean(state.lastSummary || summaryTargetText);
    details.hidden = !hasSummaryOutput;
    details.classList.toggle("is-streaming", state.summaryStreaming);

    const shell = details.querySelector(".vcs-summary-shell");
    if (shell) {
      shell.classList.toggle("is-streaming", state.summaryStreaming);
      shell.setAttribute("aria-busy", state.summaryStreaming ? "true" : "false");
    }
  }

  function updateSummarizeButtonLabel() {
    const label = shadow?.querySelector("#vcs-summarize .vcs-primary-label");
    if (label) {
      label.textContent = state.statusTone === "busy" ? t("content.label.summarizeBusy") : t("content.label.summarize");
    }
  }

  function placeSummaryCursor(article) {
    const cursor = article.ownerDocument.createElement("span");
    cursor.className = "vcs-stream-cursor";
    cursor.setAttribute("aria-hidden", "true");

    findSummaryCursorTarget(article).appendChild(cursor);
  }

  function findSummaryCursorTarget(article) {
    const lastBlock = article.lastElementChild;
    if (!lastBlock) {
      return article;
    }

    if (lastBlock.matches("ul, ol")) {
      return lastBlock.querySelector("li:last-child") || lastBlock;
    }

    if (lastBlock.matches("p, li, h3, h4, h5")) {
      return lastBlock;
    }

    return article;
  }

  function requestSummaryFollowScroll() {
    cancelSummaryFollowScroll();
    summaryScrollFrame = requestAnimationFrame(() => {
      summaryScrollFrame = null;
      const shell = shadow?.querySelector(".vcs-summary-shell");
      const cursor = shadow?.querySelector(".vcs-stream-cursor");
      if (!shell || !cursor) {
        return;
      }

      const shellRect = shell.getBoundingClientRect();
      const cursorRect = cursor.getBoundingClientRect();
      const bottomPadding = 18;
      const bottomOverflow = cursorRect.bottom - shellRect.bottom + bottomPadding;

      if (bottomOverflow > 0) {
        shell.scrollTop += bottomOverflow;
        return;
      }

      if (cursorRect.top < shellRect.top) {
        shell.scrollTop += cursorRect.top - shellRect.top - bottomPadding;
      }
    });
  }

  function cancelSummaryFollowScroll() {
    if (summaryScrollFrame) {
      cancelAnimationFrame(summaryScrollFrame);
      summaryScrollFrame = null;
    }
  }

  function setStatus(message, tone = "neutral", progress = null) {
    state.status = message;
    state.statusTone = tone;
    state.progress = progress;
    const panel = shadow?.querySelector(".vcs-panel");
    if (panel) {
      panel.dataset.tone = tone;
    }
    const status = shadow?.querySelector("#vcs-status");
    if (status) {
      status.dataset.tone = tone;
      swapStatusText(status, message);
    }
    updateSummarizeButtonLabel();
    const progressEl = shadow?.querySelector(".vcs-progress");
    if (progressEl) {
      progressEl.dataset.tone = tone;
    }
    const bar = shadow?.querySelector("#vcs-progress-bar");
    if (bar) {
      const percent = progress?.total ? Math.round((progress.current / progress.total) * 100) : 0;
      bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    }
  }

  async function hydrateTranscriptPreview(options = {}) {
    const silent = Boolean(options.silent);
    if (previewPromise) {
      return previewPromise;
    }

    const loadId = ++transcriptRunId;
    const pageKey = options.pageKey || getPageKey();
    state.previewLoading = true;
    if (!silent) {
      setStatus(t("content.status.readingTranscript"), "busy");
    }
    render();

    previewPromise = loadSelectedTranscript()
      .then((transcript) => {
        if (!isCurrentTranscriptLoad(loadId, pageKey)) {
          throw new Error(t("content.error.transcriptChanged"));
        }
        const cleanText = normalizeLoadedTranscript(transcript);
        if (!cleanText) {
          throw new Error(t("content.error.noTranscript"));
        }
        state.transcript = cleanText;
        lastActiveTranscriptIndex = -1;
        if (!silent) {
          setStatus(t("content.status.transcriptRead", { count: cleanText.length }), "done");
        }
        return cleanText;
      })
      .catch((error) => {
        if (isCurrentTranscriptLoad(loadId, pageKey)) {
          setStatus(t("content.status.readFailed", { message: error.message }), "error");
        }
        throw error;
      })
      .finally(() => {
        if (!isCurrentTranscriptLoad(loadId, pageKey)) {
          return;
        }
        state.previewLoading = false;
        previewPromise = null;
        render();
      });

    return previewPromise;
  }

  function normalizeLoadedTranscript(transcript) {
    const lines = getTranscriptTextLines(transcript);
    if (!lines.length) {
      return String(transcript || "").trim();
    }
    return removeDuplicateTranscriptLines(lines).join("\n").trim();
  }

  function removeDuplicateTranscriptLines(lines) {
    const output = [];

    for (let index = 0; index < lines.length; index += 1) {
      const current = parseTranscriptLineParts(lines[index]);
      const previous = parseTranscriptLineParts(output[output.length - 1] || "");
      const next = parseTranscriptLineParts(lines[index + 1] || "");

      if (!current.time && current.key) {
        if ((previous.time && previous.key === current.key) || (next.time && next.key === current.key)) {
          continue;
        }
      }

      if (current.time && current.key && !previous.time && previous.key === current.key) {
        output.pop();
      }

      const last = parseTranscriptLineParts(output[output.length - 1] || "");
      if (last.key && last.key === current.key && last.time === current.time) {
        continue;
      }

      output.push(lines[index]);
    }

    return output;
  }

  function parseTranscriptLineParts(line) {
    const value = String(line || "").trim();
    const bracketed = value.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)$/);
    const inline = bracketed ? null : parseTimeContentLine(value);
    const time = bracketed?.[1] || inline?.time || "";
    const content = (bracketed?.[2] || inline?.content || value).trim();
    return {
      time,
      content,
      key: normalizeTranscriptContent(content)
    };
  }

  function normalizeTranscriptContent(content) {
    return String(content || "")
      .replace(/\s+/g, "")
      .replace(/[，。！？、；：,.!?;:"“”'‘’()[\]【】]/g, "")
      .toLowerCase();
  }

  function isCurrentTranscriptLoad(loadId, pageKey) {
    return loadId === transcriptRunId && pageKey === getPageKey();
  }

  function swapStatusText(element, nextText) {
    if (!element) {
      return;
    }

    clearTimeout(statusSwapTimer);
    element.classList.remove("is-exit", "is-enter-start");
    if (element.textContent === nextText) {
      return;
    }

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      element.textContent = nextText;
      return;
    }

    const duration = parseFloat(getComputedStyle(element).getPropertyValue("--text-swap-dur")) || 200;
    element.classList.add("is-exit");
    statusSwapTimer = setTimeout(() => {
      if (!element.isConnected) {
        return;
      }
      element.textContent = nextText;
      element.classList.remove("is-exit");
      element.classList.add("is-enter-start");
      void element.offsetHeight;
      element.classList.remove("is-enter-start");
    }, duration);
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
    const summarizeLabel = state.statusTone === "busy" ? t("content.label.summarizeBusy") : t("content.label.summarize");
    const previewPlaceholder = state.previewLoading
      ? t("content.label.previewLoading")
      : t("content.label.previewPlaceholder");
    const previewContent = state.transcript
      ? renderTranscriptPreview(state.transcript)
      : `<span class="vcs-transcript-placeholder">${escapeHtml(previewPlaceholder)}</span>`;
    const hasSummaryOutput = Boolean(state.lastSummary || summaryTargetText);
    const summaryOpen = !state.summaryCollapsed;

    const trackCount = state.tracks.length
      ? t("content.label.trackCount", { count: state.tracks.length })
      : t("content.label.noTrack");
    const platformLabel = state.platform?.name || "video";
    const collapsedMeta = state.tracks.length
      ? t("content.label.collapsedTracks", { platform: platformLabel, count: state.tracks.length })
      : `${platformLabel} · ${state.status}`;
    const embedClass = state.embedded ? "is-embedded" : "is-floating";

    shadow.innerHTML = `
      <style>${getPanelCss()}</style>
      <aside class="vcs-panel t-resize ${state.collapsed ? "is-collapsed" : ""} ${embedClass}" data-theme="${getTheme()}" data-tone="${escapeHtml(state.statusTone)}">
        <button id="vcs-expand" class="vcs-collapsed-toggle" type="button" title="${escapeHtml(t("content.title.expand"))}" aria-label="${escapeHtml(t("content.title.expand"))}">
          <span class="vcs-collapsed-icon"><img src="${escapeHtml(AI_MARK_URL)}" alt=""></span>
          <span class="vcs-collapsed-copy">
            <span class="vcs-collapsed-title">${escapeHtml(t("content.title"))}</span>
            <span class="vcs-collapsed-meta">${escapeHtml(collapsedMeta)}</span>
          </span>
          <span class="vcs-collapsed-arrow">${chevronRightIcon()}</span>
        </button>

        <header class="vcs-header">
          <div class="vcs-brand">
            <div class="vcs-seal" aria-hidden="true"><img src="${escapeHtml(AI_MARK_URL)}" alt=""></div>
            <div class="vcs-brand-text">
              <div class="vcs-title">${escapeHtml(t("content.title"))}</div>
              <div class="vcs-subtitle">${escapeHtml(platformLabel)} · ${escapeHtml(activeProfile)}</div>
            </div>
          </div>
          <div class="vcs-actions">
            <button id="vcs-refresh" class="vcs-icon-button ${state.refreshing ? "is-spinning" : ""}" data-motion="spin" title="${escapeHtml(t("content.title.refresh"))}" aria-label="${escapeHtml(t("content.title.refresh"))}">${refreshIcon()}</button>
            <button id="vcs-options" class="vcs-icon-button" data-motion="gear" title="${escapeHtml(t("content.title.options"))}" aria-label="${escapeHtml(t("content.title.settings"))}">${settingsIcon()}</button>
            <button id="vcs-collapse" class="vcs-icon-button vcs-collapse-button" title="${escapeHtml(t("content.title.collapse"))}" aria-label="${escapeHtml(t("content.title.collapse"))}">${chevronRightIcon()}</button>
          </div>
        </header>

        <section class="vcs-body t-panel-slide" data-open="${state.collapsed ? "false" : "true"}">
          <div class="vcs-meta-line">
            <span class="vcs-meta-title" title="${escapeHtml(state.title)}">${escapeHtml(state.title || t("content.label.unnamedVideo"))}</span>
          </div>

          <div class="vcs-status-wrap">
            <div id="vcs-status" class="vcs-status t-text-swap" data-tone="${escapeHtml(state.statusTone)}">${escapeHtml(state.status)}</div>
            <div class="vcs-progress" data-tone="${escapeHtml(state.statusTone)}"><span id="vcs-progress-bar" style="width:${progressWidth}%"></span></div>
          </div>

          <button id="vcs-summarize" class="vcs-primary" type="button">
            <span class="vcs-primary-label">${escapeHtml(summarizeLabel)}</span>
          </button>

          <details class="vcs-result vcs-details vcs-summary-details ${state.summaryStreaming ? "is-streaming" : ""}" aria-live="polite" ${hasSummaryOutput ? "" : "hidden"} ${summaryOpen ? "open" : ""}>
            <summary>
              <span class="vcs-result-title">${escapeHtml(t("content.label.summary"))}</span>
              <button id="vcs-copy-summary" class="vcs-tool-button ${state.copyingSummary ? "is-busy" : ""}" type="button" title="${escapeHtml(t("content.title.copySummary"))}" aria-label="${escapeHtml(t("content.title.copySummary"))}">${copyButtonIcon(state.copyingSummary)}</button>
              <span class="vcs-details-chevron" aria-hidden="true">${chevronRightIcon()}</span>
            </summary>
            <div class="vcs-summary-shell ${state.summaryStreaming ? "is-streaming" : ""}" role="region" aria-label="${escapeHtml(t("content.label.markdownSummary"))}" aria-busy="${state.summaryStreaming ? "true" : "false"}" tabindex="0">
              <article id="vcs-summary" class="vcs-markdown">${markdownToHtml(state.lastSummary)}</article>
            </div>
          </details>

          <div class="vcs-track-row">
            <span class="vcs-track-label">${escapeHtml(trackCount)}</span>
            <select id="vcs-track" class="vcs-select" ${state.tracks.length ? "" : "disabled"}>
              ${trackOptions || `<option>${escapeHtml(t("content.label.noTrackOption"))}</option>`}
            </select>
            <button id="vcs-copy-transcript" class="vcs-tool-button ${state.copyingTranscript ? "is-busy" : ""}" type="button" title="${escapeHtml(t("content.title.copyTranscript"))}" aria-label="${escapeHtml(t("content.title.copyTranscript"))}">${copyButtonIcon(state.copyingTranscript)}</button>
          </div>

          <details class="vcs-details vcs-transcript-details" open>
            <summary>
              <span class="vcs-details-title">${escapeHtml(t("content.label.transcriptPreview"))}</span>
              <span class="vcs-details-chevron" aria-hidden="true">${chevronRightIcon()}</span>
            </summary>
            <div id="vcs-preview" class="vcs-transcript-box" role="region" aria-label="${escapeHtml(t("content.label.transcriptPreviewAria"))}" data-empty="${state.transcript ? "false" : "true"}">${previewContent}</div>
          </details>
        </section>
      </aside>
    `;

    updateSummaryArticle();
    bindEvents();
    applyTheme();
    bindVideoSync();
    syncTranscriptToVideo(true);
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
      transcriptRunId += 1;
      previewPromise = null;
      state.selectedTrackId = event.target.value;
      state.transcript = "";
      lastActiveTranscriptIndex = -1;
      hydrateTranscriptPreview({ silent: true }).catch(() => {});
    });
    shadow.querySelector("#vcs-summarize")?.addEventListener("click", summarize);
    shadow.querySelector("#vcs-copy-transcript")?.addEventListener("click", copyTranscript);
    shadow.querySelector(".vcs-summary-details")?.addEventListener("toggle", (event) => {
      state.summaryCollapsed = !event.currentTarget.open;
      if (event.currentTarget.open) {
        updateSummaryArticle();
      }
    });
    shadow.querySelector("#vcs-copy-summary")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      copySummary();
    });
    shadow.querySelector("#vcs-preview")?.addEventListener("click", handleTranscriptClick);
  }

  function renderTranscriptPreview(transcript) {
    const items = parseTranscriptPreviewItems(transcript);
    if (!items.length) {
      return escapeHtml(transcript);
    }

    return `
      <ol class="vcs-transcript-list" aria-label="${escapeHtml(t("content.label.transcriptTimeline"))}">
        ${items.map(renderTranscriptItem).join("")}
      </ol>
    `;
  }

  function renderTranscriptItem(item) {
    const content = escapeHtml(item.content || item.raw);
    if (!item.time || !Number.isFinite(item.seconds)) {
      return `
        <li class="vcs-transcript-item">
          <div class="vcs-transcript-row is-plain" data-index="${item.index}">
            <span class="vcs-cue-text">${content}</span>
          </div>
        </li>
      `;
    }

    return `
      <li class="vcs-transcript-item">
        <button class="vcs-transcript-row" type="button" data-index="${item.index}" data-seconds="${item.seconds}" aria-label="${escapeHtml(t("content.label.jumpToTime", { time: item.time }))}">
          <span class="vcs-cue-time">${escapeHtml(item.time)}</span>
          <span class="vcs-cue-text">${content}</span>
        </button>
      </li>
    `;
  }

  function parseTranscriptPreviewItems(transcript) {
    return getTranscriptTextLines(transcript)
      .map((line, index) => {
        const bracketed = line.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)$/);
        const inline = bracketed ? null : parseTimeContentLine(line);
        const time = bracketed?.[1] || inline?.time || "";
        const content = (bracketed?.[2] || inline?.content || line).trim();
        return {
          index,
          raw: line,
          time,
          seconds: time ? parseTimestamp(time) : Number.NaN,
          content
        };
      });
  }

  function handleTranscriptClick(event) {
    const row = event.target.closest?.(".vcs-transcript-row[data-seconds]");
    if (!row) {
      return;
    }

    const seconds = Number(row.dataset.seconds);
    if (!Number.isFinite(seconds)) {
      return;
    }

    seekVideoTo(seconds);
  }

  function bindVideoSync() {
    const nextVideo = getPrimaryVideo();
    if (activeVideo === nextVideo) {
      return;
    }

    unbindVideoSync();
    activeVideo = nextVideo;
    if (!activeVideo) {
      return;
    }

    activeVideo.addEventListener("timeupdate", syncTranscriptToVideo);
    activeVideo.addEventListener("seeked", syncTranscriptToVideo);
    activeVideo.addEventListener("play", syncTranscriptToVideo);
  }

  function unbindVideoSync() {
    if (!activeVideo) {
      return;
    }

    activeVideo.removeEventListener("timeupdate", syncTranscriptToVideo);
    activeVideo.removeEventListener("seeked", syncTranscriptToVideo);
    activeVideo.removeEventListener("play", syncTranscriptToVideo);
    activeVideo = null;
    lastActiveTranscriptIndex = -1;
  }

  function getPrimaryVideo() {
    const videos = [...document.querySelectorAll("video")]
      .filter((video) => !root?.contains(video) && isVisible(video))
      .sort((a, b) => {
        const rectA = a.getBoundingClientRect();
        const rectB = b.getBoundingClientRect();
        return (rectB.width * rectB.height) - (rectA.width * rectA.height);
      });
    return videos[0] || null;
  }

  function seekVideoTo(seconds) {
    const video = activeVideo || getPrimaryVideo();
    if (!video) {
      return;
    }

    try {
      video.currentTime = Math.max(0, seconds);
      syncTranscriptToVideo(true);
    } catch (_error) {
      // Some embedded players can block direct seeking until media metadata is ready.
    }
  }

  function syncTranscriptToVideo(force = false) {
    const shouldForce = force === true;
    const video = activeVideo || getPrimaryVideo();
    const preview = shadow?.querySelector("#vcs-preview");
    if (!video || !preview) {
      return;
    }

    const rows = [...preview.querySelectorAll(".vcs-transcript-row[data-seconds]")];
    if (!rows.length) {
      return;
    }

    const currentTime = Number(video.currentTime) || 0;
    let activeRow = rows[0];
    for (const row of rows) {
      const seconds = Number(row.dataset.seconds);
      if (Number.isFinite(seconds) && seconds <= currentTime + 0.25) {
        activeRow = row;
      } else {
        break;
      }
    }

    const activeIndex = Number(activeRow.dataset.index);
    if (!shouldForce && activeIndex === lastActiveTranscriptIndex) {
      return;
    }

    preview.querySelectorAll(".vcs-transcript-row.is-active").forEach((row) => {
      row.classList.remove("is-active");
      row.removeAttribute("aria-current");
    });
    activeRow.classList.add("is-active");
    activeRow.setAttribute("aria-current", "true");
    lastActiveTranscriptIndex = activeIndex;

    if (!isElementInsideContainer(activeRow, preview)) {
      scrollElementInsideContainer(activeRow, preview, {
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
      });
    }
  }

  function isElementInsideContainer(element, container) {
    const elementRect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return elementRect.top >= containerRect.top + 8 && elementRect.bottom <= containerRect.bottom - 8;
  }

  function scrollElementInsideContainer(element, container, options = {}) {
    const elementRect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const padding = 14;
    const topOverflow = elementRect.top - containerRect.top - padding;
    const bottomOverflow = elementRect.bottom - containerRect.bottom + padding;
    let nextScrollTop = container.scrollTop;

    if (topOverflow < 0) {
      nextScrollTop += topOverflow;
    } else if (bottomOverflow > 0) {
      nextScrollTop += bottomOverflow;
    }

    nextScrollTop = Math.max(0, Math.min(nextScrollTop, container.scrollHeight - container.clientHeight));
    if (Math.abs(nextScrollTop - container.scrollTop) < 1) {
      return;
    }

    container.scrollTo({
      top: nextScrollTop,
      behavior: options.behavior || "auto"
    });
  }

  async function copyTranscript() {
    if (state.copyingTranscript) {
      return;
    }

    state.copyingTranscript = true;
    setStatus(t("content.status.copyingTranscript"), "busy");
    setCopyButtonBusy("#vcs-copy-transcript", true);

    try {
      const text = state.transcript || await hydrateTranscriptPreview();
      const cleanText = text.trim();
      if (!cleanText) {
        throw new Error(t("content.error.noCopyableTranscript"));
      }
      state.transcript = cleanText;
      await copyTextToClipboard(cleanText);
      setStatus(t("content.status.transcriptCopied", { count: cleanText.length }), "done");
    } catch (error) {
      setStatus(t("content.status.copyFailed", { message: error.message }), "error");
    } finally {
      state.copyingTranscript = false;
      setCopyButtonBusy("#vcs-copy-transcript", false);
    }
  }

  async function copySummary() {
    if (state.copyingSummary) {
      return;
    }

    state.copyingSummary = true;
    setStatus(t("content.status.copyingSummary"), "busy");
    setCopyButtonBusy("#vcs-copy-summary", true);

    try {
      const text = (state.lastSummary || "").trim();
      if (!text) {
        throw new Error(t("content.error.noCopyableSummary"));
      }
      await copyTextToClipboard(text);
      setStatus(t("content.status.summaryCopied"), "done");
    } catch (error) {
      setStatus(t("content.status.copyFailed", { message: error.message }), "error");
    } finally {
      state.copyingSummary = false;
      setCopyButtonBusy("#vcs-copy-summary", false);
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
      throw new Error(t("content.error.clipboardDenied"));
    }
  }

  function applyTheme() {
    const panel = shadow?.querySelector(".vcs-panel");
    if (panel) {
      panel.dataset.theme = getTheme();
    }
  }

  function applyPagePolish() {
    const platform = detectPlatform();
    if (platform?.kind !== "youtube") {
      removePagePolish();
      return;
    }

    if (document.getElementById(PAGE_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = PAGE_STYLE_ID;
    style.textContent = getYouTubePageCss();
    document.documentElement.appendChild(style);
  }

  function removePagePolish() {
    endYouTubeTranscriptProbe();
    document.getElementById(PAGE_STYLE_ID)?.remove();
  }

  function normalizeSettings(input) {
    const normalized = {
      ...DEFAULT_SETTINGS,
      ...(input || {})
    };
    const importedVersion = Number(input?.settingsVersion || 0);
    normalized.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
    normalized.theme = ["auto", "light", "dark"].includes(normalized.theme) ? normalized.theme : DEFAULT_SETTINGS.theme;
    normalized.uiLanguage = globalThis.VCS_I18N.normalizeUiLanguage(normalized.uiLanguage);
    normalized.language = String(normalized.language || "").trim() || DEFAULT_SETTINGS.language;
    normalized.panelEnabled = normalized.panelEnabled !== false;
    normalized.includeTimestamps = normalized.includeTimestamps !== false;
    normalized.saveHistory = importedVersion < 2 ? true : normalized.saveHistory !== false;
    return normalized;
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

  function getJsonAssignment(name, validator = null) {
    for (const script of document.scripts) {
      const value = getJsonAssignmentFromText(script.textContent || "", name);
      if (value && (!validator || validator(value))) {
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

  function extractYouTubeCaptionTracks(text, videoId = "") {
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
          const currentTracks = filterYouTubeCaptionTracksForVideo(tracks, videoId);
          if (currentTracks.length) {
            return currentTracks;
          }
        } catch (_error) {
          // Keep scanning in case the first match is not the player caption list.
        }
      }

      searchIndex = keyIndex + 15;
    }

    return [];
  }

  function filterYouTubeCaptionTracksForVideo(tracks, videoId = "") {
    if (!Array.isArray(tracks)) {
      return [];
    }

    const usableTracks = tracks.filter((track) => track?.baseUrl);
    if (!videoId) {
      return usableTracks;
    }

    const tracksWithVideoId = usableTracks.filter((track) => getYouTubeUrlVideoId(track.baseUrl));
    if (!tracksWithVideoId.length) {
      return usableTracks;
    }

    return usableTracks.filter((track) => getYouTubeUrlVideoId(track.baseUrl) === videoId);
  }

  function getYouTubeUrlVideoId(url) {
    return safeUrl(url)?.searchParams.get("v") || "";
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

  function getBilibiliIdsFromText(text) {
    const source = String(text || "");
    const bvid = source.match(/"bvid"\s*:\s*"(BV[^"]+)"/i)?.[1]
      || source.match(/\b(BV[0-9A-Za-z]+)/)?.[1]
      || "";
    const aid = source.match(/"aid"\s*:\s*(\d+)/i)?.[1]
      || source.match(/"aid"\s*:\s*"(\d+)"/i)?.[1]
      || "";
    const cid = source.match(/"cid"\s*:\s*(\d+)/i)?.[1]
      || source.match(/"cid"\s*:\s*"(\d+)"/i)?.[1]
      || "";
    return { bvid, aid, cid };
  }

  function getBilibiliCidFromRuntimeUrls() {
    const urls = [
      location.href,
      ...performance.getEntriesByType("resource").map((entry) => entry.name || "")
    ];
    for (const value of urls) {
      const url = safeUrl(value);
      const cid = url?.searchParams.get("cid");
      if (cid) {
        return cid;
      }
    }
    return "";
  }

  function getCidFromPage(initialState) {
    const videoData = initialState.videoData || initialState.videoInfo || {};
    const pages = videoData.pages || initialState.pages || [];
    const pageNumber = new URLSearchParams(location.search).get("p") || "1";
    const page = pages.find((item) => String(item.page) === pageNumber)
      || pages[Number(pageNumber) - 1]
      || pages[0];
    return videoData.cid
      || initialState.epInfo?.cid
      || page?.cid
      || "";
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
    const body = Array.isArray(json?.body)
      ? json.body
      : Array.isArray(json?.data?.body)
        ? json.data.body
        : [];
    const lines = body
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
    let listType = "";

    const flushParagraph = () => {
      if (paragraph.length) {
        html.push(`<p>${paragraph.join("<br>")}</p>`);
        paragraph = [];
      }
    };

    const closeList = () => {
      if (inList) {
        html.push(`</${listType}>`);
        inList = false;
        listType = "";
      }
    };

    const openList = (type) => {
      if (inList && listType !== type) {
        closeList();
      }
      if (!inList) {
        html.push(`<${type}>`);
        inList = true;
        listType = type;
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line) {
        flushParagraph();
        closeList();
        continue;
      }

      if (/^---+$/.test(line)) {
        flushParagraph();
        closeList();
        html.push("<hr>");
        continue;
      }

      if (line.startsWith("# ")) {
        flushParagraph();
        closeList();
        html.push(`<h3>${renderInlineMarkdown(line.slice(2))}</h3>`);
        continue;
      }

      if (line.startsWith("### ")) {
        flushParagraph();
        closeList();
        html.push(`<h5>${renderInlineMarkdown(line.slice(4))}</h5>`);
        continue;
      }

      if (line.startsWith("## ")) {
        flushParagraph();
        closeList();
        html.push(`<h4>${renderInlineMarkdown(line.slice(3))}</h4>`);
        continue;
      }

      if (/^[-*]\s+/.test(line)) {
        flushParagraph();
        openList("ul");
        html.push(`<li>${renderInlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>`);
        continue;
      }

      if (/^\d+\.\s+/.test(line)) {
        flushParagraph();
        openList("ol");
        html.push(`<li>${renderInlineMarkdown(line.replace(/^\d+\.\s+/, ""))}</li>`);
        continue;
      }

      closeList();
      paragraph.push(renderInlineMarkdown(line));
    }

    flushParagraph();
    closeList();
    return html.join("");
  }

  function renderInlineMarkdown(value) {
    const placeholders = [];
    let html = escapeHtml(value);

    const stash = (replacement) => {
      const token = `@@VCSMD${placeholders.length}@@`;
      placeholders.push(replacement);
      return token;
    };

    html = html.replace(/`([^`]+)`/g, (_match, code) => {
      return stash(`<code>${code}</code>`);
    });

    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, url) => {
      const href = escapeHtml(url);
      return stash(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    });
    html = html
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/_([^_]+)_/g, "<em>$1</em>");

    placeholders.forEach((replacement, index) => {
      html = html.replace(`@@VCSMD${index}@@`, replacement);
    });
    return html;
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

  function chevronRightIcon() {
    return "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M9 6l6 6-6 6'/></svg>";
  }

  function copyIcon() {
    return "<svg class='vcs-copy-icon' viewBox='0 0 24 24' aria-hidden='true'><rect x='8' y='8' width='14' height='14' rx='2'/><path d='M16 4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2'/></svg>";
  }

  function loadingIcon() {
    return "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M12 3a9 9 0 1 0 9 9'/></svg>";
  }

  function copyButtonIcon(isBusy) {
    return `
      <span class="t-icon-swap" data-state="${isBusy ? "b" : "a"}">
        <span class="t-icon" data-icon="a">${copyIcon()}</span>
        <span class="t-icon" data-icon="b">${loadingIcon()}</span>
      </span>
    `;
  }

  function setCopyButtonBusy(selector, isBusy) {
    const button = shadow?.querySelector(selector);
    if (!button) {
      return;
    }
    button.classList.toggle("is-busy", isBusy);
    button.querySelector(".t-icon-swap")?.setAttribute("data-state", isBusy ? "b" : "a");
  }

  function getYouTubePageCss() {
    return `
      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i],
      ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"] ytd-transcript-renderer {
        --vcs-yt-transcript-body-size: 13.5px;
        --vcs-yt-transcript-time-size: 11px;
        --vcs-yt-transcript-title-size: 19px;
      }

      html[data-vcs-transcript-probe="true"] ytd-engagement-panel-section-list-renderer[target-id*="transcript" i],
      html[data-vcs-transcript-probe="true"] ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]:has(ytd-transcript-renderer),
      ytd-engagement-panel-section-list-renderer[data-vcs-suppressed="true"] {
        max-height: 0 !important;
        min-height: 0 !important;
        height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        opacity: 0 !important;
        overflow: hidden !important;
        pointer-events: none !important;
        visibility: hidden !important;
      }

      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] #header,
      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] .header {
        padding-block: 12px !important;
      }

      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] h2,
      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] #title,
      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] yt-formatted-string#title {
        font-size: var(--vcs-yt-transcript-title-size) !important;
        line-height: 1.25 !important;
        letter-spacing: 0 !important;
      }

      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] #content,
      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] #content *,
      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] ytd-transcript-renderer,
      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] ytd-transcript-renderer * {
        font-size: var(--vcs-yt-transcript-body-size) !important;
        letter-spacing: 0 !important;
      }

      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] ytd-transcript-segment-renderer,
      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] ytd-transcript-segment-list-renderer [role="button"] {
        align-items: flex-start !important;
        column-gap: 8px !important;
        padding-block: 5px !important;
      }

      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] ytd-transcript-segment-renderer yt-formatted-string,
      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] ytd-transcript-segment-renderer #segment-text,
      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] ytd-transcript-segment-renderer [id*="text" i],
      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] ytd-transcript-segment-list-renderer yt-formatted-string,
      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] ytd-transcript-segment-list-renderer #segment-text,
      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] ytd-transcript-segment-list-renderer [id*="text" i],
      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] ytd-transcript-segment-list-renderer [role="button"] {
        font-size: var(--vcs-yt-transcript-body-size) !important;
        line-height: 1.42 !important;
        letter-spacing: 0 !important;
        font-weight: 500 !important;
      }

      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] .segment-timestamp,
      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] #timestamp,
      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] yt-formatted-string[class*="timestamp" i],
      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] [class*="timestamp" i],
      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] [id*="timestamp" i] {
        font-size: var(--vcs-yt-transcript-time-size) !important;
        line-height: 1.3 !important;
        font-weight: 600 !important;
      }

      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] input,
      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] tp-yt-paper-input,
      ytd-engagement-panel-section-list-renderer[target-id*="transcript" i] yt-searchbox input {
        font-size: 14px !important;
        line-height: 1.35 !important;
      }
    `;
  }

  function getPanelCss() {
    return `
      :host { all: initial; display: block; }
      * { box-sizing: border-box; }

      .vcs-panel {
        --washi: #f7f7f7;
        --washi-soft: #eeeeee;
        --paper: #f1f1f1;
        --paper-elevated: #f3f3f3;
        --sumi: #111111;
        --sumi-soft: #343434;
        --nezumi: #6b6b6b;
        --haijiro: #e0e0e0;
        --haijiro-soft: #e8e8e8;
        --rikyu: #111111;
        --shu: #111111;
        --clay: #767676;
        --button: #111111;
        --button-hover: #2a2a2a;
        --neumo-surface: #ededed;
        --neumo-text: #090909;
        --neumo-muted: #666666;
        --neumo-shadow-dark: #d1d1d1;
        --neumo-shadow-light: #ffffff;
        --good: #111111;
        --bad: #b00020;
        --shadow: rgba(0, 0, 0, 0.12);

        --resize-dur: 300ms;
        --resize-ease: cubic-bezier(0.22, 1, 0.36, 1);
        --panel-open-dur: 240ms;
        --panel-close-dur: 200ms;
        --panel-translate-y: 8px;
        --panel-blur: 2px;
        --panel-ease: cubic-bezier(0.22, 1, 0.36, 1);
        --text-swap-dur: 200ms;
        --text-swap-translate-y: 8px;
        --text-swap-blur: 2px;
        --text-swap-ease: ease-out;
        --icon-swap-dur: 200ms;
        --icon-swap-blur: 2px;
        --icon-swap-start-scale: 0.25;
        --icon-swap-ease: ease-in-out;

        --sans: -apple-system, BlinkMacSystemFont, "Roboto", "Arial", "PingFang SC", "Hiragino Sans", "Microsoft YaHei", sans-serif;
        --serif: var(--sans);

        position: relative;
        display: flex;
        flex-direction: column;
        width: 100%;
        margin: 0 0 14px;
        color: var(--sumi);
        background: var(--paper);
        border: 1px solid color-mix(in srgb, var(--haijiro) 54%, transparent);
        border-radius: 8px;
        font: 13px/1.7 var(--sans);
        letter-spacing: 0;
        overflow: hidden;
        box-shadow: 0 10px 26px color-mix(in srgb, var(--shadow) 72%, transparent);
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

      .vcs-panel.is-embedded:not(.is-collapsed) {
        height: auto;
        max-height: none;
      }

      .vcs-panel[data-theme="dark"] {
        --washi: #181818;
        --washi-soft: #242424;
        --paper: #101010;
        --paper-elevated: #151515;
        --sumi: #f4f4f4;
        --sumi-soft: #d0d0d0;
        --nezumi: #a0a0a0;
        --haijiro: #3a3a3a;
        --haijiro-soft: #292929;
        --rikyu: #f4f4f4;
        --shu: #f4f4f4;
        --clay: #9a9a9a;
        --button: #f4f4f4;
        --button-hover: #ffffff;
        --neumo-surface: #242424;
        --neumo-text: #f4f4f4;
        --neumo-muted: #a8a8a8;
        --neumo-shadow-dark: #151515;
        --neumo-shadow-light: #343434;
        --good: #f4f4f4;
        --bad: #ff6b7a;
        --shadow: rgba(0, 0, 0, 0.32);
      }

      .vcs-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 12px 14px 10px;
        border-bottom: 1px solid color-mix(in srgb, var(--haijiro) 48%, transparent);
        background:
          linear-gradient(90deg, color-mix(in srgb, var(--washi) 64%, transparent), transparent 58%),
          var(--paper-elevated);
      }

      .vcs-brand {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }

      .vcs-seal {
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        padding: 3px;
        color: var(--paper);
        background: color-mix(in srgb, var(--shu) 92%, var(--clay));
        border: 1px solid color-mix(in srgb, var(--paper-elevated) 26%, transparent);
        border-radius: 7px;
        user-select: none;
      }
      .vcs-seal img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
      }

      .vcs-brand-text { min-width: 0; }
      .vcs-title {
        color: var(--sumi);
        font: 720 14px/1.22 var(--sans);
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
        max-width: 218px;
      }

      .vcs-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .vcs-icon-button, .vcs-tool-button {
        display: inline-grid;
        place-items: center;
        width: 24px;
        height: 24px;
        padding: 0;
        color: var(--neumo-muted);
        background: var(--neumo-surface);
        border: 1px solid var(--neumo-surface);
        border-radius: 999px;
        cursor: pointer;
        box-shadow:
          inset 1.5px 1.5px 3px color-mix(in srgb, var(--neumo-shadow-dark) 74%, transparent),
          inset -1.5px -1.5px 3px color-mix(in srgb, var(--neumo-shadow-light) 76%, transparent);
        transition:
          color 180ms ease,
          background 180ms ease,
          border-color 180ms ease,
          box-shadow 180ms ease,
          transform 180ms ease;
      }
      .vcs-icon-button:hover, .vcs-tool-button:hover {
        color: var(--neumo-text);
        box-shadow:
          inset 1px 1px 2px color-mix(in srgb, var(--neumo-shadow-dark) 64%, transparent),
          inset -1px -1px 2px color-mix(in srgb, var(--neumo-shadow-light) 70%, transparent);
      }
      .vcs-icon-button:active, .vcs-tool-button:active {
        color: var(--neumo-muted);
        transform: translateY(0);
        box-shadow:
          inset 2px 2px 4px color-mix(in srgb, var(--neumo-shadow-dark) 82%, transparent),
          inset -2px -2px 4px color-mix(in srgb, var(--neumo-shadow-light) 76%, transparent);
      }
      .vcs-icon-button.is-spinning svg {
        animation: vcs-spin 720ms cubic-bezier(0.2, 0.8, 0.2, 1) infinite;
        transform-origin: 50% 50%;
      }
      .vcs-tool-button.is-busy .t-icon[data-icon="b"] svg {
        animation: vcs-spin 760ms linear infinite;
        transform-origin: 50% 50%;
      }
      .vcs-icon-button[data-motion="gear"]:hover svg {
        transform: rotate(38deg);
      }
      .vcs-collapse-button svg {
        transform: rotate(90deg);
        transform-origin: 50% 50%;
      }
      .vcs-collapse-button:hover svg {
        transform: rotate(90deg) translateX(1px);
      }
      .vcs-track-row .vcs-tool-button {
        width: 22px;
        height: 22px;
        justify-self: center;
        align-self: center;
      }
      .vcs-track-row .vcs-tool-button svg {
        width: 12px;
        height: 12px;
      }
      .vcs-track-row .vcs-tool-button .t-icon-swap,
      .vcs-track-row .vcs-tool-button .t-icon {
        width: 14px;
        height: 14px;
      }
      .vcs-track-row .vcs-copy-icon {
        transform: translate(-0.5px, -0.5px);
      }

      svg {
        width: 13px;
        height: 13px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
        transition: transform 180ms ease;
      }

      .t-resize {
        transition:
          width  var(--resize-dur) var(--resize-ease),
          height var(--resize-dur) var(--resize-ease);
        will-change: width, height;
      }

      .t-panel-slide {
        transform: translateY(var(--panel-translate-y));
        opacity: 0;
        filter: blur(var(--panel-blur));
        pointer-events: none;
        transition:
          transform var(--panel-close-dur) var(--panel-ease),
          opacity   var(--panel-close-dur) var(--panel-ease),
          filter    var(--panel-close-dur) var(--panel-ease);
        will-change: transform, opacity, filter;
      }
      .t-panel-slide[data-open="true"] {
        transform: translateY(0);
        opacity: 1;
        filter: blur(0);
        pointer-events: auto;
        transition:
          transform var(--panel-open-dur) var(--panel-ease),
          opacity   var(--panel-open-dur) var(--panel-ease),
          filter    var(--panel-open-dur) var(--panel-ease);
      }

      .t-text-swap {
        display: inline-block;
        transform: translateY(0);
        filter: blur(0);
        opacity: 1;
        transition:
          transform var(--text-swap-dur) var(--text-swap-ease),
          filter    var(--text-swap-dur) var(--text-swap-ease),
          opacity   var(--text-swap-dur) var(--text-swap-ease);
        will-change: transform, filter, opacity;
      }
      .t-text-swap.is-exit {
        transform: translateY(calc(var(--text-swap-translate-y) * -1));
        filter: blur(var(--text-swap-blur));
        opacity: 0;
      }
      .t-text-swap.is-enter-start {
        transform: translateY(var(--text-swap-translate-y));
        filter: blur(var(--text-swap-blur));
        opacity: 0;
        transition: none;
      }

      .t-icon-swap {
        position: relative;
        display: inline-grid;
        place-items: center;
      }
      .t-icon-swap .t-icon {
        grid-area: 1 / 1;
        display: grid;
        place-items: center;
        transition:
          opacity   var(--icon-swap-dur) var(--icon-swap-ease),
          filter    var(--icon-swap-dur) var(--icon-swap-ease),
          transform var(--icon-swap-dur) var(--icon-swap-ease);
        will-change: opacity, filter, transform;
      }
      .t-icon-swap[data-state="a"] .t-icon[data-icon="a"],
      .t-icon-swap[data-state="b"] .t-icon[data-icon="b"] {
        opacity: 1;
        filter: blur(0);
        transform: scale(1);
      }
      .t-icon-swap[data-state="a"] .t-icon[data-icon="b"],
      .t-icon-swap[data-state="b"] .t-icon[data-icon="a"] {
        opacity: 0;
        filter: blur(var(--icon-swap-blur));
        transform: scale(var(--icon-swap-start-scale));
      }

      .vcs-body {
        display: grid;
        flex: 1 1 auto;
        gap: 10px;
        padding: 14px;
        max-height: 78vh;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
      }
      .vcs-panel.is-floating .vcs-body {
        max-height: calc(100vh - 200px);
      }
      .vcs-panel.is-embedded .vcs-body {
        max-height: none;
        overflow: visible;
      }

      .vcs-body::-webkit-scrollbar,
      .vcs-summary-shell::-webkit-scrollbar,
      .vcs-transcript-box::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      .vcs-body::-webkit-scrollbar-thumb,
      .vcs-summary-shell::-webkit-scrollbar-thumb,
      .vcs-transcript-box::-webkit-scrollbar-thumb {
        background: color-mix(in srgb, var(--haijiro) 82%, transparent);
        border-radius: 999px;
      }

      .vcs-meta-line {
        padding: 9px 11px;
        font-size: 12px;
        color: var(--sumi-soft);
        line-height: 1.5;
        background: var(--neumo-surface);
        border: 1px solid color-mix(in srgb, var(--neumo-surface) 86%, var(--haijiro-soft));
        border-radius: 8px;
        box-shadow:
          inset 2px 2px 5px color-mix(in srgb, var(--neumo-shadow-dark) 54%, transparent),
          inset -2px -2px 5px color-mix(in srgb, var(--neumo-shadow-light) 64%, transparent);
        min-width: 0;
      }
      .vcs-meta-title {
        display: block;
        overflow-wrap: anywhere;
        white-space: normal;
        font-family: var(--sans);
        letter-spacing: 0;
      }

      .vcs-status-wrap {
        display: grid;
        gap: 6px;
      }
      .vcs-status {
        color: var(--nezumi);
        font: 560 12px/1.5 var(--sans);
        letter-spacing: 0;
        min-height: 18px;
      }
      .vcs-status[data-tone="busy"] { color: var(--clay); }
      .vcs-status[data-tone="done"] { color: var(--good); }
      .vcs-status[data-tone="error"] { color: var(--bad); }

      .vcs-progress {
        position: relative;
        height: 2px;
        border-radius: 2px;
        overflow: hidden;
        background: color-mix(in srgb, var(--haijiro) 72%, transparent);
      }
      .vcs-progress span {
        display: block;
        width: 0;
        height: 100%;
        background: linear-gradient(90deg, var(--clay), var(--rikyu));
        transition: width 280ms ease;
      }
      .vcs-progress[data-tone="done"] span { background: var(--good); }
      .vcs-progress[data-tone="error"] span { background: var(--bad); width: 100% !important; }
      .vcs-panel[data-tone="busy"] .vcs-progress span {
        width: 35% !important;
        animation: vcs-indeterminate 1.6s ease-in-out infinite;
      }

      .vcs-primary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        justify-self: stretch;
        width: 100%;
        min-width: 0;
        min-height: 38px;
        margin: 4px 0 8px;
        padding: 0.55em 1.2em;
        color: var(--neumo-text);
        background: var(--neumo-surface);
        border: 1px solid var(--neumo-surface);
        border-radius: 0.5em;
        font: 680 14px/1 var(--sans);
        letter-spacing: 0;
        cursor: pointer;
        box-shadow:
          2px 2px 5px color-mix(in srgb, var(--neumo-shadow-dark) 58%, transparent),
          -2px -2px 5px color-mix(in srgb, var(--neumo-shadow-light) 70%, transparent),
          inset 0 0 0 color-mix(in srgb, var(--neumo-shadow-dark) 0%, transparent);
        transition:
          color 180ms ease,
          box-shadow 220ms ease,
          transform 180ms ease;
      }
      .vcs-primary:hover {
        color: var(--neumo-text);
        box-shadow:
          2px 2px 4px color-mix(in srgb, var(--neumo-shadow-dark) 48%, transparent),
          -2px -2px 4px color-mix(in srgb, var(--neumo-shadow-light) 62%, transparent);
      }
      .vcs-primary:active {
        color: var(--neumo-muted);
        box-shadow:
          inset 2px 2px 5px color-mix(in srgb, var(--neumo-shadow-dark) 72%, transparent),
          inset -2px -2px 5px color-mix(in srgb, var(--neumo-shadow-light) 72%, transparent);
      }
      .vcs-primary-label {
        display: block;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .vcs-collapsed-toggle:active {
        transform: none;
      }

      .vcs-track-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) 24px;
        align-items: center;
        gap: 8px;
        padding: 7px 0 0;
        border-top: 0;
        min-width: 0;
      }
      .vcs-track-label {
        font: 650 11px/1.35 var(--sans);
        color: var(--nezumi);
        letter-spacing: 0;
        white-space: nowrap;
      }
      .vcs-select {
        width: 100%;
        min-width: 0;
        height: 30px;
        padding: 0 26px 0 8px;
        color: var(--sumi);
        background:
          linear-gradient(45deg, transparent 50%, var(--nezumi) 50%),
          linear-gradient(135deg, var(--nezumi) 50%, transparent 50%),
          var(--neumo-surface);
        background-position:
          calc(100% - 15px) 52%,
          calc(100% - 10px) 52%,
          0 0;
        background-size: 5px 5px, 5px 5px, 100% 100%;
        background-repeat: no-repeat;
        border: 1px solid color-mix(in srgb, var(--neumo-surface) 86%, var(--haijiro-soft));
        border-radius: 8px;
        box-shadow:
          inset 2px 2px 5px color-mix(in srgb, var(--neumo-shadow-dark) 54%, transparent),
          inset -2px -2px 5px color-mix(in srgb, var(--neumo-shadow-light) 64%, transparent);
        outline: none;
        appearance: none;
        -webkit-appearance: none;
        font-family: var(--sans);
        font-size: 12px;
      }
      .vcs-select:focus {
        border-color: color-mix(in srgb, var(--rikyu) 22%, var(--neumo-surface));
        box-shadow:
          inset 2px 2px 5px color-mix(in srgb, var(--neumo-shadow-dark) 58%, transparent),
          inset -2px -2px 5px color-mix(in srgb, var(--neumo-shadow-light) 68%, transparent);
      }

      .vcs-details {
        border: 0;
        padding-top: 6px;
        background: transparent;
      }
      .vcs-details summary {
        min-height: 28px;
        padding: 2px 0;
        color: var(--sumi-soft);
        font: 650 12px/1.5 var(--sans);
        letter-spacing: 0;
        cursor: pointer;
        list-style: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .vcs-details summary::-webkit-details-marker { display: none; }
      .vcs-details-title {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .vcs-details-chevron {
        flex: 0 0 auto;
        display: inline-grid;
        place-items: center;
        width: 24px;
        height: 24px;
        color: var(--neumo-muted);
        background: var(--neumo-surface);
        border: 1px solid var(--neumo-surface);
        border-radius: 999px;
        box-shadow:
          inset 1.5px 1.5px 3px color-mix(in srgb, var(--neumo-shadow-dark) 74%, transparent),
          inset -1.5px -1.5px 3px color-mix(in srgb, var(--neumo-shadow-light) 76%, transparent);
        transition:
          color 160ms ease,
          box-shadow 180ms ease;
      }
      .vcs-details-chevron svg {
        width: 13px;
        height: 13px;
        transform: rotate(0deg);
        transform-origin: 50% 50%;
        transition: transform 190ms cubic-bezier(0.22, 1, 0.36, 1);
      }
      .vcs-details[open] .vcs-details-chevron svg { transform: rotate(90deg); }
      .vcs-details summary:hover { color: var(--sumi); }
      .vcs-details summary:hover .vcs-details-chevron {
        color: var(--neumo-text);
        box-shadow:
          inset 1px 1px 2px color-mix(in srgb, var(--neumo-shadow-dark) 64%, transparent),
          inset -1px -1px 2px color-mix(in srgb, var(--neumo-shadow-light) 70%, transparent);
      }
      .vcs-details[open] > :not(summary) {
        animation: vcs-details-reveal 260ms var(--panel-ease) both;
      }

      .vcs-transcript-box {
        display: block;
        width: 100%;
        height: 220px;
        margin-top: 6px;
        padding: 10px;
        overflow: auto;
        color: var(--sumi);
        background: var(--neumo-surface);
        border: 1px solid color-mix(in srgb, var(--neumo-surface) 86%, var(--haijiro-soft));
        border-radius: 8px;
        box-shadow:
          inset 2px 2px 6px color-mix(in srgb, var(--neumo-shadow-dark) 58%, transparent),
          inset -2px -2px 6px color-mix(in srgb, var(--neumo-shadow-light) 66%, transparent);
        outline: none;
        font: 400 11px/1.55 var(--sans);
        overscroll-behavior: contain;
      }
      .vcs-transcript-box[data-empty="true"] {
        display: grid;
        place-items: start;
        color: var(--nezumi);
      }
      .vcs-transcript-placeholder {
        color: var(--nezumi);
      }
      .vcs-transcript-box:focus {
        border-color: color-mix(in srgb, var(--rikyu) 22%, var(--neumo-surface));
      }
      .vcs-transcript-list {
        display: grid;
        gap: 2px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .vcs-transcript-item {
        margin: 0;
        padding: 0;
      }
      .vcs-transcript-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: start;
        gap: 8px;
        width: 100%;
        min-height: 28px;
        padding: 4px 5px;
        color: var(--sumi-soft);
        background: transparent;
        border: 0;
        border-radius: 5px;
        appearance: none;
        -webkit-appearance: none;
        font: inherit;
        text-align: left;
        cursor: pointer;
        transition:
          background 160ms ease,
          color 160ms ease,
          transform 160ms ease;
      }
      .vcs-transcript-row:hover {
        color: var(--sumi);
        background: color-mix(in srgb, var(--haijiro-soft) 68%, transparent);
      }
      .vcs-transcript-row.is-active {
        color: var(--sumi);
        background: color-mix(in srgb, #edf4ff 82%, transparent);
      }
      .vcs-transcript-row.is-plain {
        display: block;
        cursor: default;
      }
      .vcs-transcript-row.is-plain:hover {
        color: var(--sumi-soft);
        background: transparent;
      }
      .vcs-cue-time {
        display: inline-grid;
        place-items: center;
        min-width: 38px;
        height: 20px;
        padding: 0 7px;
        color: #5f6f8f;
        background: #eef5ff;
        border-radius: 999px;
        font: 650 10.5px/1 var(--sans);
        letter-spacing: 0;
        white-space: nowrap;
      }
      .vcs-transcript-row.is-active .vcs-cue-time {
        color: #2f4f86;
        background: #dfeeff;
      }
      .vcs-cue-text {
        min-width: 0;
        overflow-wrap: anywhere;
        white-space: normal;
      }

      .vcs-result {
        display: grid;
        justify-self: center;
        gap: 8px;
        width: min(100%, 720px);
        padding: 10px;
        background: var(--neumo-surface);
        border: 1px solid color-mix(in srgb, var(--neumo-surface) 86%, var(--haijiro-soft));
        border-radius: 8px;
        box-shadow:
          inset 2px 2px 6px color-mix(in srgb, var(--neumo-shadow-dark) 54%, transparent),
          inset -2px -2px 6px color-mix(in srgb, var(--neumo-shadow-light) 62%, transparent);
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
      .vcs-summary-details summary {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto 24px;
        align-items: center;
        gap: 8px;
        min-height: 28px;
        padding: 0;
        justify-content: initial;
      }
      .vcs-summary-details .vcs-result-title {
        min-width: 0;
        line-height: 1.3;
      }
      .vcs-summary-details #vcs-copy-summary {
        grid-column: 2;
        grid-row: 1;
        justify-self: end;
      }
      .vcs-summary-details .vcs-details-chevron {
        grid-column: 3;
        grid-row: 1;
        justify-self: end;
      }

      .vcs-summary-shell {
        width: 100%;
        max-height: clamp(260px, 42vh, 500px);
        padding: 2px 8px 2px 0;
        overflow-y: auto;
        overflow-x: hidden;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
      }
      .vcs-summary-shell.is-streaming {
        cursor: text;
      }
      .vcs-summary-shell:focus {
        outline: 2px solid color-mix(in srgb, var(--rikyu) 38%, transparent);
        outline-offset: 3px;
        border-radius: 5px;
      }
      .vcs-panel.is-floating .vcs-summary-shell {
        max-height: min(360px, 38vh);
      }
      .vcs-panel.is-embedded .vcs-summary-shell {
        max-height: clamp(300px, 48vh, 560px);
      }

      #vcs-summary {
        color: var(--sumi);
        background: transparent;
        font: 13px/1.85 var(--sans);
        letter-spacing: 0;
        overflow-wrap: anywhere;
      }
      #vcs-summary h3, #vcs-summary h4, #vcs-summary h5 {
        margin: 16px 0 6px;
        font: 650 13px/1.5 var(--sans);
        letter-spacing: 0;
        color: var(--sumi);
        padding-bottom: 4px;
        border-bottom: 1px solid var(--haijiro-soft);
      }
      #vcs-summary h3:first-child, #vcs-summary h4:first-child, #vcs-summary h5:first-child { margin-top: 0; }
      #vcs-summary p { margin: 0 0 10px; color: var(--sumi-soft); }
      #vcs-summary ul, #vcs-summary ol { margin: 0 0 10px; padding-left: 18px; color: var(--sumi-soft); }
      #vcs-summary li { margin-bottom: 4px; }
      #vcs-summary strong { color: var(--sumi); font-weight: 720; }
      #vcs-summary em { font-style: italic; }
      #vcs-summary code {
        padding: 1px 4px;
        color: var(--sumi);
        background: color-mix(in srgb, var(--haijiro-soft) 72%, transparent);
        border-radius: 4px;
        font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      #vcs-summary a {
        color: var(--sumi);
        text-decoration: underline;
        text-decoration-color: color-mix(in srgb, var(--sumi) 38%, transparent);
        text-underline-offset: 3px;
      }
      #vcs-summary hr {
        height: 1px;
        margin: 14px 0;
        background: var(--haijiro-soft);
        border: 0;
      }
      .vcs-stream-cursor {
        display: inline-block;
        width: 2px;
        min-width: 2px;
        height: 1.18em;
        margin-left: 2px;
        background: color-mix(in srgb, var(--sumi) 92%, var(--paper));
        border-radius: 999px;
        vertical-align: -0.22em;
        box-shadow:
          0 0 0 1px color-mix(in srgb, var(--sumi) 8%, transparent);
        transform-origin: center bottom;
        animation: vcs-caret-blink 620ms steps(1, end) infinite;
      }
      .vcs-collapsed-toggle {
        display: none;
        grid-template-columns: 34px minmax(0, 1fr) 22px;
        align-items: center;
        gap: 9px;
        width: 100%;
        min-height: 54px;
        padding: 8px 10px;
        color: var(--sumi);
        background: transparent;
        border: 0;
        border-radius: 0;
        cursor: pointer;
        font: 650 12px/1.2 var(--sans);
        letter-spacing: 0;
        box-shadow: none;
        transform-origin: top right;
        animation: none;
        transition:
          border-color 180ms ease,
          background 180ms ease;
      }
      .vcs-collapsed-toggle:hover {
        background: transparent;
      }
      .vcs-collapsed-toggle:hover .vcs-collapsed-arrow svg {
        transform: translateX(1px);
      }
      .vcs-collapsed-icon {
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        padding: 3px;
        background: color-mix(in srgb, var(--shu) 92%, var(--clay));
        border-radius: 7px;
        overflow: hidden;
      }
      .vcs-collapsed-icon img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      .vcs-collapsed-copy {
        display: grid;
        gap: 3px;
        min-width: 0;
      }
      .vcs-collapsed-title {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--sumi);
        font: 740 13px/1.2 var(--sans);
      }
      .vcs-collapsed-meta {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--nezumi);
        font: 520 11px/1.35 var(--sans);
      }
      .vcs-collapsed-arrow {
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        color: var(--nezumi);
      }

      .vcs-panel.is-collapsed {
        width: 100%;
        background:
          linear-gradient(90deg, color-mix(in srgb, var(--washi) 64%, transparent), transparent 58%),
          var(--paper-elevated);
        border: 1px solid color-mix(in srgb, var(--haijiro) 54%, transparent);
        overflow: hidden;
        box-shadow: none;
        animation: none;
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
        width: 186px;
      }
      .vcs-panel.is-floating.is-collapsed .vcs-collapsed-toggle {
        min-height: 48px;
        grid-template-columns: 30px minmax(0, 1fr) 18px;
        padding: 7px 9px;
      }
      .vcs-panel.is-floating.is-collapsed .vcs-collapsed-icon {
        width: 30px;
        height: 30px;
        border-radius: 7px;
      }
      .vcs-panel.is-floating.is-collapsed .vcs-collapsed-title {
        font-size: 13px;
      }
      .vcs-panel.is-floating.is-collapsed .vcs-collapsed-meta {
        max-width: 108px;
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

      @keyframes vcs-details-reveal {
        0% {
          opacity: 0;
          transform: translateY(8px);
          filter: blur(2px);
        }
        100% {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
        }
      }

      @keyframes vcs-caret-blink {
        0%, 48% { opacity: 1; transform: translateY(0) scaleY(1); }
        49%, 100% { opacity: 0.18; transform: translateY(0) scaleY(1); }
      }

      @media (prefers-reduced-motion: reduce) {
        .vcs-panel[data-tone="busy"] .vcs-progress span { animation: none; }
        .vcs-icon-button.is-spinning svg { animation: none; }
        .vcs-tool-button.is-busy svg { animation: none; }
        .vcs-stream-cursor { animation: none; }
        .vcs-panel, .vcs-collapsed-toggle, .vcs-details[open] > :not(summary) { animation: none; }
        .vcs-primary, .vcs-icon-button, .vcs-tool-button, .vcs-collapsed-toggle { transition: none; }
        .t-resize { transition: none !important; }
        .t-panel-slide { transition: none !important; }
        .t-text-swap { transition: none !important; }
        .t-icon-swap .t-icon { transition: none !important; }
      }

      @media (max-width: 1100px) {
        .vcs-panel.is-floating {
          top: auto;
          right: 16px;
          bottom: 16px;
          width: min(360px, calc(100vw - 32px));
        }
        .vcs-panel.is-floating.is-collapsed {
          width: min(220px, calc(100vw - 32px));
        }
      }
    `;
  }
})();
