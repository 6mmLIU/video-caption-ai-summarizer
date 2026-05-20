import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = await readFile(resolve(rootDir, "src", "content.js"), "utf8");
const pageUrl = new URL("https://www.youtube.com/watch?v=test-video");
let testNow = 1000;
class TestDate extends Date {
  static now() {
    return testNow;
  }
}
const context = {
  __VCS_TEST_MODE__: true,
  Date: TestDate,
  URL,
  URLSearchParams,
  chrome: {
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`
    }
  },
  document: {
    title: "",
    documentElement: {
      dataset: {},
      appendChild() {}
    },
    scripts: [],
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    createElement(tagName) {
      return testElement({ tagName: String(tagName || "div").toUpperCase() });
    },
    getElementById() {
      return null;
    }
  },
  location: pageUrl,
  navigator: {},
  performance: {
    now: () => 0,
    getEntriesByType: () => []
  },
  window: {
    __VCS_CONTENT_LOADED__: false,
    setTimeout,
    clearTimeout
  },
  setTimeout,
  clearTimeout
};

vm.createContext(context);
vm.runInContext(source, context, { filename: "src/content.js" });

const {
  parseYouTubeTranscriptSegment,
  parseYouTubeTimedTextResponse,
  normalizeTranscriptPanelText,
  cleanTranscriptSegmentContent,
  transcriptMatchesTrackLanguage,
  detectTranscriptLanguageFamily,
  getTrackLanguageFamily,
  getYouTubeTranslationSourceTracks,
  normalizeTedSubtitleTracks,
  getTedPlayerData,
  getTedMetadataUrl,
  setTestTracks,
  setTestPlatform,
  getVideoTitle,
  detectPlatform,
  shouldShowPanel,
  findEmbedTarget,
  getRootInsertBefore,
  findTedEmbedTarget,
  isYouTubeShortsPage
} = context.__VCS_TEST_HOOKS__;

assert.equal(
  parseYouTubeTranscriptSegment(textSegment("0:07\n7秒钟To acquire Manus, a company based in mainland China.")),
  "[0:07] To acquire Manus, a company based in mainland China."
);

assert.equal(
  parseYouTubeTranscriptSegment(structuredSegment("0:11", "11秒钟We will come to care today.")),
  "[0:11] We will come to care today."
);

assert.equal(
  normalizeTranscriptPanelText(`
    转写文稿
    0:00 Come and check on me.
    0:07 7秒钟To acquire Manus, a company based in mainland China.
    0:11
    11秒钟We will come to care today.
    Search transcript
  `),
  [
    "[0:00] Come and check on me.",
    "[0:07] To acquire Manus, a company based in mainland China.",
    "[0:11] We will come to care today."
  ].join("\n")
);

assert.equal(
  cleanTranscriptSegmentContent("7秒钟To acquire Manus", ""),
  "7秒钟To acquire Manus"
);

assert.equal(
  cleanTranscriptSegmentContent("7秒钟To acquire Manus", "0:11"),
  "7秒钟To acquire Manus"
);

assert.equal(
  cleanTranscriptSegmentContent("7秒钟黄仁勋把芯片卖给中国。", "0:07"),
  "黄仁勋把芯片卖给中国。"
);

assert.equal(
  cleanTranscriptSegmentContent("11 seconds We will come to care today.", "0:11"),
  "We will come to care today."
);

assert.equal(
  parseYouTubeTimedTextResponse(`
    <?xml version="1.0" encoding="utf-8" ?>
    <timedtext>
      <body>
        <p t="64700" d="866">這些農民協會呢</p>
        <p t="65566" d="1967"><s>就變成了</s><s>西腊新的基層組織</s></p>
        <p t="67533" d="2200">農民協會舉行了&#x5BA3;&#x50B3;系列的吐苦水</p>
      </body>
    </timedtext>
  `, "srv3"),
  [
    "[1:04] 這些農民協會呢",
    "[1:05] 就變成了西腊新的基層組織",
    "[1:07] 農民協會舉行了宣傳系列的吐苦水"
  ].join("\n")
);

assert.equal(
  parseYouTubeTimedTextResponse(`
    <transcript>
      <text start="7.5" dur="1.2">Tom &amp; team explain captions.</text>
    </transcript>
  `, ""),
  "[0:07] Tom & team explain captions."
);

assert.equal(
  parseYouTubeTimedTextResponse("<timedtext><body></body></timedtext>", "srv3"),
  ""
);

const bilingualTranscript = [
  "[0:00] This is a detailed English transcript with several useful words.",
  "[0:04] 中文内容混合在同一条字幕里面，方便用户理解上下文。"
].join("\n");
assert.equal(detectTranscriptLanguageFamily(bilingualTranscript), "mixed");
assert.equal(transcriptMatchesTrackLanguage({ language: "en", label: "英语" }, bilingualTranscript), true);

const chineseTranscript = "[0:00] 这是一段只有中文内容的字幕文本，用来确认不会误判成英文。";
assert.equal(transcriptMatchesTrackLanguage({ language: "en", label: "English" }, chineseTranscript), false);
assert.equal(getTrackLanguageFamily({ language: "ja", label: "日文" }), "ja");
assert.equal(detectTranscriptLanguageFamily("[0:00] これは日本語の字幕です。動画の内容を説明します。"), "ja");
assert.equal(transcriptMatchesTrackLanguage({ language: "ja", label: "日文" }, chineseTranscript), false);

const simplifiedTranscript = "[0:00] 这是一段简体中文字幕，这个视频会说明学习内容与实际决策。";
const traditionalTranscript = "[0:00] 這是一段繁體中文字幕，這個影片會說明學習內容與實際決策。";
assert.equal(transcriptMatchesTrackLanguage({ language: "zh-Hant", label: "中文（台灣）" }, simplifiedTranscript), false);
assert.equal(transcriptMatchesTrackLanguage({ language: "zh-Hant", label: "中文（台灣）" }, traditionalTranscript), true);
assert.equal(transcriptMatchesTrackLanguage({ language: "zh-Hans", label: "中文（简体）" }, simplifiedTranscript), true);
assert.equal(transcriptMatchesTrackLanguage({ language: "zh-Hans", label: "中文（简体）" }, traditionalTranscript), false);

setTestTracks([
  { id: "target", language: "ja", label: "日文", source: "youtube", url: "https://www.youtube.com/api/timedtext?v=test-video&lang=ja" },
  { id: "en", language: "en", label: "English", source: "youtube", url: "https://www.youtube.com/api/timedtext?v=test-video&lang=en&kind=asr" },
  { id: "zh", language: "zh-Hans", label: "中文（简体）", source: "youtube", url: "https://www.youtube.com/api/timedtext?v=test-video&lang=zh-Hans" },
  { id: "fr", language: "fr", label: "French", source: "youtube", url: "https://www.youtube.com/api/timedtext?v=test-video&lang=fr" }
]);
assert.deepEqual(
  getYouTubeTranslationSourceTracks({ id: "target", language: "ja", label: "日文", source: "youtube" }).map((track) => track.id),
  ["en", "zh"]
);

setLocation("https://www.youtube.com/watch?v=test-video");
assert.equal(isYouTubeShortsPage(), false);
assert.equal(JSON.stringify(detectPlatform()), JSON.stringify({ id: "youtube", name: "YouTube", kind: "youtube" }));
assert.equal(shouldShowPanel(), true);

setLocation("https://www.youtube.com/shorts/test-short");
assert.equal(isYouTubeShortsPage(), true);
assert.equal(detectPlatform(), null);
assert.equal(shouldShowPanel(), false);

setLocation("https://www.youtube.com/watch?v=current-video");
setTestPlatform({ id: "youtube", name: "YouTube", kind: "youtube" });
context.document.title = "Previous Video - YouTube";
context.document.querySelector = (selector) => (
  selector.includes("h1") ? { textContent: "Previous Video" } : null
);
context.ytInitialPlayerResponse = {
  videoDetails: {
    videoId: "current-video",
    title: "Current Video"
  }
};
assert.equal(getVideoTitle(), "Current Video");

context.ytInitialPlayerResponse = {
  videoDetails: {
    videoId: "previous-video",
    title: "Previous Video"
  }
};
assert.equal(getVideoTitle(), "Previous Video");

setLocation("https://www.bilibili.com/video/BVNEW");
setTestPlatform({ id: "bilibili", name: "Bilibili", kind: "bilibili" });
const bilibiliUpCard = testElement({ className: "up-panel-container" });
const bilibiliDanmaku = testElement({ id: "danmukuBox", className: "danmaku-box" });
const bilibiliEpisodeList = testElement({ className: "video-pod__list", attributes: { "data-testid": "video-pod" } });
const rightInner = testElement({
  className: "right-container-inner",
  children: [bilibiliUpCard, bilibiliDanmaku, bilibiliEpisodeList]
});
const rightContainer = testElement({
  className: "right-container",
  children: [rightInner]
});
rightInner.parentElement = rightContainer;
context.document.getElementById = (id) => findDescendant(rightContainer, (element) => element.id === id);
context.document.querySelector = (selector) => (
  selector === ".right-container-inner" ? rightInner : null
);
assert.equal(findEmbedTarget(), context.document.documentElement);
assert.equal(rightInner.children.length, 3);
assert.equal(rightInner.children.includes(bilibiliUpCard), true);
assert.equal(rightInner.children.includes(bilibiliDanmaku), true);
assert.equal(rightInner.children.includes(bilibiliEpisodeList), true);

context.document.title = "Current Bilibili_哔哩哔哩_bilibili";
context.document.scripts = [{
  textContent: 'window.__INITIAL_STATE__={"videoData":{"bvid":"BVOLD","title":"Old Bilibili"}};'
}];
context.document.querySelector = (selector) => (
  selector.includes("video-title") ? { textContent: "Current Bilibili" } : null
);
assert.equal(getVideoTitle(), "Current Bilibili");

context.document.querySelector = () => null;
assert.equal(getVideoTitle(), "Current Bilibili");

setLocation("https://www.ted.com/talks/example_ted_talk");
setTestPlatform({ id: "ted", name: "TED", kind: "ted" });
const tedSticky = testElement({ className: "lg:sticky lg:top-4" });
const tedSideRail = testElement({
  className: "order-last px-5 lg:order-none lg:w-[425px] lg:shrink-0 xl:w-[536px]",
  children: [tedSticky]
});
const tedMainColumn = testElement({});
const tedLayout = testElement({
  className: "flex w-full flex-col lg:flex-row",
  children: [tedMainColumn, tedSideRail]
});
const transcriptControl = testElement({ id: "transcript-control", parentElement: tedMainColumn });
tedMainColumn.parentElement = tedLayout;
tedSideRail.parentElement = tedLayout;
tedSticky.parentElement = tedSideRail;
context.document.querySelector = (selector) => {
  if (selector === "#transcript-control") {
    return transcriptControl;
  }
  if (selector === "#talk-title h1") {
    return { textContent: "TED DOM Title" };
  }
  return null;
};
const tedPlayerData = {
  title: "TED Metadata Title",
  resources: {
    hls: {
      metadata: "https://hls.ted.com/project_masters/8855/metadata.json?intro_master_id=9294"
    }
  }
};
context.document.getElementById = (id) => (
  id === "__NEXT_DATA__"
    ? {
        textContent: JSON.stringify({
          props: {
            pageProps: {
              videoData: {
                playerData: JSON.stringify(tedPlayerData)
              }
            }
          }
        })
      }
    : null
);
assert.equal(JSON.stringify(detectPlatform()), JSON.stringify({ id: "ted", name: "TED", kind: "ted" }));
assert.equal(shouldShowPanel(), true);
assert.equal(findTedEmbedTarget(), tedSticky);
assert.equal(findEmbedTarget(), tedSticky);
assert.equal(getTedMetadataUrl(getTedPlayerData()), tedPlayerData.resources.hls.metadata);
assert.equal(getVideoTitle(), "TED DOM Title");
assert.deepEqual(
  normalizeTedSubtitleTracks([
    { code: "en", name: "English", webvtt: "https://hls.ted.com/project_masters/8855/subtitles/en/full.vtt?intro_master_id=9294" },
    { code: "zh-cn", name: "Chinese, Simplified", webvtt: "/project_masters/8855/subtitles/zh-cn/full.vtt?intro_master_id=9294" },
    { code: "en", name: "Duplicate English", webvtt: "https://hls.ted.com/project_masters/8855/subtitles/en/full.vtt?intro_master_id=9294" }
  ], tedPlayerData.resources.hls.metadata).map((track) => ({
    id: track.id,
    label: track.label,
    language: track.language,
    source: track.source,
    url: track.url
  })),
  [
    {
      id: "ted-0",
      label: "English",
      language: "en",
      source: "ted",
      url: "https://hls.ted.com/project_masters/8855/subtitles/en/full.vtt?intro_master_id=9294"
    },
    {
      id: "ted-1",
      label: "Chinese, Simplified",
      language: "zh-cn",
      source: "ted",
      url: "https://hls.ted.com/project_masters/8855/subtitles/zh-cn/full.vtt?intro_master_id=9294"
    }
  ]
);

setLocation("https://www.ted.com/about");
assert.equal(detectPlatform(), null);
assert.equal(shouldShowPanel(), false);

function textSegment(text) {
  return {
    innerText: text,
    textContent: text,
    getAttribute() {
      return "";
    },
    querySelector() {
      return null;
    }
  };
}

function testElement(props = {}) {
  const styleValues = new Map();
  const element = {
    tagName: props.tagName || "DIV",
    id: props.id || "",
    className: props.className || "",
    textContent: props.textContent || "",
    children: props.children ? [...props.children] : [],
    parentElement: props.parentElement || null,
    nextSibling: props.nextSibling || null,
    nextElementSibling: props.nextElementSibling || null,
    attributes: { ...(props.attributes || {}) },
    get firstChild() {
      return this.children[0] || null;
    },
    get firstElementChild() {
      return this.children[0] || null;
    },
    style: {
      setProperty(name, value) {
        styleValues.set(name, String(value));
      },
      getPropertyValue(name) {
        return styleValues.get(name) || "";
      },
      getPropertyPriority() {
        return "";
      },
      removeProperty(name) {
        styleValues.delete(name);
      }
    },
    remove() {
      if (!this.parentElement) {
        return;
      }
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      syncChildSiblings(this.parentElement);
      this.parentElement = null;
    },
    insertBefore(child, before) {
      child.remove?.();
      const nextIndex = before ? this.children.indexOf(before) : -1;
      const insertIndex = nextIndex >= 0 ? nextIndex : this.children.length;
      this.children.splice(insertIndex, 0, child);
      child.parentElement = this;
      syncChildSiblings(this);
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name] || "";
    },
    querySelector(selector) {
      if (selector === "[class*='lg:sticky']") {
        return findDescendant(this, (element) => String(element.className || "").includes("lg:sticky"));
      }
      return null;
    }
  };
  element.children.forEach((child) => {
    child.parentElement = element;
  });
  syncChildSiblings(element);
  return element;
}

function syncChildSiblings(parent) {
  (parent.children || []).forEach((child, index, children) => {
    child.nextSibling = children[index + 1] || null;
    child.nextElementSibling = children[index + 1] || null;
  });
}

function findDescendant(element, predicate) {
  for (const child of element.children || []) {
    if (predicate(child)) {
      return child;
    }
    const match = findDescendant(child, predicate);
    if (match) {
      return match;
    }
  }
  return null;
}

function setLocation(url) {
  context.location = new URL(url);
}

function structuredSegment(time, content) {
  return {
    innerText: `${time}\n${content}`,
    textContent: `${time}\n${content}`,
    getAttribute() {
      return "";
    },
    querySelector(selector) {
      if (selector.includes("timestamp")) {
        return { textContent: time };
      }
      if (selector.includes("segment-text")) {
        return {
          innerText: content,
          textContent: content
        };
      }
      return null;
    }
  };
}
