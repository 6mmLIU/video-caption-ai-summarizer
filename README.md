# Video Caption AI Summarizer

一个个人使用的 Chromium 浏览器扩展，用自己的 AI API 总结视频网站字幕。它模仿了 “AI Summary for YouTube” 的页面面板体验，但把支持范围扩展到了 YouTube、Bilibili、通用 HTML5 视频轨道，以及无法自动读取时的手动粘贴字幕模式。

## 功能

- YouTube：读取播放器里的 `captionTracks` 并抓取字幕。
- Bilibili：读取页面中的 `bvid/cid`，请求 B 站字幕接口。
- 通用视频站：读取 `<video><track>` 字幕、VTT/SRT 字幕，以及页面可见的 transcript/caption 文本。
- 兜底模式：任何网站都可以把字幕或转写文本粘贴到面板里总结。
- 自定义 API：支持 OpenAI 兼容接口、DeepSeek、ChatGPT、Claude、Gemini、Ollama、本地或代理服务。
- 自定义模型：模型名完全手填，不锁死在内置列表里。
- 长字幕分段：长视频会先分段提炼，再合并成最终总结。
- 自定义 Prompt：支持 `{{title}}`、`{{platform}}`、`{{url}}`、`{{language}}`、`{{transcript}}`、`{{outputTemplate}}`。
- 隐私控制：可关闭时间戳发送、设置敏感词替换、选择是否保存历史。
- 配置导入导出：方便在多台浏览器间迁移。

## 安装

1. 打开 Chrome 或 Edge。
2. 进入 `chrome://extensions` 或 `edge://extensions`。
3. 打开“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择本项目目录：`/Users/liu/Documents/New project 3`。

安装后，打开扩展设置页，先配置一个 API Key 和模型名。

## API 配置示例

### DeepSeek

- 服务商类型：`OpenAI 兼容接口`
- 接口地址：`https://api.deepseek.com/v1/chat/completions`
- 模型名称：`deepseek-chat`

### OpenAI / ChatGPT

- 服务商类型：`OpenAI 兼容接口`
- 接口地址：`https://api.openai.com/v1/chat/completions`
- 模型名称：填写你账号可用的模型

### Claude

- 服务商类型：`Anthropic Claude`
- 接口地址：`https://api.anthropic.com/v1/messages`
- 模型名称：填写你账号可用的 Claude 模型

### Ollama 本地模型

- 服务商类型：`Ollama / 本地 OpenAI 兼容`
- 接口地址：`http://localhost:11434/v1/chat/completions`
- API Key：可留空
- 模型名称：填写本地模型名

## 使用

1. 打开一个有字幕的视频页面。
2. 页面右侧会出现 `Video Caption AI` 浮动面板。
3. 选择字幕轨道。
4. 点击 `Ask AI to Summarize`。
5. 如果平台没有暴露字幕轨道，展开“手动粘贴字幕”，把字幕文本贴进去再总结。

也可以点击浏览器工具栏里的扩展图标，快速打开设置、折叠面板或请求总结。

## 本地测试

项目内置了一个 HTML5 字幕测试页：

```bash
python3 -m http.server 61733 --bind 127.0.0.1 --directory tests/fixtures
```

然后用支持加载未打包扩展的 Chromium/Chrome for Testing 打开：

```bash
open -na "/Users/liu/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app" --args \
  --user-data-dir="/tmp/vcs-demo-profile" \
  --disable-extensions-except="/Users/liu/Documents/New project 3" \
  --load-extension="/Users/liu/Documents/New project 3" \
  "http://127.0.0.1:61733/video-page.html"
```

自动化 smoke test：

```bash
node tests/smoke-extension.mjs
```

该脚本会真实启动 Chrome for Testing、加载扩展、识别测试字幕轨道，并输出截图到 `output/playwright/`。

## 支持边界

“支持主流视频网站”在浏览器扩展里不能等同于“破解所有平台字幕”。插件只能读取页面或平台接口已经暴露给浏览器的字幕数据：

- YouTube 和 Bilibili 走专门适配器。
- Vimeo、TED、课程网站、自建视频网站等，优先走 HTML5 `<track>` 和 VTT/SRT。
- 爱奇艺、腾讯视频、优酷等平台如果把字幕绘制在 canvas、视频流内嵌，或接口需要额外签名，扩展无法稳定自动读取。此时使用手动粘贴模式。
- 需要登录后才能看到的字幕，通常要求当前浏览器已经登录该平台。

## 我加入的高级想法

- 多模型配置档：不是只填一个 API Key，而是能保存多个供应商配置，随时切换。
- OpenAI 兼容优先：DeepSeek、OpenRouter、Groq、SiliconFlow、Ollama 等都可以复用同一种调用逻辑。
- 长视频 Map-Reduce：先按字幕分段提炼，再合并，避免超出上下文窗口。
- 个人隐私开关：发送前替换敏感词，可选择不发送时间戳、不开启历史。
- Prompt 变量化：把标题、平台、链接、字幕、输出语言都做成模板变量。
- 平台适配器架构：后续要支持新网站，只需要新增一个字幕提取适配器。
- 手动字幕兜底：自动提取失败时仍然可用，不会被某个平台卡死。

## 文件结构

```text
manifest.json
src/background.js      # 跨域抓字幕、调用模型、长字幕分段
src/content.js         # 视频页浮动面板、平台字幕提取
options/options.html   # 设置页
options/options.css
options/options.js
popup/popup.html       # 工具栏弹窗
popup/popup.css
popup/popup.js
```

## 安全说明

API Key 存储在 `chrome.storage.local`，适合个人本机使用。它不是专门的密钥保险库，不建议把这个扩展作为多人分发版本直接发布。如果要公开发布，建议改成自己的后端代理，并在后端保存和调用 API Key。
