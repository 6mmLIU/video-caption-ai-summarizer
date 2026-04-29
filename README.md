# Video Caption AI Summarizer

一个 Chromium 浏览器扩展，用 AI 总结视频网站字幕。支持 DeepSeek、OpenAI 兼容服务、Claude、Gemini、Kimi、通义千问、智谱 GLM、Ollama 和自定义服务地址。

## 功能

- YouTube：读取播放器里的字幕轨道并抓取字幕。
- Bilibili：读取视频信息并请求可用字幕。
- 通用视频站：点击扩展图标后，可读取 HTML5 字幕、VTT/SRT 字幕和页面可见转写文稿。
- 多模型配置：可以保存多个服务配置，随时切换。
- 长字幕分段：长视频会先分段提炼，再合并成最终总结。
- 自定义 Prompt：支持 `{{title}}`、`{{platform}}`、`{{url}}`、`{{language}}`、`{{transcript}}`、`{{outputTemplate}}`。
- 隐私控制：可关闭时间戳发送、设置敏感词替换、选择是否保存历史；默认不保存总结历史。
- 配置导入导出：导出的配置不会包含 API Key 或访问口令。

## 安装

1. 打开 Chrome 或 Edge。
2. 进入 `chrome://extensions` 或 `edge://extensions`。
3. 打开“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择本项目目录。

安装后，打开扩展设置页，选择摘要服务，填写服务地址、API Key 和模型名称。

## API Key

API Key 会保存在当前浏览器中，只在请求对应摘要服务时使用。导出配置时会自动移除 API Key 和访问口令。

如果使用专用服务地址，可以只填写服务地址和可选访问口令；模型名称可留空，由服务端决定。

## 使用

1. 打开一个有字幕的视频页面。
2. YouTube、Bilibili、Vimeo、TED 页面会自动出现 `Video Caption AI` 面板。
3. 其他视频页可点击浏览器工具栏里的扩展图标，让扩展临时注入当前页。
4. 选择字幕轨道。
5. 点击 `解析字幕`。
6. 如果平台没有暴露字幕轨道，先打开页面自带的转写文稿，再刷新面板读取。

## 支持边界

扩展只能读取页面或平台接口已经暴露给浏览器的字幕数据：

- YouTube 和 Bilibili 走专门适配器。
- Vimeo、TED、课程网站、自建视频网站等，优先走 HTML5 `<track>` 和 VTT/SRT。
- 爱奇艺、腾讯视频、优酷等平台如果把字幕绘制在 canvas、视频流内嵌，或接口需要额外签名，扩展无法稳定自动读取。
- 需要登录后才能看到的字幕，通常要求当前浏览器已经登录该平台。

## 文件结构

```text
manifest.json
src/background.js      # 跨域抓字幕、调用摘要服务、长字幕分段
src/content.js         # 视频页浮动面板、平台字幕提取
options/options.html   # 设置页
options/options.css
options/options.js
popup/popup.html       # 工具栏弹窗
popup/popup.css
popup/popup.js
```
