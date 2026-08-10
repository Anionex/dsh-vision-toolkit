# DSH Vision Toolkit

[English](README.md) | 中文

DSH Vision Toolkit（`@dsh-external/dsh-vision-toolkit`）为纯文本 DeepSeek Harness Agent 提供结构化视觉工程能力。一次 Profile Bundle 安装即可获得原生工具、DSH Credentials 接入、可复现 Python 运行时和匹配的 `vision-tools` Skill，无需拼接 Shell 命令，也不修改 DSH Core。

当前 P0 包含五个能力工具和一个只读版本探针，并提供结构化输入/结果、覆盖完整操作的取消与硬超时、解码后图片限制、会话级有界并发、路径围栏、稳定错误，以及原子一致的工具/Skill 生命周期。

## 工具

| 工具 | 用途 |
|---|---|
| `vision_glance` | 在一次调用中描述、问答、OCR 或比较图片 |
| `vision_ground` | 定位一个命名目标并返回原图像素框 |
| `vision_detect` | 盘点某类元素并返回带编号的像素框 |
| `vision_trace` | 使用上游 vtracer 将平面位图恢复为可编辑 SVG 路径 |
| `vision_crop` | 将像素框裁剪为独立 PNG/JPEG 文件 |
| `vision_toolkit_version` | 无视觉 API 调用地报告插件、上游快照、Python 和依赖版本 |

插件不重写视觉算法。它把结构化请求转换为对固定 `agent-vision-toolkit` 脚本的 argv 直调，验证上游输出契约，并向模型返回 JSON。Grounding 坐标始终是原图像素框（`x1/y1/x2/y2`），可直接交给 `vision_crop`。

## 运行要求

- 启用 Web 或 Headless Profile 的 DeepSeek Harness。
- Python 3.11 或更高版本。默认 managed 模式会创建隔离环境，用户无需手工安装上游 CLI 或 Python 包。
- 首次启用 managed 运行时需要联网安装 `runtime/requirements.lock` 中的精确版本；后续启动复用已完成的缓存运行时。
- `vision_glance`、`vision_ground` 和 `vision_detect` 需要 OpenAI 兼容视觉服务及 DSH Credential；本地 `vision_crop`、`vision_trace` 和版本检查不解析凭据。

## 安装

将 Bundle 安装到需要暴露工具的每个 Profile：

```sh
dsh plugin --profile web add /path/to/dsh-vision-toolkit
dsh plugin --profile headless add /path/to/dsh-vision-toolkit
```

用 `dsh --profile web --dump-config | grep vision-toolkit` 确认 patch 行，配置视觉服务 Credential，然后重启 Profile。首次 managed 启动会验证打包的上游 manifest，并在 `DSH_HOME/cache/dsh-vision-toolkit` 下原子准备隔离 Python 环境；升级中断不会破坏之前已完成的运行时。

插件只在运行时准备成功后注册工具，再挂载匹配的 `vision-tools` Skill。准备失败时二者都不会出现；禁用或销毁时二者一起注销。

## 配置

Bundle 默认使用 managed 运行时，因此大多数安装只需 patch 视觉服务：

```yaml
- id: vision-toolkit
  config:
    provider:
      baseUrl: https://api.inferera.com/v1
      credential: VISION_API_KEY
      model: gemini-3.6-flash
    language: zh
    timeoutMs: 60000
    maxImageBytes: 10485760
    maxImagePixels: 40000000
    concurrency: 4
    runtime:
      mode: managed
    allowedDirs: []
```

| 字段 | 默认值 | 说明 |
|---|---|---|
| `provider.baseUrl` | `https://api.inferera.com/v1` | OpenAI 兼容视觉服务地址 |
| `provider.credential` | `VISION_API_KEY` | 保存 API Key 的 DSH Credential 引用 |
| `provider.model` | `gemini-3.6-flash` | 多模态模型名 |
| `language` | `zh` | 视觉输出语言（`zh` / `en`） |
| `timeoutMs` | `60000` | 完整操作硬截止时间，1000–600000 毫秒 |
| `maxImageBytes` | `10485760` | 每张输入图片的最大编码字节数 |
| `maxImagePixels` | `40000000` | 每张输入图片的最大解码像素数 |
| `concurrency` | `4` | 每会话并发执行数，1–16 |
| `runtime.mode` | `managed` | `managed` 使用打包快照和隔离环境；`external` 只接受精确固定版本 |
| `runtime.agentVisionToolkitPath` | 未设置 | 仅 external 模式必填；必须是精确导出快照或固定 commit 的干净检出 |
| `runtime.python` | 未设置 | 可选的 Python 3.11+ 引导程序/解释器覆盖值 |
| `allowedDirs` | `[]` | 除会话工作区外允许读取图片的目录 |

### External 运行时模式

External 模式适合已提供精确受支持上游源码的开发或受控部署：

```yaml
- id: vision-toolkit
  config:
    runtime:
      mode: external
      agentVisionToolkitPath: /opt/agent-vision-toolkit
      python: python3.12
```

该路径必须是 `UPSTREAM_MANIFEST.json` 及完整文件集合与本包完全一致的导出副本，或 commit `c27d1a300962b553c0884993c575cd3e819465ce` 的干净 Git 检出根目录。插件拒绝已修改的 tracked 文件和 untracked 文件，避免它们改变或遮蔽固定 Python 行为。

### 凭据

API Key 从不进入普通插件配置、模型上下文、Artifact 元数据、日志或模型可见错误。`provider.credential` 只在远程工具调用时通过 `ctx.credentials` 解析，并仅注入对应子进程环境：

```sh
dsh credentials set VISION_API_KEY
```

上游命令使用隔离的 HOME 和工作目录，并显式指向不存在的 env 文件，因此用户级 `agent-vision-toolkit` env 文件和检出目录 `.env` 都无法覆盖 DSH provider 配置。环境中的 `PYTHONPATH`、`PYTHONHOME`、`VIRTUAL_ENV` 和用户 site-packages 也不会进入运行时。

## 使用示例

```text
vision_glance images=["screenshot.png"] query="What error is shown?"
vision_ground image="screenshot.png" target="the send button"
vision_detect image="screenshot.png" category="buttons"
vision_crop image="screenshot.png" region="1067,841,1108,881"
vision_trace image="icon.png" color=true output="icon.svg"
```

常见 GUI 流程是 `vision_ground` → `vision_crop` → `vision_glance` 或 `vision_trace`。一次 `vision_glance` 请求中的相同真实图片路径只会发送一次。

## 路径与安全模型

- 输入相对会话工作区解析，realpath 后必须仍位于工作区或配置的 `allowedDirs` 根目录内；只有真实目标仍在围栏内的符号链接才被接受。
- 每张图片在远程请求前都由 Pillow 解码，并校验编码字节数、解码像素数、尺寸以及文件名扩展与实际格式是否一致。
- 输出写入 `<workspace>/.dsh-vision-toolkit/artifacts`。用户可以指定一个文件名，但绝对路径、嵌套路径、路径穿越和不支持的扩展名都会被拒绝。
- 上游只写入真实输出目录内的随机 staging 路径；插件验证 staging 普通文件后再提交，因此预先存在的目标符号链接无法重定向上游写入。
- Ground/Detect 只接受完全符合固定坐标语法的非空输出行，并验证每个框都位于原图范围内。
- 图片 base64 不进入模型上下文、Session 日志或插件日志。日志只记录有界指标；stderr 和错误会对已解析凭据脱敏。

## 上游版本策略

本包包含 [agent-vision-toolkit](https://github.com/Anionex/agent-vision-toolkit) 的 MIT 许可源码快照 `v0.1.0+snapshot.c27d1a3`（`c27d1a300962b553c0884993c575cd3e819465ce`）。`vendor/agent-vision-toolkit/UPSTREAM_MANIFEST.json` 记录每个源码文件及 SHA-256；构建、运行时准备和 external 模式验证都会在固定版本意外变化时失败。插件运行时绝不拉取上游 `main`。

升级快照时只能执行 `npm run upstream:sync -- <checkout>`，检查生成源码和许可证，重新生成 manifest，并在同一提交中更新固定版本、兼容性测试和生成的 `lib/`。

## 开发

```sh
pnpm run build
pnpm test
pnpm pack --dry-run
```

`pnpm run build` 会先验证 vendored manifest，再生成 JavaScript 和声明文件。仓库提交 `lib/`，因此从 Git checkout 安装时不要求消费者构建。

## P0 范围与 P1 路线

P0 交付标准 Bundle、managed/external 固定运行时、六个原生工具、DSH Credentials、取消/超时/错误分类、字节与像素限制、路径围栏、原子输出 staging、会话级并发、与生命周期绑定的 Skill、测试、双语文档和干净 `DSH_HOME` Profile 验证。P1 增加 Artifact descriptor 与交付路由、扩展工具（`pixel_diff`、长截图 OCR、前景提取、主色分析、HTML 截图）、专用 Web 展示、健康检查、Settings 和 UI 还原端到端示例。

## License

插件采用 MIT 许可。打包的 `agent-vision-toolkit` 快照在 `vendor/agent-vision-toolkit/LICENSE` 保留上游 MIT 许可，并继续作为其视觉算法的唯一实现。
