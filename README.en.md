<p align="center">
  <img src="icons/ai-mark.png" alt="Video Caption AI Summarizer" width="128">
</p>

<h1 align="center">Video Caption AI Summarizer</h1>

<p align="center">
  Turn video captions into structured AI summaries with your own API.
</p>

<p align="center">
  <a href="README.md">简体中文</a>
  ·
  <strong>English</strong>
</p>

<p align="center">
  <img alt="Chromium Extension" src="https://img.shields.io/badge/Chromium-Extension-4285F4?style=flat-square">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Manifest-V3-34A853?style=flat-square">
  <img alt="Bring Your Own API" src="https://img.shields.io/badge/API-Bring%20Your%20Own-111827?style=flat-square">
  <img alt="Local First Settings" src="https://img.shields.io/badge/Settings-Local%20First-7C3AED?style=flat-square">
</p>

<p align="center">
  <strong>🎬 Watch less mechanically. Understand more deliberately.</strong><br>
  <strong>🧠 Turn video captions into notes, summaries, and searchable knowledge.</strong>
</p>

---

## Positioning

**Video Caption AI Summarizer** is a Chromium extension for people who learn, research, and work from long-form video. It reads captions, visible transcripts, or manually pasted transcript text, then sends that content to your configured AI API to produce a structured summary.

The goal is not to repeat captions line by line. It helps convert long videos into reusable knowledge.

- 🎯 Decide quickly whether a video deserves full attention
- 🧩 Extract core ideas from courses, interviews, product demos, and talks
- 📝 Turn captions into Markdown summaries, study notes, or research cards
- 🔁 Summarize long transcripts in chunks before merging the final result
- 🔐 Use your own API key and model configuration instead of being locked to one provider

## Highlights

| Feature | Description |
| --- | --- |
| 🎞️ Multi-source caption reading | Supports YouTube, Bilibili, generic HTML5 caption tracks, VTT/SRT files, and visible transcript / caption text. |
| 🧷 Manual paste fallback | Paste captions or transcript text into the floating panel when a site does not expose readable captions. |
| 🧠 Bring your own AI service | Supports OpenAI-compatible APIs, Claude, Gemini, Ollama, local models, and proxy services. |
| 🧰 Multiple API profiles | Save and switch between different providers, endpoints, API keys, and model names. |
| 📌 Provider presets | Includes templates for DeepSeek, OpenAI / ChatGPT, Claude, Gemini, Kimi, Qwen, Zhipu GLM, Xiaomi MiMo, and Ollama. |
| ✍️ Custom prompts | Customize the prompt and output template to control structure, tone, language, and detail level. |
| 📚 Long transcript chunking | Long videos are summarized in chunks, then merged into a final result. |
| 🛡️ Privacy controls | Toggle timestamp sharing, redact sensitive terms, and choose whether to keep the latest 30 summaries locally. |
| 🌓 Appearance settings | Supports auto, light, and dark themes, plus automatic panel display settings. |

## Who It Is For

- Learners who watch YouTube, Bilibili, course platforms, interviews, and technical talks
- Creators, researchers, and product managers who need to review video material quickly
- Developers and AI tool users who prefer summarizing with their own model service
- Teams that convert long videos into structured notes, meeting records, or knowledge-base material

## Installation

1. Download or clone this repository.
2. Open Chrome, Edge, or another Chromium-based browser.
3. Go to `chrome://extensions` or `edge://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select this project directory.

After installation, open the extension options page and configure your API service, model name, and preferred summary language before using it on video pages.

## API Setup

The options page lets you create, delete, and switch between API profiles.

| Type | Use Case |
| --- | --- |
| OpenAI-compatible APIs | DeepSeek, OpenAI / ChatGPT, Kimi, Qwen, Zhipu GLM, Xiaomi MiMo, and other services compatible with `/v1/chat/completions`. |
| Anthropic Claude | Claude Messages API. |
| Google Gemini | Gemini API. If no endpoint is entered, the extension generates the Gemini request URL from the model name. |
| Ollama / local OpenAI-compatible services | Defaults to `http://localhost:11434/v1/chat/completions`, suitable for local models or LAN-hosted compatible APIs. |

Required values typically include endpoint, API key, model name, temperature, and maximum output tokens. Provider behavior varies, so confirm model names, quota limits, context windows, and safety policies in the provider console.

## How to Use

1. Open a page with a video, captions, or transcript text.
2. If the page matches the extension's detection logic, the `Video Caption AI` floating panel appears automatically.
3. If the panel does not appear, click the browser toolbar icon and try toggling the panel or summarizing the current video.
4. Select a caption track and review the transcript preview.
5. If no captions are detected, open the manual transcript section and paste your captions or transcript text.
6. Start summarization and wait for the configured AI API to respond.
7. Copy the transcript or generated summary when needed.

When a platform provides a built-in transcript panel, open it first, then refresh the page or re-detect captions.

## Prompt Variables

Custom prompts and output templates support these variables:

| Variable | Meaning |
| --- | --- |
| `{{title}}` | Video title |
| `{{platform}}` | Video platform |
| `{{url}}` | Current page URL |
| `{{language}}` | Preferred output language |
| `{{transcript}}` | Transcript body |
| `{{outputTemplate}}` | Output structure template |

## Privacy and Data Handling

The extension sends the selected transcript to your configured AI service to generate a summary. Use a provider or self-hosted service you trust.

- API keys are stored in local browser extension storage.
- Summary requests may include transcript text plus contextual metadata such as title, platform, and URL.
- Timestamp sharing can be disabled, and sensitive terms can be replaced before sending.
- If enabled, summary history is stored locally in the browser and limited to the latest 30 items.
- The current settings export copies the full settings JSON and may include API keys. Export only in trusted environments, and remove secrets before sharing.
- To read captions across different video sites, the current extension declares broad site access permissions. Install and use it only from trusted sources.

For private, confidential, copyrighted, or regulated content, review your own requirements before sending transcripts to any third-party AI service.

## Support Boundaries

The extension can only read captions or text that the browser can access. Automatic extraction may fail when:

- Captions are burned into the video image or rendered only on canvas.
- Caption APIs require complex signatures, DRM, device attestation, or non-browser authorization.
- Your current account cannot access the captions or transcript.
- A platform changes its page structure or caption API.
- The video has no captions and no visible transcript text.

When caption loading fails, try another caption track, open the platform transcript panel, refresh the page, or use manual paste mode.

## Repository Layout

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

## Development Notes

No build step is required. Load the repository directly as an unpacked extension. After editing source files, reload the extension from the browser extension management page and refresh the target video page to verify behavior.
