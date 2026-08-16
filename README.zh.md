![DSH Vision Toolkit——面向纯文本 DeepSeek Harness Agent 的原生视觉工程能力](assets/hero.png)

# DSH Vision Toolkit

[![由 dshfind 推荐](https://img.shields.io/badge/%E7%94%B1%20dshfind-%E6%8E%A8%E8%8D%90-FFD700?style=flat-square)](https://dshfind.com/zh/plugins/Anionex/dsh-vision-toolkit)
[![dshfind 评分：94——最高分插件](https://img.shields.io/badge/dshfind%20%E8%AF%84%E5%88%86-94%20%7C%20%E6%9C%80%E9%AB%98%E5%88%86%E6%8F%92%E4%BB%B6-5B4CF0?style=flat-square)](https://dshfind.com/zh/plugins/Anionex/dsh-vision-toolkit)
[![X (Twitter)](https://img.shields.io/badge/-@anion__ex-000000?style=flat-square&logo=x&logoColor=white)](https://x.com/anion_ex)
[![Release v0.1.9](https://img.shields.io/badge/release-v0.1.9-5B4CF0?style=flat-square)](https://github.com/Anionex/dsh-vision-toolkit/releases/tag/v0.1.9)
[![Verified: 230 tests](https://img.shields.io/badge/verified-230%20tests-2EA44F?style=flat-square)](tests)
[![License: MIT](https://img.shields.io/badge/license-MIT-0B7285?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%5E22.19%20%7C%20%3E%3D24-339933?style=flat-square&logo=nodedotjs&logoColor=white)](package.json)
[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white)](runtime/requirements.lock)
[![DSH profiles](https://img.shields.io/badge/DSH-Web%20%2B%20Headless-5B4CF0?style=flat-square)](cordis.patch.yml)

**安装：** `dsh plugin --profile web add @anionex/dsh-vision-toolkit`

**DSH Vision Toolkit 将 [`agent-vision-toolkit`](https://github.com/Anionex/agent-vision-toolkit) 作为原生 Profile Bundle 带入 DeepSeek Harness。**

让纯文本 DSH Agent 真正看见，并知道当前任务应该看哪里：通过带意图的图片问答、OCR、原图像素定位、UI 还原、像素验证、托管产物和 Web Settings 完成视觉闭环。10 个独立工具以结构化 schema 和 Agent 级渐进暴露取代 Shell 拼接。

**上游工具箱：** [Anionex/agent-vision-toolkit](https://github.com/Anionex/agent-vision-toolkit) · **项目网站：** [agent-vision.anionex.me](https://agent-vision.anionex.me)

[English](README.md) | 中文

## 为什么需要它

`agent-vision-toolkit` 把视觉视为 Agent 可调用的能力，而不是基础模型自带的天赋。它会把“为什么要看这张图”带入视觉请求，从全局逐步收敛到目标区域，并用专用工具验证坐标、颜色、轮廓和差异，不把泛化描述直接当成证据。

DSH Vision Toolkit 保留这套方法，并用原生 schema、DSH Credentials、受生命周期管理的运行时准备、可从 Session 日志重建的结构化结果、可预览产物、专用 Web 卡片和 Settings 取代 CLI 安装与 Bash 参数拼接。Agent 加载一个带版本的 Skill，只有当前任务需要视觉时才会获得 10 个工具 schema。

本包完整交付已承诺的 P0 与 P1 产品范围。P2 的稳定 `ctx.visionToolkit` 服务会等到独立插件成为真实消费方后再发布；内部运行时不会把未经验证的生态接口伪装为稳定契约。

## agent-vision-toolkit 已验证的真实用例

前两张图是本 Bundle 所打包 `agent-vision-toolkit` 固定版本同一代码线上的官方实跑结果；图片问答与截图辅助排障这一张则是在 DeepSeek Harness Web 中实际运行的会话，展示 DSH 中的同一套工作流。上游图片来源见[素材溯源记录](assets/upstream/README.md)。

### 信息图还原：从截图到可编辑 HTML/CSS

<p align="center">
  <img src="assets/upstream/infographic-reference.webp" width="49%" alt="上游用于还原的三阶段模型训练信息图原始截图。" />
  <img src="assets/upstream/infographic-result.webp" width="49%" alt="上游使用 HTML 和 CSS 还原出的可编辑模型训练信息图。" />
</p>

*左：原始截图；右：上游[信息图还原示例](https://github.com/Anionex/agent-vision-toolkit/blob/c27d1a300962b553c0884993c575cd3e819465ce/examples/infographic-restoration/how-is-the-model-trained.html)生成的可编辑 HTML/CSS 结果。*

### UI 还原：从手绘稿到可用界面

<p align="center">
  <img src="assets/upstream/ui-sketch.webp" width="49%" alt="上游用于 UI 还原的手绘 JupyterLab 工作区参考图。" />
  <img src="assets/upstream/ui-result.webp" width="49%" alt="上游依据手绘参考图还原出的 JupyterLab 风格可用界面。" />
</p>

*左：手绘输入；右：上游还原出的界面，完整方法见 [UI 还原 playbook](https://github.com/Anionex/agent-vision-toolkit/blob/c27d1a300962b553c0884993c575cd3e819465ce/skills/vision-tools/references/restore-ui.md)。*

### 图片问答与截图辅助排障

<p align="center">
  <img src="assets/dsh-conversation-image-qa.png" width="49%" alt="DSH Web 会话中，纯文本 Agent 针对 UI 参考图回答聚焦问题。" />
  <img src="assets/dsh-conversation-screenshot-debugging.png" width="49%" alt="DSH Web 会话中，Agent 根据截图对比定位 UI 字段差异并建议继续运行 vision_pixel_diff。" />
</p>

*左：DSH Web 中带意图的图片问答；右：DSH Web 中通过截图对比定位 UI 字段差异，并继续向 `vision_pixel_diff` 推进。上游工作流来源仍为 [`agent-vision-toolkit` 官方实跑](https://github.com/Anionex/agent-vision-toolkit/blob/c27d1a300962b553c0884993c575cd3e819465ce/README.md#real-world-effects)。*

DSH Vision Toolkit 在这些上游能力之外增加原生工具 schema、版本化生命周期、Credentials、结构化 Session 结果、产物、Web 展示、Settings 和渐进暴露。下一节展示由本 DSH 仓库实际执行并提交的可复现实证。

## DSH 原生实证：从参考图到像素级一致

仓库中的 UI 还原流程会渲染一个故意不准确的 HTML 实现，测得 `6.04%` 像素差异和 6 个非零差异区域；经过迭代后，在 `1200 × 720` 下达到相对参考图精确 `0%` 的差异。

<p>
  <img src="examples/ui-restoration/assets/initial.png" width="49%" alt="Vision Toolkit 迭代前的 UI 还原候选，与参考图仍有可测量的布局和样式差异。" />
  <img src="examples/ui-restoration/assets/implementation.png" width="49%" alt="仓库内可复现流程生成的最终 UI 还原结果，与参考图达到零像素差异。" />
</p>

| 已验证范围 | 证据 |
|---|---|
| 产品范围 | 10 个独立视觉工具、匹配的 `vision-tools` Skill、产物、专用 Web 卡片和实时 Settings |
| 自动化覆盖 | 17 个 Vitest 文件 / 136 项通过测试，以及不依赖 DSH 开发树的可移植包检查 |
| 真实 Profile | 干净临时 Web 与 Headless 安装、激活、禁用、重新启用和卸载 |
| 视觉验收 | 可复现的 HTML 截图 → 像素对比示例，最终差异为 `0%` |

## 亮点

- **看图但不让每轮提示词膨胀：** 初始只暴露 `vision_toolkit_activate`；加载 `vision-tools` 后，10 个独立 schema 才挂到当前 Agent，版本和健康管理始终不进入模型上下文。
- **直接使用坐标，而不是解析自然语言：** 定位和元素盘点返回原图像素框，所有模型可见结果保持为结构化文字或 JSON。
- **交付正式文件，而不是临时输出：** 裁剪、SVG 恢复、OCR、像素对比、前景提取和 HTML 渲染会生成带描述的产物，Web 客户端可预览、下载或在本地打开。
- **受控管理运行时与凭据：** API Key 由 DSH Credentials 保管；managed 模式准备精确隔离的 Python 环境；失败的 Settings 候选不会替换当前服务 generation。
- **闭合视觉验证循环：** 本地 HTML 渲染和像素差异排序支持参考图 → 实现 → 截图 → 度量迭代，不依赖模型原生图片通道。
- **同一 Bundle 同时服务 Web 与 Headless：** Web 增加卡片、预览、Settings 和健康操作；Headless 保持相同工具语义和完整结构化结果。

## 快速开始

前置条件：DeepSeek Harness `0.1.0-rc.6` 或兼容的后续 `0.1.x` 版本、Python 3.11+，并确保 `dsh plugin` 可以使用 `pnpm`。从 npm 安装已发布的 Bundle，将其加入所需 Profile，并确认 Bundle 行已经挂载：

```sh
dsh plugin --profile web add @anionex/dsh-vision-toolkit
dsh plugin --profile headless add @anionex/dsh-vision-toolkit
dsh --profile web --dump-config | grep vision-toolkit
dsh --profile headless --dump-config | grep vision-toolkit
```

旧 Profile 的 `pnpm-workspace.yaml` 必须使用 `nodeLinker: hoisted` 和 `autoInstallPeers: false`。更新后的 DSH launcher 会在 `dsh plugin` 运行前修复这两个自有设置；使用旧 launcher 时，应在安装前手动设置，避免 pnpm 在 Profile 内组装第二套 Harness 依赖图。

安装后重启正在运行的 Web Profile，打开 **设置 → 视觉工具**，为远程工具选择 DSH Credential，先执行**测试 API 连接**，再执行**测试视觉模型**以验证一次真实图片请求。在会话中把图片放进工作区路径，调用 `/vision-tools`，再让 Agent 使用明确的 `vision_*` 工具。本地裁剪、SVG、像素、颜色、前景和 HTML 操作不需要视觉 API Credential。

## 加入交流群

欢迎加入 `agent-vision-toolkit` 项目交流群，交流使用经验、反馈问题并提出建议。

<p align="center">
  <img src="assets/community-group-qr.png" alt="agent-vision-toolkit 项目交流群二维码" width="260">
</p>

## 工作原理

```mermaid
flowchart LR
    User["Workspace image or local HTML"] --> Skill["vision-tools Skill"]
    Skill --> Activate["Agent-scoped activation"]
    Activate --> Tools["10 independent vision_* tools"]
    Tools --> Runtime["Shared VisionToolkitRuntime"]
    Credentials["DSH Credentials"] --> Runtime
    Settings["Web Settings and health"] --> Runtime
    Runtime --> Upstream["Pinned agent-vision-toolkit"]
    Runtime --> Remote["Configured vision API"]
    Upstream --> Result["Text, coordinates, JSON"]
    Remote --> Result
    Runtime --> Artifacts["Workspace Artifacts"]
    Result --> Session["Reconstructable Session log"]
    Artifacts --> Web["Preview, download, or open file"]
```

所有工具定义都调用同一个 Runtime；Runtime 在分发到固定上游快照或已配置的视觉提供方端点前，统一验证路径、限制、Credential、取消和超时。Web 展示读取相同的结构化结果与产物描述，因此不会改变 Headless 语义。健康、连接测试和版本检查只留在 Settings，不进入模型工具 schema。

## 工具

| 工具 | 执行方式 | 结构化结果 | 产物交付 |
|---|---|---|---|
| `vision_glance` | 远程视觉 API | 描述、针对性回答、OCR 或多图比较 | 无 |
| `vision_ground` | 远程视觉 API；可选本地预览 | 目标、原图尺寸和像素框 | 可选标注 PNG |
| `vision_detect` | 远程视觉 API；可选本地预览 | 带编号的元素清单和原图像素框 | 可选编号 PNG |
| `vision_trace` | 本地固定 vtracer 流水线 | SVG 几何状态、路径数、缩放和大小 | SVG |
| `vision_crop` | 本地 Pillow 流水线 | 实际像素框、尺寸、格式和裁剪边界状态 | PNG 或 JPEG |
| `vision_pixel_diff` | 本地 NumPy/Pillow 流水线 | 差异比例和排序后的网格区域 | PNG 热力图和 JSON 报告 |
| `vision_long_screenshot_ocr` | 本地切分/审计；除 `splitOnly=true` 外执行远程 OCR | 分块边界、复用状态、完成状态和运行目录 | Markdown、manifest、边界审计、分块 PNG 和 OCR 伴随文件 |
| `vision_extract_foreground` | 本地固定提取流水线 | 选区、连通分量数、前景覆盖率和尺寸 | 透明 PNG |
| `vision_dominant_colors` | 本地固定颜色分析 | 提取的调色板或有像素证据的候选色排序 | 无 |
| `vision_html_screenshot` | 本地 Chrome/Chromium/Edge 适配器 | 已授权源文件信息、视口和渲染尺寸 | PNG |

插件不重新实现视觉算法。DSH 侧只负责验证路径与限制、解析 Credential、用 argv 向量调用固定上游脚本、解析精确输出契约、分类失败、描述文件，并把结果投影给模型和 Web 客户端。

## 渐进式模型暴露

运行时就绪状态属于整个 Profile，但 10 个视觉执行工具的 schema 属于具体 Agent。Agent 加载 `vision-tools` 前，插件只贡献很小的 `vision_toolkit_activate` 引导工具；该 Agent 的请求 schema 中没有视觉执行工具。标准 `skill` 工具以 `name="vision-tools"` 成功加载后，会为下一模型步骤自动挂载全部 10 个工具并隐藏引导工具。直接调用 `/vision-tools` 会注入 skill 指令；如果此时视觉工具仍不可见，这些指令要求调用一次 `vision_toolkit_activate`。激活只影响当前 Agent；Session 中存在与打包 skill 版本匹配的持久证据时可以恢复，并持续到 Agent 或插件被释放。

健康检查、连接测试以及插件/上游版本检查属于 Web Settings 管理操作。`vision_toolkit_health` 和 `vision_toolkit_version` 不是模型工具，即使视觉执行工具已经激活，也永远不会进入 Agent schema。

## 纯文本模型的图片输入变体

纯文本模型路由会获得同名的兄弟模型条目：`<模型名> (Vision Toolkit)`，挂在对应的提供方分组下。变体声明支持图片输入，因此粘贴的图片走原生附件流程——输入框缩略图、会话持久化图片与历史渲染全部保留——插件只在发往模型的请求链路上把每个图片块改写成 Vision Toolkit 描述文本，再转交上游路由。视觉提示会携带最新的用户或助手意图，并与 `agent-vision-toolkit` 对齐角色提示、描述要求、图片文字策略以及 `[vision model description]` 等通道标记；模型获得的是与当前任务相关的证据，而不是宽泛的通用描述。会话日志不被改动；回放与 UI 看到的始终是真实图片。

插件会自动为宿主明确声明为纯文本的每个模型注册变体（例如 DeepSeek 对话家族）。粘贴处理是全自动的：当当前模型被确认为纯文本、且它的变体已注册时，浏览器端集成会自动把会话切换到变体（会有一条简短提示说明新模型名），随后粘贴走原生流程，无需手动切换模型。宿主依据浏览器从实时模型目录读到的精确模型路由来裁决，模型选择器标签作为兜底；无法确认或支持图片的路由一律保持原生流程，而"纯文本但没有变体"的模型（例如变体被关闭时）继续走"粘贴转路径"：图片被复制进会话工作区，输入框里插入的是它的路径文本。

描述转换需要已配置的视觉提供方及其 Credential；当运行时未就绪或读取失败时，请求链路上的图片块降级为与上游兼容的 `[vision unavailable: ...]` 提示，而不是让整轮失败。桥接不会把注入的上下文文件当作当前用户意图；如果图片来自工具调用，则使用最新的助手段落作为关注提示。用 `imageInputVariants.enabled: false` 关闭变体，用 `imageInputVariants.providers` 限制被包装的路由，或用 `imageInputVariants.autoSwitch: false` 让纯文本模型继续走"粘贴转路径"。

## 运行要求

- 启用 Web 或 Headless Profile 的 DeepSeek Harness，并确保 `dsh plugin` 可以使用 `pnpm`。
- Python 3.11 或更高版本。Managed 模式会创建隔离环境，用户无需手工安装上游 CLI（命令行界面）或 Python 包。
- 首次启用 managed 运行时需要联网；如果配置的软件包缓存已有 `runtime/requirements.lock` 中的精确版本，则无需联网。
- `vision_glance`、`vision_ground`、`vision_detect` 和非仅切分长截图 OCR 需要 OpenAI 兼容或 Anthropic 视觉端点及 DSH Credential。本地工具无需该 Credential 也可使用。
- 只有 `vision_html_screenshot` 需要 Chrome、Chromium 或 Edge；未安装受支持浏览器时，其他工具保持可用。
- 输入必须是会话工作区或显式 `allowedDirs` 根目录内的 PNG、JPEG、GIF 或 WebP。

## 安装与生命周期

### 安装

将 Bundle 安装到需要暴露能力的每个 Profile：

```sh
dsh plugin --profile web add @anionex/dsh-vision-toolkit
dsh plugin --profile headless add @anionex/dsh-vision-toolkit
dsh --profile web --dump-config | grep vision-toolkit
dsh --profile headless --dump-config | grep vision-toolkit
```

安装后需要重启长期运行的 Web Profile。宿主在进程启动时通过 `package.json` 的 `dsh.client` 声明发现已构建的浏览器 Bundle；旧的顶层 `dshClient` 字段不会被扫描。

首次 managed 启动会验证打包的上游 manifest（元数据清单），并在 `DSH_HOME/cache/dsh-vision-toolkit` 下原子准备隔离环境。插件只在准备成功后发布同版本的 `vision-tools` skill 与激活引导工具；每个 Agent 只有在加载该 skill 后才获得执行工具。初次准备失败时，Web Settings 修复入口仍然可用，但插件不会暴露任何模型能力或误导模型的 skill。

### 禁用与重新启用

在 Profile patch 或 overlay 中把 Bundle 行设为 `disabled: true`：

```yaml
- id: vision-toolkit
  disabled: true
```

删除该字段或设为 `false` 即可重新启用。资源释放会先取消插件拥有的视觉操作，再移除全部 Agent 级工具、引导工具和 skill；重新启用时，配置的运行时准备完成后才会暴露任何模型能力。用户配置和已完成的产物会保留。

### 升级

**从已停用的 `@dsh-external/dsh-vision-toolkit` 迁移：** npm 包现在位于 `@anionex` 作用域。如果你安装的是已停用的旧包，**不要**对它执行 `update`——该账号无法发布本版本。请迁移到新包名并重启 Web Profile：

```sh
dsh plugin --profile web remove @dsh-external/dsh-vision-toolkit
dsh plugin --profile web add @anionex/dsh-vision-toolkit
```

重启后，Settings → 视觉工具 应显示插件版本 **0.1.9**。

通过注册表安装时，使用 Profile 的包管理命令更新依赖：

```sh
dsh plugin --profile web update @anionex/dsh-vision-toolkit
dsh plugin --profile headless update @anionex/dsh-vision-toolkit
```

通过本地路径安装时，对替换后的 checkout 或 tarball 再次执行 `add`。Settings 保存在 Profile 的 Settings 提供方中。候选运行时完成验证和准备后才会持久化并启用；失败候选或已经陈旧的并发候选无法替换当前服务 generation。

### 卸载

```sh
dsh plugin --profile web remove @anionex/dsh-vision-toolkit
dsh plugin --profile headless remove @anionex/dsh-vision-toolkit
```

`dsh plugin remove` 会同时移除依赖及其 Bundle 层。Profile 随即不再暴露激活引导工具、Agent 级 Vision Toolkit 工具或 skill 条目。没有 Profile 使用本包时可以另行删除 managed 缓存；缓存不是活动配置，无法自行注册任何能力。

## 配置

Bundle 默认使用 managed 运行时。Profile patch 可以覆盖提供方与限制：

```yaml
- id: vision-toolkit
  config:
    provider:
      baseUrl: https://api.inferera.com/v1
      credential: VISION_API_KEY
      model: gemini-3.6-flash
      protocol: openai
      anthropicThinking: omit
      userAgent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36
    language: zh
    timeoutMs: 60000
    maxImageBytes: 10485760
    maxImagePixels: 40000000
    concurrency: 4
    runtime:
      mode: managed
    allowedDirs: []
    imageInputVariants:
      enabled: true
      providers: []
      autoSwitch: true
```

### 配置字段

| 字段 | 默认值 | 契约 |
|---|---|---|
| `provider.baseUrl` | `https://api.inferera.com/v1` | 提供方 API 基础 URL；去除结尾斜杠后使用。Anthropic 应填写以 `/v1` 结尾的基础 URL，不要填写完整 `/messages` URL |
| `provider.credential` | `VISION_API_KEY` | DSH Credential 引用，不是密钥值 |
| `provider.model` | `gemini-3.6-flash` | 远程工具使用的多模态模型名 |
| `provider.protocol` | `openai` | `openai` 发送 Chat Completions 请求；`anthropic` 发送原生 Messages 请求 |
| `provider.anthropicThinking` | `omit` | Anthropic thinking 字段。`omit` 不发送 thinking 字段，兼容性最好；仅当所选模型明确支持时使用 `disabled` 或 `adaptive`，提供方返回 HTTP 400 时应先恢复 `omit`。 |
| `provider.userAgent` | 浏览器兼容默认值 | 视觉请求和显式连接测试发送的 User-Agent；可为提供方或代理兼容性覆盖 |
| `language` | `zh` | 视觉输出语言：`zh` 或 `en` |
| `timeoutMs` | `60000` | 完整操作截止时间，1000-600000 毫秒；每个工具可请求更窄的覆盖值 |
| `maxImageBytes` | `10485760` | 每张输入图片的编码字节上限 |
| `maxImagePixels` | `40000000` | 每张输入图片的解码像素上限 |
| `concurrency` | `4` | 每个会话内的并发操作数，1-16 |
| `runtime.mode` | `managed` | `managed` 使用打包快照；`external` 只接受精确固定版本 |
| `runtime.agentVisionToolkitPath` | 未设置 | `external` 模式必填；必须是精确导出快照或固定 commit 的干净 Git checkout |
| `runtime.python` | 未设置 | 可选的 Python 3.11+ 引导程序/解释器覆盖值 |
| `allowedDirs` | `[]` | 额外的 realpath 解析输入根目录；会话工作区始终允许 |
| `imageInputVariants.enabled` | `true` | 为纯文本模型路由在模型选择器中注册图片输入变体条目 |
| `imageInputVariants.providers` | `[]` | 按提供方 id 限制被包装的上游路由；为空时包装所有符合条件的路由 |
| `imageInputVariants.autoSwitch` | `true` | 粘贴时自动把纯文本会话切换到其图片输入变体，让图片保持原生流程；`false` 时纯文本模型继续走"粘贴转路径" |

### Credential

Web 设置页的只写 **API 密钥** 输入框直接接收真实密钥。留空表示保留现有密钥；填写后保存，会把密钥写入高级设置中的 **凭据名称**，默认名称是 `VISION_API_KEY`。Headless 部署可以在 `$DSH_HOME/.credentials.yaml` 中预置同名引用。

Settings 只保存引用，不保存值。浏览器不会读取已保存的密钥，保存成功后输入框也会立即清空而不是回显。每次远程操作都会重新解析引用，并只把值注入对应子进程环境。插件排除用户 `.env`、checkout `.env`、`PYTHONPATH`、`PYTHONHOME`、`VIRTUAL_ENV` 和用户 site-packages，避免环境中的 Python 或上游配置覆盖选定的 DSH 提供方。日志、错误、工具结果、产物元数据和 Settings 响应都不包含密钥。

### Managed 与 external 运行时

Managed 模式会验证 `vendor/agent-vision-toolkit/UPSTREAM_MANIFEST.json`，优先使用 `uv`，回退到 `venv` 加 pip，按 `runtime/requirements.lock` 安装精确版本，通过 heartbeat 锁协调并发准备，并只在全部探针通过后发布 staging 环境。

External 模式用于开发或受控部署：

```yaml
- id: vision-toolkit
  config:
    runtime:
      mode: external
      agentVisionToolkitPath: /opt/agent-vision-toolkit
      python: python3.12
```

该路径必须是与打包 manifest 一致的导出副本，或 commit `bc9803d7d6300c864d17460ecbb33540b26638e0` 的干净 Git checkout 根目录。插件拒绝已修改的 tracked 文件和 untracked 文件，因为它们可能改变或遮蔽固定 Python 行为。

## Web Settings

Web Profile 会注册 Vision Toolkit Settings 分区，可配置提供方 URL、Credential 引用、模型、OpenAI/Anthropic 协议、Anthropic thinking 模式、User-Agent、语言、超时、字节/像素限制、并发数、运行时模式、Python 覆盖值、external 源码路径和允许目录。该页面还会显示插件/上游版本、当前运行时 generation、不含密钥的 Credential configured/source/writable 状态、运行时路径、健康检查结果和产物路由可用性。

“保存并应用”会验证完整配置，准备候选 Python/上游运行时，提交 Settings revision，最后才原子切换 generation。候选被拒绝时，之前的 generation 继续服务，页面也会把这种状态与运行时确实不可用区分开来。“重新加载”始终恢复后端已保存的权威值，即使 revision 没有变化也会丢弃被拒绝的浏览器草稿。初始启动无法准备运行时时，Settings 路由仍可用于提交有效配置并激活首个 generation。陈旧浏览器 revision 不会覆盖较新的保存结果，而是返回冲突；刷新后再重试。只读 Settings 提供方允许查看和健康检查，但禁用保存。

“运行健康检查”只执行本地检查。“测试 API 连接”是显式操作，会把已配置 Credential 发送到 `GET /models`；OpenAI 使用 Bearer 认证，Anthropic 使用 `x-api-key` 与 `anthropic-version`。这个轻量测试不会上传图片，也不会创建 completion。“测试视觉模型”会另行把插件自带的 `assets/vision-model-test.png` 通过与 `vision_glance` 相同的多模态运行路径发送出去；它会创建一次真实 completion，并用于权威确认所选端点、Credential、模型、协议和上游账户确实能够处理图片。视觉模型检查卡会单独显示“已实测”“未测试”或“测试失败”Tag，避免把 `/models` 返回 HTTP 200 误认为图片调用成功。插件加载和普通 Settings 读取不会发送这两类请求。

健康检查、连接测试以及插件/上游版本检查属于 Web Settings 管理能力，而不是模型工具，因此其 schema 永远不会占用 agent 请求上下文。

## 产物与展示

会生成产物的工具只能写入 `<workspace>/.dsh-vision-toolkit/artifacts`，写入形式为单个已验证文件或原子提交的运行目录。每个模型可见产物描述都包含路径、文件名、MIME 类型、种类、说明、来源工具、预览意图和字节数，因此 Headless agent 无需浏览器支持，也能在后续调用中复用该路径。提交 trace SVG 前，运行时会把它作为 XML 解析：允许标准声明与注释，但拒绝 doctype、格式错误或多根文档、非 SVG namespace，以及上游报告与实际路径数/字节数不一致的结果。

存在 Web HTTP 宿主时，仅供展示的元数据会加入带签名的预览和下载能力 URL，而不改变规范工具结果。每次读取都会重新验证签名、managed 根目录围栏、路径组件、普通文件状态、大小、可用时的 device/inode 身份、扩展名和 MIME。SVG 响应使用禁止外部资源的 sandbox CSP，客户端通过 sandbox iframe 渲染。没有 HTTP 宿主时，同一张卡片保留 `openFile` 提供的“打开文件”能力，并显示产物描述，不会伪造无法访问的 URL。

## 使用方式

### 基础调用

```text
vision_glance images=["screenshot.png"] query="What error is shown?"
vision_ground image="screenshot.png" target="the send button" preview=true
vision_detect image="screenshot.png" category="buttons" preview=true
vision_crop image="screenshot.png" region="1067,841,1108,881"
vision_trace image="icon.png" color=true output="icon.svg"
vision_pixel_diff original="reference.png" rebuilt="actual.png" runName="comparison"
vision_long_screenshot_ocr image="page.png" mode="general" jobs=2
vision_extract_foreground image="logo.png" mode="color"
vision_dominant_colors image="screen.png" region="0,0,600,300" top=8
vision_html_screenshot source="implementation.html" width=1200 height=720
```

常见工作流包括 `vision_ground` → `vision_crop` → `vision_glance`、`vision_ground` → `vision_crop` → `vision_trace`，以及参考图 → `vision_html_screenshot` → `vision_pixel_diff`。Grounding 和 detection 坐标始终使用原图像素（`x1/y1/x2/y2`）。

### UI 还原示例

已提交的 [UI 还原示例](examples/ui-restoration/README.md) 通过 `vision_html_screenshot` 渲染参考页面、故意不准确的初版实现和最终实现，再通过 `vision_pixel_diff` 比较两个候选结果：

```sh
npm run example:ui-restoration
npm run example:ui-restoration:write
```

已提交证据记录初版差异为 `6.04%`，有 6 个非零最差区域；最终差异为 `0%`，没有非零最差区域。Check 模式会复现工具调用路径并验证已提交资源；write 模式会有意刷新证据。

## 安全与执行模型

- 输入相对会话工作区和配置的 `allowedDirs` 解析；realpath containment 阻止路径穿越和符号链接逃逸。
- 每张图片都会在远程请求前由 Pillow 解码，并校验字节、像素、尺寸以及扩展名与内容是否一致。不支持或过大的图片会在上传前失败。
- 输出使用真实 managed 目标目录中的随机 staging 文件或目录，拒绝符号链接，并只在格式与契约验证通过后提交。
- 远程视觉提示词明确将图片中的文字和指令归类为不可信内容。原生工具描述与打包 skill 同样要求文本 agent 只把衍生描述、标签和 OCR 当作视觉证据，而不是可执行指令。
- 所有上游进程都通过 `ctx.subprocess` 使用 argv 向量，继承调用方取消信号，共享一个完整操作硬截止时间，并随操作终止，不会继续在后台运行。插件释放会在注销对应工具前中止活动调用。
- 一个活动会话只保留最近一次成功的 `vision_glance` 结果。只有图片内容、问题/OCR 模式、区域、端点、模型、语言和 Credential 都未改变时，紧接着的重复调用才会复用该结果；失败调用和其他会话绝不共享此条目。
- 模型可见数据仅包含文本、数字、坐标、结构化 JSON 和文件描述。工具调用/结果可以从会话日志重建；浏览器预览只属于展示元数据。
- 指标包含工具名、总耗时/上游耗时、有界图片数量/字节/像素、缓存命中、模型和错误类别；不包含 base64、鉴权头、密钥或无界上游输出。

`vision_html_screenshot` 只接受已授权的本地 `.html` 或 `.htm` 文件，在固定适配器中禁用网络，并使用 `--headless=new`、`--use-mock-keychain`、`--incognito` 和系统临时目录内的唯一 `--user-data-dir` 启动 Chrome 系浏览器。每次调用后都会删除该 profile，因此无头渲染不会接触用户日常 Chrome Profile 或 macOS 登录钥匙串。

## 故障排查

| 症状 | 解决方法 |
|---|---|
| `Model "..." does not support image input. (attachment-error)` | 图片走了 DSH 的模型原生附件通道，纯文本模型会在 Skill 或 Vision Toolkit 运行前拒绝该轮。启用图片输入变体时这很少发生：粘贴会自动把会话切换到 `<模型名> (Vision Toolkit)` 变体。若变体被关闭或自动切换被禁用，请使用 DSH Paste Input 的附件按钮、粘贴或拖放流程，让文件先复制到会话工作区并以路径形式进入消息，再调用 `/vision-tools`。安装或升级任一浏览器插件后，需要重启 Web Profile 并刷新页面。 |
| Credential 显示缺失 | 在 Web 设置页的 **API 密钥** 中粘贴密钥，确认高级设置中的 **凭据名称** 与 `provider.credential` 一致，保存后重新运行健康检查。Headless 部署可以在 `$DSH_HOME/.credentials.yaml` 中预置同名引用。本地工具不需要它。 |
| 运行时准备失败 | 查看 Settings 中的运行时错误，检查 Python 3.11+、软件包缓存/网络、磁盘权限和精确 external 固定版本。修正候选后再保存；当前 generation 不受影响。 |
| 找不到 Chrome | 安装 Chrome、Chromium 或 Edge，或让其中一个可被运行环境发现。只有 `vision_html_screenshot` 不可用。 |
| macOS 弹出钥匙串对话框 | 确认安装的是当前构建产物，且没有遗留的外部 `html_shot`/headless Chrome 进程。当前启动使用 mock keychain 和一次性 profile；取消对话框，不要重置登录钥匙串。 |
| 输入或输出路径被拒绝 | 把文件移入会话工作区，或有意将真实目录加入 `allowedDirs`；移除会逃逸的符号链接。输出参数只接受文件名，不接受绝对路径或嵌套路径。 |
| 视觉服务返回 401/403 | 替换 Credential 值，或选择正确的引用和端点。错误内容保持脱敏。 |
| 视觉服务返回 429 | 等待提供方限流窗口结束后重试，或降低 `concurrency`。插件不会静默切换提供方。 |
| 操作超时或被取消 | 在 1000-600000 毫秒范围内提高 `timeoutMs`、减少图片/分块工作量，或在取消后重新执行。子进程/请求会随操作停止。 |
| Settings 保存冲突 | 重新加载分区以取得当前 revision，重新应用目标修改，再次保存。 |
| Settings 只读 | 更换活动 Settings 提供方，或编辑其拥有的 Profile 配置；插件不能绕过提供方可写性。 |
| 无法预览产物 | 使用“打开文件”或模型可见路径。只有 Web HTTP 路由已挂载时才存在预览/下载 URL。 |

## 开发与验证

```sh
pnpm install --frozen-lockfile --trust-lockfile
pnpm run verify:portable
pnpm run build
pnpm test
pnpm run example:ui-restoration
pnpm pack --dry-run
```

`pnpm run verify:portable` 是不依赖外部开发包的可移植验证门禁：验证上游快照、package 元数据与 exports、已提交 JavaScript 语法、README 链接和图片、必需的开源门面文件、social preview 尺寸以及 dry-run tarball。完整 TypeScript 构建和测试会在这个独立 checkout 中直接使用 lockfile 锁定的 DSH `0.1.0-rc.6` registry 包；客户端构建还通过独立 compiler face 验证这些包的公开 exports，不使用内部路径 alias。PATH 中存在兼容的 `dsh` 与 `pnpm` 时会执行真实 Profile 验收，CI 会强制要求该路径，而不会静默跳过。

`pnpm run build` 会先验证 vendored manifest，再生成 JavaScript、声明文件和 loader 兼容 Web 客户端。本包提交 `lib/`，因此从 checkout 安装时不要求消费方构建。无真实 Key 的真实 Profile 测试会安装到干净 `DSH_HOME`、启动 Headless、通过真实工具调用执行全部五个 P0 工具和具有代表性的 P1 本地/远程工具、验证禁用与重新启用行为，并卸载 Bundle。每项 P0/P1 需求对应的实现与验证位置见[需求追踪参考](docs/requirements-traceability/README.md)。

更新上游快照时只能执行 `pnpm run upstream:sync -- <checkout>`，检查源码和许可证，重新生成 manifest，并在同一变更中更新适配器兼容性测试和已提交 `lib/`。运行时绝不拉取上游 `main`。

## 项目状态与范围

版本 `0.1.9` 是当前公开 npm 发布。P0 和 P1 是本包的产品承诺。P2 是设计门槛：至少一个独立插件消费内部能力形态前，不发布稳定 `ctx.visionToolkit` 服务、能力发现 API 或提供方生态。Web 上传、拖拽、摄像头/视频/音频/文档输入、交互式标注框编辑、GUI 自动点击、远程服务集群、模型路由、模型投票和跨会话视觉缓存不属于当前产品范围。

## 社区与关于

- 提交代码、协议或上游快照变更前，请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 可复现缺陷、范围明确的功能建议和使用问题请提交到 [GitHub Issues](https://github.com/Anionex/dsh-vision-toolkit/issues)；如何选择渠道见 [SUPPORT.md](SUPPORT.md)。
- 安全漏洞必须按 [SECURITY.md](SECURITY.md) 私下报告，不要创建公开 Issue。
- 版本与兼容性变化记录在 [CHANGELOG.md](CHANGELOG.md)。
- 可选赞助方式与用途见 [FUNDING.md](FUNDING.md)；赞助不购买路线图优先级或私有支持。
- 通用工具箱、跨 Harness 接入、视觉任务 playbook 和官方实跑案例请访问上游[项目网站](https://agent-vision.anionex.me)与[代码仓库](https://github.com/Anionex/agent-vision-toolkit)。
- 如果 `agent-vision-toolkit` 的算法或方法节省了时间，欢迎为上游 star、分享、贡献或赞助；DSH 专属缺陷和集成需求请提交到本仓库。

[`agent-vision-toolkit`](https://github.com/Anionex/agent-vision-toolkit) 由 [Anionex](https://anionex.me/) 创建。本仓库维护它面向 DeepSeek Harness 的原生集成：DSH 侧负责生命周期、安全、结构化 schema、Credentials、产物和 Web 展示；视觉算法与可复用 playbook 继续由上游项目维护。

如果你想了解我后续的更多工作，欢迎在 [X](https://x.com/anion_ex) 或 [GitHub](https://github.com/Anionex) 关注我。

## 许可证

插件采用 MIT 许可。打包的 `agent-vision-toolkit` 快照在 `vendor/agent-vision-toolkit/LICENSE` 保留上游 MIT 许可证，并继续作为视觉算法的唯一实现。
