# Video Caption AI Summarizer

Video Caption AI Summarizer is a Chromium extension that reads available video captions and turns them into structured AI summaries. It is designed for viewers who want to understand long-form videos faster, review lectures more efficiently, and keep key takeaways without manually copying transcripts.

Video Caption AI Summarizer 是一款 Chromium 浏览器扩展，用于读取视频页面已经向浏览器暴露的字幕内容，并通过用户自选的 AI 服务生成结构化摘要。它适合用于快速理解长视频、复盘课程内容、整理访谈观点，或把零散字幕转化为更清晰的阅读材料。

---

## 中文说明

### 主要能力

- **多平台字幕读取**：支持 YouTube、YouTube Shorts、Bilibili、Vimeo、TED，以及带有标准 HTML5 字幕轨道或页面可见转写文稿的通用视频页面。Coursera 等课程网站可通过工具栏入口尝试注入面板读取。
- **智能摘要面板**：在支持的视频页面自动显示 `Video Caption AI` 浮动面板，可选择字幕轨、预览字幕、复制字幕，并直接生成 Markdown 摘要。
- **多服务配置**：支持保存多个摘要服务配置并随时切换。当前支持 OpenAI 兼容接口、Claude、Gemini、Ollama、本地 OpenAI 兼容服务，以及自定义专用服务地址。
- **常用服务预设**：内置 DeepSeek、OpenAI / ChatGPT、Claude、Gemini、Kimi、通义千问、智谱 GLM、Ollama 和专用服务配置模板，方便快速填写端点与模型信息。
- **长字幕分段处理**：长视频字幕会先按设定字符数分段提炼，再合并为最终摘要，降低超长上下文导致的请求失败风险。
- **流式输出体验**：在服务支持的情况下，摘要会以实时流式方式显示，减少等待过程中的不确定感。
- **双语界面**：设置页和弹窗支持中文（简体）与 English，摘要输出语言也可单独设置。
- **可定制 Prompt**：支持自定义总结 Prompt 与输出模板，可使用 `{{title}}`、`{{platform}}`、`{{url}}`、`{{language}}`、`{{transcript}}`、`{{outputTemplate}}` 等变量。
- **隐私控制**：可关闭时间戳发送、配置敏感词替换、选择是否保存最近 30 条摘要历史；默认不保存摘要历史。
- **配置导入导出**：支持导入、导出设置。导出的配置会自动移除 API Key 与访问口令，便于安全迁移。

### 安装方式

1. 下载或克隆本仓库到本地。
2. 打开 Chrome、Edge 或其他 Chromium 浏览器。
3. 进入 `chrome://extensions` 或 `edge://extensions`。
4. 打开右上角的“开发者模式”。
5. 点击“加载已解压的扩展程序”。
6. 选择本项目目录。

安装完成后，建议先进入扩展设置页，完成摘要服务配置，再打开视频页面使用。

### 配置摘要服务

在设置页的“摘要服务”区域，可以新增或编辑多个服务配置：

- **OpenAI 兼容服务**：适用于 DeepSeek、OpenAI、Kimi、通义千问、智谱 GLM，以及其他兼容 `/v1/chat/completions` 的服务。
- **Claude**：使用 Anthropic Messages API。
- **Gemini**：填写 API Key 和模型名称即可；未手动填写端点时，扩展会按模型名称生成 Gemini API 地址。
- **Ollama / 本地 OpenAI 兼容服务**：默认使用 `http://localhost:11434/v1/chat/completions`。
- **专用服务地址**：适合已有自建后端代理的用户，可使用访问口令保护服务。

请根据所选服务填写 API Key、模型名称、Temperature、最大输出 Token 等参数。不同服务对模型名称和额度策略要求不同，请以对应服务商控制台为准。

### 使用流程

1. 打开一个包含字幕或转写内容的视频页面。
2. 在 YouTube、Bilibili、Vimeo、TED 等页面，扩展会自动显示浮动面板。
3. 在其他通用视频页面，可点击浏览器工具栏中的扩展图标，再选择显示面板或解析当前视频。
4. 在面板中选择需要处理的字幕轨道。
5. 预览字幕内容，确认无误后点击 `解析字幕`。
6. 等待 AI 服务返回结果；摘要会以 Markdown 结构显示，可一键复制。

如果页面没有直接暴露字幕轨道，可以先打开网站自带的 transcript / 转写文稿面板，再刷新或重新检测字幕。

### 隐私与数据说明

本扩展的核心原则是让用户清楚知道数据流向：

- API Key 与访问口令保存在当前浏览器的本地扩展存储中。
- 生成摘要时，扩展会把字幕文本以及必要的视频信息发送给你配置的摘要服务。
- 可在设置中关闭时间戳发送，或在发送前替换指定敏感词。
- 摘要历史默认关闭；开启后仅保存在本机浏览器存储中，最多保留最近 30 条。
- 导出设置时，扩展会移除 API Key 与访问口令。

请仅在你信任的设备和服务商环境中配置密钥；如果视频内容涉及隐私、商业机密或受版权保护的材料，请根据你的使用场景谨慎处理。

### 支持边界

扩展只能读取页面或平台接口已经暴露给浏览器的字幕数据。以下情况可能无法稳定处理：

- 字幕被烧录在视频画面中，或绘制在 canvas 中。
- 字幕接口需要复杂签名、DRM、额外设备校验或非浏览器可访问的授权。
- 当前账号没有权限查看字幕或转写文稿。
- 平台频繁变更前端结构，导致字幕轨道位置发生变化。
- 视频本身没有字幕，且页面没有可见转写文本。

遇到读取失败时，可以尝试切换字幕轨、展开平台自带转写文稿、刷新页面，或使用工具栏弹窗重新注入面板。

### 项目结构

```text
manifest.json          # Chromium Manifest V3 配置
src/background.js      # 字幕跨域读取、摘要服务调用、分段与历史处理
src/content.js         # 视频页浮动面板、平台识别、字幕提取与交互
src/i18n.js            # 中文 / English 界面文案
options/options.html   # 设置页
options/options.css
options/options.js
popup/popup.html       # 浏览器工具栏弹窗
popup/popup.css
popup/popup.js
tests/fixtures/        # 本地测试视频页和字幕文件
tests/smoke-extension.mjs
```

### 开发说明

本项目不需要构建步骤，可直接作为“已解压的扩展程序”加载。开发调试时，可以在浏览器扩展管理页重新加载扩展，再刷新目标视频页面确认面板、设置页和弹窗行为。

---

## English

### What It Does

Video Caption AI Summarizer helps you turn video captions into concise, structured summaries without locking you into a single AI provider. It reads caption data that is already available to the browser, sends the selected transcript to your configured AI service, and displays the result directly on the video page.

### Key Features

- **Caption extraction across platforms**: Works with YouTube, YouTube Shorts, Bilibili, Vimeo, TED, and generic HTML5 video pages with caption tracks or visible transcripts. Course platforms such as Coursera can be tried through toolbar-based injection when the page exposes readable text.
- **Floating video-page panel**: Select caption tracks, preview transcripts, copy raw captions, and generate Markdown summaries from the page itself.
- **Multiple AI service profiles**: Save and switch between different providers and models.
- **Provider support**: Supports OpenAI-compatible APIs, Claude, Gemini, Ollama, local OpenAI-compatible services, and custom backend proxy endpoints.
- **Built-in presets**: Includes templates for DeepSeek, OpenAI / ChatGPT, Claude, Gemini, Kimi, Qwen, Zhipu GLM, Ollama, and custom services.
- **Long transcript handling**: Splits long captions into chunks, summarizes each part, and merges the results into one final summary.
- **Streaming summaries**: Displays live output when the selected service supports streaming responses.
- **Bilingual UI**: The options page and popup support Simplified Chinese and English. The summary output language can be configured separately.
- **Custom prompts**: Customize the prompt and output template with variables such as `{{title}}`, `{{platform}}`, `{{url}}`, `{{language}}`, `{{transcript}}`, and `{{outputTemplate}}`.
- **Privacy controls**: Toggle timestamp sharing, redact sensitive terms before sending, and choose whether to keep local summary history.
- **Safe settings export**: Exported settings do not include API keys or access tokens.

### Installation

1. Download or clone this repository.
2. Open Chrome, Edge, or another Chromium-based browser.
3. Go to `chrome://extensions` or `edge://extensions`.
4. Enable Developer Mode.
5. Click **Load unpacked**.
6. Select this project directory.

After installation, open the extension options page and configure at least one summary service before using the extension on video pages.

### Summary Service Setup

The options page lets you create and manage multiple service profiles:

- **OpenAI-compatible service**: For DeepSeek, OpenAI, Kimi, Qwen, Zhipu GLM, and any service compatible with `/v1/chat/completions`.
- **Claude**: Uses the Anthropic Messages API.
- **Gemini**: Provide an API key and model name. If no endpoint is entered, the extension generates the Gemini endpoint from the model name.
- **Ollama / local OpenAI-compatible service**: Defaults to `http://localhost:11434/v1/chat/completions`.
- **Custom service URL**: For users who already operate their own backend proxy, optionally protected by an access token.

Model names, token limits, quotas, and availability vary by provider. Please confirm those values in the corresponding provider console.

### How to Use

1. Open a video page with captions or transcript text.
2. On supported pages such as YouTube, Bilibili, Vimeo, and TED, the floating panel appears automatically.
3. On other video pages, click the extension icon in the browser toolbar and ask the extension to show the panel or summarize the current video.
4. Select the caption track you want to summarize.
5. Review the transcript preview, then click `解析字幕` / `Summarize`.
6. Wait for the AI service to respond. The summary is rendered as Markdown and can be copied with one click.

If direct caption tracks are unavailable, open the website's built-in transcript panel first, then refresh or re-detect captions.

### Privacy and Data Handling

The extension is intentionally transparent about what it stores and sends:

- API keys and access tokens are stored locally in the browser extension storage.
- When summarizing, the selected transcript and necessary video metadata are sent to the AI service you configured.
- Timestamp sharing can be disabled, and sensitive terms can be redacted before requests are sent.
- Summary history is disabled by default. If enabled, it is stored locally and limited to the latest 30 items.
- Settings export automatically removes API keys and access tokens.

Use trusted devices and providers when entering secrets. For private, confidential, copyrighted, or regulated content, review your own usage requirements before sending transcripts to any AI service.

### Support Boundaries

The extension can only read caption data that the browser can access. It may not work reliably when:

- Captions are burned into the video image or rendered only on canvas.
- Caption APIs require complex signatures, DRM, device attestation, or non-browser authorization.
- Your current account cannot access the captions or transcript.
- A platform changes its frontend structure or caption API behavior.
- The video has no captions and no visible transcript text.

When caption loading fails, try another caption track, open the platform transcript panel, refresh the page, or use the toolbar popup to inject the panel again.

### Repository Layout

```text
manifest.json          # Chromium Manifest V3 configuration
src/background.js      # Caption fetching, AI requests, chunking, and history handling
src/content.js         # Floating panel, platform detection, caption extraction, and page UI
src/i18n.js            # Simplified Chinese / English UI strings
options/options.html   # Options page
options/options.css
options/options.js
popup/popup.html       # Browser toolbar popup
popup/popup.css
popup/popup.js
tests/fixtures/        # Local test video page and caption fixtures
tests/smoke-extension.mjs
```

### Development Notes

No build step is required. Load the repository directly as an unpacked extension. During development, reload the extension from the browser extension management page, then refresh the target video page to verify the floating panel, options page, and toolbar popup.
