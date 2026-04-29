<p align="center">
  <img src="icons/ai-mark.png" alt="Video Caption AI Summarizer" width="128">
</p>

<h1 align="center">Video Caption AI Summarizer</h1>

<p align="center">
  用你自己的 AI API，把长视频字幕整理成清晰、可复用的结构化摘要。
</p>

<p align="center">
  <strong>简体中文</strong>
  ·
  <a href="README.en.md">English</a>
</p>

<p align="center">
  <img alt="Chromium Extension" src="https://img.shields.io/badge/Chromium-Extension-4285F4?style=flat-square">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Manifest-V3-34A853?style=flat-square">
  <img alt="Bring Your Own API" src="https://img.shields.io/badge/API-Bring%20Your%20Own-111827?style=flat-square">
  <img alt="Local First Settings" src="https://img.shields.io/badge/Settings-Local%20First-7C3AED?style=flat-square">
</p>

<p align="center">
  <strong>🎬 少一点重复观看，多一点高质量理解。</strong><br>
  <strong>🧠 把视频字幕变成笔记、摘要和可检索的知识材料。</strong>
</p>

---

## 产品定位

**Video Caption AI Summarizer** 是一款面向高频视频学习者、内容研究者和 AI 工具用户的 Chromium 浏览器扩展。它可以读取视频页面中已经暴露给浏览器的字幕、转写文本，或者用户手动粘贴的字幕内容，并调用你配置的 AI API 生成结构化摘要。

它的目标不是简单“复述字幕”，而是帮助你把长视频变成更容易复盘、检索和二次使用的知识材料。

- 🎯 快速判断视频是否值得完整观看
- 🧩 从课程、访谈、发布会和讲座中提取核心信息
- 📝 将字幕整理为 Markdown 摘要、学习笔记或研究卡片
- 🔁 对超长视频进行分段提炼，再合并为完整结论
- 🔐 使用自己的 API Key 和模型配置，避免被单一服务绑定

## 亮点能力

| 能力 | 说明 |
| --- | --- |
| 🎞️ 多平台字幕读取 | 支持 YouTube、Bilibili、通用 HTML5 视频字幕轨道、VTT/SRT 字幕，以及页面可见 transcript / caption 文本。 |
| 🧷 手动粘贴兜底 | 平台不开放字幕接口时，可以直接把字幕或转写文本粘贴到浮动面板中总结。 |
| 🧠 自选 AI 服务 | 支持 OpenAI 兼容接口、Claude、Gemini、Ollama、本地模型和代理服务。 |
| 🧰 多 API 配置 | 可以保存多个 API 配置，在不同服务、模型和端点之间切换。 |
| 📌 服务预设 | 内置 DeepSeek、OpenAI / ChatGPT、Claude、Gemini、Kimi、通义千问、智谱 GLM、小米 MiMo、Ollama 等常用模板。 |
| ✍️ 自定义 Prompt | 支持自定义总结 Prompt 和输出模板，可控制摘要结构、语气、语言和细节密度。 |
| 📚 长字幕分段 | 长视频会先按设定字符数分段提炼，再合并成最终摘要。 |
| 🛡️ 隐私控制 | 可关闭时间戳发送、配置敏感词替换，并选择是否保存最近 30 条本地摘要历史。 |
| 🌓 视觉设置 | 支持自动、浅色、深色主题，并可控制视频页是否自动显示浮动面板。 |

## 适合谁使用

- 经常观看 YouTube、Bilibili、课程平台、访谈和技术分享的学习者
- 需要快速整理视频素材的内容创作者、研究人员和产品经理
- 想用自己的模型服务总结字幕的开发者和 AI 工具用户
- 需要把长视频转成结构化笔记、会议纪要或知识库素材的团队成员

## 安装方式

1. 下载或克隆本仓库到本地。
2. 打开 Chrome、Edge 或其他 Chromium 浏览器。
3. 进入 `chrome://extensions` 或 `edge://extensions`。
4. 打开右上角的“开发者模式”。
5. 点击“加载已解压的扩展程序”。
6. 选择本项目目录。

安装完成后，建议先打开扩展设置页，配置 API 服务、模型名称和摘要输出语言，再进入视频页面使用。

## API 配置

在设置页的“API 模型”区域，可以新增、删除和切换配置。

| 类型 | 适用场景 |
| --- | --- |
| OpenAI 兼容接口 | DeepSeek、OpenAI / ChatGPT、Kimi、通义千问、智谱 GLM、小米 MiMo，以及其他兼容 `/v1/chat/completions` 的服务。 |
| Anthropic Claude | 使用 Claude Messages API 的场景。 |
| Google Gemini | 使用 Gemini API；未填写接口地址时，扩展会根据模型名称生成 Gemini 请求地址。 |
| Ollama / 本地 OpenAI 兼容服务 | 默认使用 `http://localhost:11434/v1/chat/completions`，适合本地模型或局域网内兼容服务。 |

通常需要填写接口地址、API Key、模型名称、Temperature 和最大输出 Token。不同服务商对模型名称、额度、上下文长度和安全策略的要求不同，请以对应服务商控制台为准。

## 使用流程

1. 打开一个包含视频、字幕或转写内容的页面。
2. 如果页面符合自动识别条件，扩展会显示 `Video Caption AI` 浮动面板。
3. 如果面板没有自动显示，可点击浏览器工具栏中的扩展图标，尝试切换面板或解析当前视频。
4. 在面板中选择字幕轨道，并查看字幕预览。
5. 如果没有读取到字幕，可以展开“手动粘贴字幕”，粘贴字幕或转写文本。
6. 点击解析按钮，等待 AI API 返回摘要。
7. 根据需要复制字幕或摘要内容。

如果平台自带 transcript / 转写文稿入口，建议先在网页中展开该内容，再刷新页面或重新检测字幕。

## Prompt 变量

自定义 Prompt 与输出模板支持以下变量：

| 变量 | 含义 |
| --- | --- |
| `{{title}}` | 视频标题 |
| `{{platform}}` | 视频平台 |
| `{{url}}` | 当前页面链接 |
| `{{language}}` | 期望输出语言 |
| `{{transcript}}` | 字幕正文 |
| `{{outputTemplate}}` | 输出结构模板 |

## 隐私与数据说明

本扩展会把用户选择的字幕文本发送到已配置的 AI 服务，以便生成摘要。使用前请确认你信任对应的 API 服务商或自建服务。

- API Key 保存在当前浏览器的扩展本地存储中。
- 摘要请求会包含字幕文本，以及标题、平台、链接等用于生成摘要的上下文信息。
- 可以关闭时间戳发送，也可以配置敏感词，在发送前自动替换。
- 摘要历史启用后会保存在本机浏览器存储中，最多保留最近 30 条。
- 当前配置导出会复制完整配置 JSON，可能包含 API Key。请只在可信环境中导出，并在分享前手动移除密钥。
- 为了兼容不同视频网站的字幕读取方式，当前扩展声明了较宽的站点访问权限。请仅从可信来源安装和使用本扩展。

如果视频内容涉及隐私、商业机密、受版权保护材料或合规要求，请在发送给第三方 AI 服务前谨慎评估。

## 支持边界

扩展只能读取浏览器能够访问到的字幕或文本。以下情况可能无法稳定自动处理：

- 字幕被烧录在视频画面中，或只绘制在 canvas 上。
- 字幕接口需要复杂签名、DRM、设备校验或非浏览器可访问的授权。
- 当前账号没有权限查看字幕或转写文稿。
- 平台更新页面结构或字幕接口，导致读取逻辑暂时失效。
- 视频本身没有字幕，也没有页面可见的转写文本。

遇到读取失败时，可以尝试切换字幕轨、展开平台自带转写文稿、刷新页面，或使用手动粘贴模式。

## 项目结构

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

## 开发说明

本项目不需要构建步骤，可以直接作为“已解压的扩展程序”加载。修改源码后，在浏览器扩展管理页点击重新加载，再刷新目标视频页面即可验证。
