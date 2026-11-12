# 使用本地 Ollama 视觉服务

在 **设置 → 视觉工具** 中选择 **OpenAI Chat Completions**，API 地址填写 `http://127.0.0.1:11434/v1`，模型填写本机已安装的视觉模型的准确名称。在高级设置中将凭据名称设为 `OLLAMA_LOCAL_KEY`，API 密钥值填写 `ollama`，然后保存并应用。插件要求凭据非空；本地 Ollama 会忽略这个占位值，详见其 [OpenAI 兼容性文档](https://docs.ollama.com/api/openai-compatibility)。

测试视觉模型，然后离开并重新进入设置页，确认配置已保存。内置服务返回 HTTP 429 时，可按 Retry-After 等待，或在此选择自己的端点。

如需通过 Profile patch 配置，请覆盖已有 bundle 行，不要重复插入插件：

```yaml
- id: vision-toolkit
  config:
    provider:
      protocol: openai
      baseUrl: http://127.0.0.1:11434/v1
      model: YOUR_INSTALLED_VISION_MODEL
      credential: OLLAMA_LOCAL_KEY
```

将 `YOUR_INSTALLED_VISION_MODEL` 替换为已安装的模型名称。`credential` 是引用名称，不是密钥值。在 DSH 0.2.2-rc.1 上，将 `OLLAMA_LOCAL_KEY=ollama` 保存到 `$DSH_HOME/.env`（通常是 `~/.dsh/.env`），或在设置中保存该引用。宿主托管的凭据存储优先于环境文件；自定义端点不要复用 `ANIONEX_FREE_VISION`。修改 patch 后重启 Profile，并创建新会话。Desktop 请使用其自身的 Profile／设置入口。

Desktop 设置保存时报“The request must originate from this DSH Web application”的问题已在插件 0.1.50 中修复。[Python 运行时配置](python-runtime.zh.md) 与模型端点相互独立。
