import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = await readFile(resolve(rootDir, "src", "content.js"), "utf8");
const pageUrl = new URL("https://www.youtube.com/watch?v=test-video");
const context = {
  __VCS_TEST_MODE__: true,
  URL,
  URLSearchParams,
  chrome: {
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`
    }
  },
  document: {
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
  normalizeTranscriptPanelText,
  cleanTranscriptSegmentContent,
  transcriptMatchesTrackLanguage,
  detectTranscriptLanguageFamily,
  detectPlatform,
  shouldShowPanel,
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

const bilingualTranscript = [
  "[0:00] This is a detailed English transcript with several useful words.",
  "[0:04] 中文内容混合在同一条字幕里面，方便用户理解上下文。"
].join("\n");
assert.equal(detectTranscriptLanguageFamily(bilingualTranscript), "mixed");
assert.equal(transcriptMatchesTrackLanguage({ language: "en", label: "英语" }, bilingualTranscript), true);

const chineseTranscript = "[0:00] 这是一段只有中文内容的字幕文本，用来确认不会误判成英文。";
assert.equal(transcriptMatchesTrackLanguage({ language: "en", label: "English" }, chineseTranscript), false);

const simplifiedTranscript = "[0:00] 这是一段简体中文字幕，这个视频会说明学习内容与实际决策。";
const traditionalTranscript = "[0:00] 這是一段繁體中文字幕，這個影片會說明學習內容與實際決策。";
assert.equal(transcriptMatchesTrackLanguage({ language: "zh-Hant", label: "中文（台灣）" }, simplifiedTranscript), false);
assert.equal(transcriptMatchesTrackLanguage({ language: "zh-Hant", label: "中文（台灣）" }, traditionalTranscript), true);
assert.equal(transcriptMatchesTrackLanguage({ language: "zh-Hans", label: "中文（简体）" }, simplifiedTranscript), true);
assert.equal(transcriptMatchesTrackLanguage({ language: "zh-Hans", label: "中文（简体）" }, traditionalTranscript), false);

setLocation("https://www.youtube.com/watch?v=test-video");
assert.equal(isYouTubeShortsPage(), false);
assert.equal(JSON.stringify(detectPlatform()), JSON.stringify({ id: "youtube", name: "YouTube", kind: "youtube" }));
assert.equal(shouldShowPanel(), true);

setLocation("https://www.youtube.com/shorts/test-short");
assert.equal(isYouTubeShortsPage(), true);
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
