# Safe Page Translator

全新仓库用于开发一个面向 Chromium 浏览器的安全网页翻译扩展。我们已经清理了旧文件，并准备了一个符合 Manifest V3 规范的扩展骨架，方便继续迭代功能。

## 当前结构

```
extension/
├── manifest.json         # 扩展配置（Manifest V3）
├── popup.html/.js/.css   # 弹窗 UI 与交互逻辑
├── options.html/.js/.css # 设置页，用于配置翻译接口
└── scripts/
    ├── background.js     # Service Worker，负责上下文菜单与翻译请求转发
    └── content-script.js # 内容脚本，提供页面内划词翻译气泡
```

## 主要特性

- **可配置的翻译服务**：在设置页填写任意 HTTPS 端点、HTTP 方法以及 API Key（只保存在本地同步存储）。
- **LLM 友好的 Prompt 模板**：使用 Mustache 风格占位符自定义提示词内容，例如 `{{text}}`、`{{sourceLanguage}}` 等。
- **可定制请求体与请求头**：通过 JSON 模板生成 LLM 或传统翻译接口所需的消息格式，支持自定义 Authorization、模型等字段。
- **响应路径解析**：设置点号语法路径（如 `choices.0.message.content`）即可从复杂的 LLM 返回值中提取最终译文。
- **划词翻译与弹窗操作**：支持上下文菜单触发翻译气泡，也能在弹窗中手动输入文本进行翻译。

## 下一步建议

- 选择或自建一个翻译 API，并在 `options` 页面里配置端点、Prompt 模板和响应路径。
- 如果需要额外的上下文或后处理，可在 `background.js` 的 `handleTranslationRequest` 中扩展逻辑。
- 根据需求扩展 UI，例如历史记录、本地缓存或多语言选择。

## 开发与调试

1. 在浏览器中打开 `chrome://extensions`。
2. 打开右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本仓库下的 `extension` 目录。
4. 修改代码后，可以在扩展管理页中点击“更新”快速刷新。

欢迎继续提出需求，我们可以在此基础上迭代实现所需功能。
