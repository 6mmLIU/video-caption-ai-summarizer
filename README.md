# Video Caption AI Summarizer

Video Caption AI Summarizer is a Chromium extension for turning video captions and transcripts into structured AI summaries. It is designed for people who frequently watch long videos, courses, interviews, product demos, or research talks and want a cleaner way to capture the essential points.

Video Caption AI Summarizer 是一款 Chromium 浏览器扩展，用于读取视频字幕、页面转写文本或手动粘贴的字幕内容，并通过用户自选的 AI API 生成结构化摘要。它适合学习复盘、资料整理、会议/访谈回顾，以及需要从长视频中快速提取要点的使用场景。

---

## 中文说明

### 核心能力

- **YouTube 字幕读取**：读取播放器页面中的 `captionTracks`，并抓取可用字幕内容。
- **Bilibili 字幕读取**：识别页面中的 `bvid` / `cid`，请求 B 站可用字幕接口。
- **通用视频页面支持**：读取标准 HTML5 `<video><track>` 字幕、VTT/SRT 字幕，以及页面可见的 transcript / caption 文本。
- **手动粘贴兜底**：当平台没有暴露可读取字幕时，可以把字幕或转写文本粘贴到浮动面板中再总结。
- **视频页浮动面板**：在视频页面上直接选择字幕轨、预览字幕、复制字幕、发起摘要，并查看模型返回结果。
- **工具栏弹窗**：可从浏览器工具栏查看当前页面状态、切换面板，或直接触发当前视频解析。
- **多 API 配置**：支持保存多个 API 配置，并在不同服务和模型之间切换。
- **服务预设**：内置 DeepSeek、OpenAI / ChatGPT、Claude、Gemini、Kimi、通义千问、智谱 GLM、小米 MiMo、Ollama 等常用配置模板。
- **开放模型名称**：模型名称由用户手动填写，不锁定在固定列表中，便于使用新模型或私有部署模型。
- **长字幕分段处理**：长视频会先按设定字符数分段提炼，再合并为最终摘要，降低超长文本请求失败的概率。
- **自定义 Prompt**：支持自定义总结 Prompt 与输出模板，可使用 `{{title}}`、`{{platform}}`、`{{url}}`、`{{language}}`、`{{transcript}}`、`{{outputTemplate}}` 等变量。
- **隐私控制**：可关闭时间戳发送、设置敏感词替换，并选择是否在本机保存最近 30 条摘要历史。
- **外观设置**：支持自动、浅色、深色主题，并可控制是否在视频页自动显示浮动面板。

### 安装方式

1. 下载或克隆本仓库到本地。
2. 打开 Chrome、Edge 或其他 Chromium 浏览器。
3. 进入 `chrome://extensions` 或 `edge://extensions`。
4. 打开右上角的“开发者模式”。
5. 点击“加载已解压的扩展程序”。
6. 选择本项目目录。

安装完成后，建议先打开扩展设置页，配置 API 服务、模型名称和输出语言，再进入视频页面使用。

### API 配置

在设置页的“API 模型”区域，可以新增、删除和切换配置。

- **OpenAI 兼容接口**：适用于 DeepSeek、OpenAI / ChatGPT、Kimi、通义千问、智谱 GLM、小米 MiMo，以及其他兼容 `/v1/chat/completions` 的服务。
- **Anthropic Claude**：适用于 Claude Messages API。
- **Google Gemini**：可使用 Gemini API；如果没有填写接口地址，扩展会根据模型名称生成 Gemini 请求地址。
- **Ollama / 本地 OpenAI 兼容服务**：默认使用 `http://localhost:11434/v1/chat/completions`，适合本地模型或局域网内的兼容服务。

需要填写的关键参数包括接口地址、API Key、模型名称、Temperature 和最大输出 Token。不同服务商对模型名称、额度、上下文长度和安全策略的要求不同，请以对应服务商控制台为准。

### 使用流程

1. 打开一个包含视频、字幕或转写内容的页面。
2. 如果页面符合自动识别条件，扩展会显示 `Video Caption AI` 浮动面板。
3. 如果面板没有自动显示，可点击浏览器工具栏中的扩展图标，尝试切换面板或解析当前视频。
4. 在面板中选择字幕轨道，并查看字幕预览。
5. 如果没有读取到字幕，可以展开“手动粘贴字幕”，粘贴字幕或转写文本。
6. 点击解析按钮，等待 AI API 返回摘要。
7. 根据需要复制字幕或摘要内容。

如果平台自带 transcript / 转写文稿入口，建议先在网页中展开该内容，再刷新页面或重新检测字幕。

### 隐私与数据说明

本扩展会把用户选择的字幕文本发送到已配置的 AI 服务，以便生成摘要。使用前请确认你信任对应的 API 服务商或自建服务。

- API Key 保存在当前浏览器的扩展本地存储中。
- 摘要请求会包含字幕文本，以及标题、平台、链接等用于生成摘要的上下文信息。
- 可以关闭时间戳发送，也可以配置敏感词，在发送前自动替换。
- 摘要历史默认取决于设置项；启用后会保存在本机浏览器存储中，最多保留最近 30 条。
- 当前配置导出会复制完整配置 JSON，可能包含 API Key。请只在可信环境中导出，并在分享前手动移除密钥。
- 为了兼容不同视频网站的字幕读取方式，当前扩展声明了较宽的站点访问权限。请仅从可信来源安装和使用本扩展。

如果视频内容涉及隐私、商业机密、受版权保护材料或合规要求，请在发送给第三方 AI 服务前谨慎评估。

### 支持边界

扩展只能读取浏览器能够访问到的字幕或文本。以下情况可能无法稳定自动处理：

- 字幕被烧录在视频画面中，或只绘制在 canvas 上。
- 字幕接口需要复杂签名、DRM、设备校验或非浏览器可访问的授权。
- 当前账号没有权限查看字幕或转写文稿。
- 平台更新页面结构或字幕接口，导致读取逻辑暂时失效。
- 视频本身没有字幕，也没有页面可见的转写文本。

遇到读取失败时，可以尝试切换字幕轨、展开平台自带转写文稿、刷新页面，或使用手动粘贴模式。

### 项目结构

```text
manifest.json          # Chromium Manifest V3 配置
src/background.js      # 字幕跨域读取、AI API 调用、长字幕分段、历史保存
src/content.js         # 视频页浮动面板、平台识别、字幕提取、手动粘贴入口
options/options.html   # 设置页
options/options.css
options/options.js
popup/popup.html       # 浏览器工具栏弹窗
popup/popup.css
popup/popup.js
icons/                 # 扩展图标资源
tests/fixtures/        # 本地测试页面和字幕文件
tests/smoke-extension.mjs
```

### 开发说明

本项目不需要构建步骤，可以直接作为“已解压的扩展程序”加载。修改源码后，在浏览器扩展管理页点击重新加载，再刷新目标视频页面即可验证。

---

## English

### Overview

Video Caption AI Summarizer helps you summarize video captions with your own AI API. It works with platform caption data, standard HTML5 caption tracks, visible transcript text, and manually pasted transcripts when automatic extraction is not available.

### Key Features

- **YouTube support**: Reads available `captionTracks` from the player page.
- **Bilibili support**: Detects `bvid` / `cid` and requests available Bilibili subtitles.
- **Generic video support**: Reads standard HTML5 `<video><track>` captions, VTT/SRT files, and visible transcript / caption text on the page.
- **Manual transcript fallback**: Paste captions or transcripts into the floating panel when a site does not expose readable captions.
- **Floating page panel**: Select caption tracks, preview transcript text, copy captions, request summaries, and view AI output directly on the video page.
- **Toolbar popup**: Check page status, toggle the panel, or trigger summarization from the browser toolbar.
- **Multiple API profiles**: Save and switch between different providers, endpoints, API keys, and model names.
- **Provider presets**: Includes templates for DeepSeek, OpenAI / ChatGPT, Claude, Gemini, Kimi, Qwen, Zhipu GLM, Xiaomi MiMo, and Ollama.
- **Flexible model names**: Enter any model name supported by your provider instead of choosing from a fixed list.
- **Long transcript handling**: Splits long transcripts into chunks, summarizes each chunk, and merges the result into a final summary.
- **Custom prompts**: Customize the prompt and output template with `{{title}}`, `{{platform}}`, `{{url}}`, `{{language}}`, `{{transcript}}`, and `{{outputTemplate}}`.
- **Privacy controls**: Toggle timestamp sharing, redact sensitive terms, and choose whether to keep the latest 30 summaries locally.
- **Appearance settings**: Supports auto, light, and dark themes, plus a setting for automatic panel display.

### Installation

1. Download or clone this repository.
2. Open Chrome, Edge, or another Chromium-based browser.
3. Go to `chrome://extensions` or `edge://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select this project directory.

After installation, open the extension options page and configure your API service, model name, and preferred summary language before using it on video pages.

### API Setup

The options page lets you create, delete, and switch between API profiles.

- **OpenAI-compatible APIs**: For DeepSeek, OpenAI / ChatGPT, Kimi, Qwen, Zhipu GLM, Xiaomi MiMo, and other services compatible with `/v1/chat/completions`.
- **Anthropic Claude**: For Claude Messages API.
- **Google Gemini**: For Gemini API. If no endpoint is entered, the extension generates the Gemini request URL from the model name.
- **Ollama / local OpenAI-compatible services**: Defaults to `http://localhost:11434/v1/chat/completions`, suitable for local models or LAN-hosted compatible APIs.

Required values typically include endpoint, API key, model name, temperature, and maximum output tokens. Provider behavior varies, so confirm model names, quota limits, context windows, and safety policies in the provider console.

### How to Use

1. Open a page with a video, captions, or transcript text.
2. If the page matches the extension's detection logic, the `Video Caption AI` floating panel appears automatically.
3. If the panel does not appear, click the browser toolbar icon and try toggling the panel or summarizing the current video.
4. Select a caption track and review the transcript preview.
5. If no captions are detected, open the manual transcript section and paste your captions or transcript text.
6. Start summarization and wait for the configured AI API to respond.
7. Copy the transcript or generated summary when needed.

When a platform provides a built-in transcript panel, open it first, then refresh the page or re-detect captions.

### Privacy and Data Handling

The extension sends the selected transcript to your configured AI service to generate a summary. Use a provider or self-hosted service you trust.

- API keys are stored in local browser extension storage.
- Summary requests may include transcript text plus contextual metadata such as title, platform, and URL.
- Timestamp sharing can be disabled, and sensitive terms can be replaced before sending.
- If enabled, summary history is stored locally in the browser and limited to the latest 30 items.
- The current settings export copies the full settings JSON and may include API keys. Export only in trusted environments, and remove secrets before sharing.
- To read captions across different video sites, the current extension declares broad site access permissions. Install and use it only from trusted sources.

For private, confidential, copyrighted, or regulated content, review your own requirements before sending transcripts to any third-party AI service.

### Support Boundaries

The extension can only read captions or text that the browser can access. Automatic extraction may fail when:

- Captions are burned into the video image or rendered only on canvas.
- Caption APIs require complex signatures, DRM, device attestation, or non-browser authorization.
- Your current account cannot access the captions or transcript.
- A platform changes its page structure or caption API.
- The video has no captions and no visible transcript text.

When caption loading fails, try another caption track, open the platform transcript panel, refresh the page, or use manual paste mode.

### Repository Layout

```text
manifest.json          # Chromium Manifest V3 configuration
src/background.js      # Caption fetching, AI API calls, chunking, and history storage
src/content.js         # Floating panel, platform detection, caption extraction, manual paste UI
options/options.html   # Options page
options/options.css
options/options.js
popup/popup.html       # Browser toolbar popup
popup/popup.css
popup/popup.js
icons/                 # Extension icon assets
tests/fixtures/        # Local test page and caption fixtures
tests/smoke-extension.mjs
```

### Development Notes

No build step is required. Load the repository directly as an unpacked extension. After editing source files, reload the extension from the browser extension management page and refresh the target video page to verify behavior.
