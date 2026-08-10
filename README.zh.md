# DSH Vision Toolkit

[English](README.md) | 中文

DSH Vision Toolkit（`@dsh-external/dsh-vision-toolkit`）为纯文本 DeepSeek Harness agent（智能体）提供原生视觉工程工作台。一次 out-of-tree Profile Bundle 安装即可获得结构化工具、匹配的 `vision-tools` skill（技能）、可复现 Python 运行时、DSH Credentials 接入、托管产物、专用 Web 展示和实时 Settings，无需修改 DSH Core，也无需让模型拼接 Shell 命令。

本包完整交付 P0 和 P1 产品范围。P2 的稳定 `ctx.visionToolkit` 服务会等到独立插件成为真实消费方后再发布；工具和内部运行时不会把未经验证的生态接口伪装为稳定契约。

![Vision Toolkit Settings](docs/assets/vision-settings.png)

## 交付内容

- 面向 Web 和 Headless Profile 的可移植 Bundle patch、已提交的 `lib/` 产物、可复现构建输入，以及原子一致的工具/skill 启用流程。
- 固定的 MIT 许可 `agent-vision-toolkit` 快照、managed 与精确 external 运行时模式，以及只读版本探针。
- 12 个原生工具，覆盖远程图片理解、原图像素定位、本地几何与像素分析、长截图 OCR、HTML 渲染、健康检查和版本身份。
- 稳定的模型可见 JSON 和会话工作区内的正式文件描述；图片字节和仅供浏览器使用的访问 URL 不进入模型上下文。
- 每个工具的专用 Web 卡片、带签名的图片/SVG 预览与下载，以及没有 HTTP 宿主时的 `openFile` 降级路径。
- 实时 Vision Toolkit Settings：候选运行时准备成功后才持久化并启用，失败时保留当前服务 generation，且永不返回 Credential 值。

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
| `vision_toolkit_health` | 本地检查；可选显式 `GET /models` | 运行时、依赖、浏览器、Credential、存储和服务状态 | 无 |
| `vision_toolkit_version` | 本地 | 插件、上游快照、Python 和依赖版本 | 无 |

插件不重新实现视觉算法。DSH 侧只负责验证路径与限制、解析 Credential、用 argv 向量调用固定上游脚本、解析精确输出契约、分类失败、描述文件，并把结果投影给模型和 Web 客户端。

## 运行要求

- 启用 Web 或 Headless Profile 的 DeepSeek Harness，并确保 `dsh plugin` 可以使用 `pnpm`。
- Python 3.11 或更高版本。Managed 模式会创建隔离环境，用户无需手工安装上游 CLI（命令行界面）或 Python 包。
- 首次启用 managed 运行时需要联网；如果配置的软件包缓存已有 `runtime/requirements.lock` 中的精确版本，则无需联网。
- `vision_glance`、`vision_ground`、`vision_detect` 和非仅切分长截图 OCR 需要 OpenAI 兼容视觉端点及 DSH Credential。本地工具无需该 Credential 也可使用。
- 只有 `vision_html_screenshot` 需要 Chrome、Chromium 或 Edge；未安装受支持浏览器时，其他工具保持可用。
- 输入必须是会话工作区或显式 `allowedDirs` 根目录内的 PNG、JPEG、GIF 或 WebP。

## 安装与生命周期

### 安装

将 Bundle 安装到需要暴露能力的每个 Profile：

```sh
dsh plugin --profile web add /path/to/dsh-vision-toolkit
dsh plugin --profile headless add /path/to/dsh-vision-toolkit
dsh --profile web --dump-config | grep vision-toolkit
dsh --profile headless --dump-config | grep vision-toolkit
```

首次 managed 启动会验证打包的上游 manifest（元数据清单），并在 `DSH_HOME/cache/dsh-vision-toolkit` 下原子准备隔离环境。插件只在准备成功后注册全部工具，再挂载同版本的 `vision-tools` skill。初次准备失败时，Web Settings 修复入口仍然可用，但插件不会暴露工具或误导模型的 skill。

### 禁用与重新启用

在 Profile patch 或 overlay 中把 Bundle 行设为 `disabled: true`：

```yaml
- id: vision-toolkit
  disabled: true
```

删除该字段或设为 `false` 即可重新启用。资源释放会先取消插件拥有的视觉操作，再一起移除工具和 skill；重新启用时，配置的运行时准备完成后二者才会出现。用户配置和已完成的产物会保留。

### 升级

通过注册表安装时，使用 Profile 的包管理命令更新依赖：

```sh
dsh plugin --profile web update @dsh-external/dsh-vision-toolkit
dsh plugin --profile headless update @dsh-external/dsh-vision-toolkit
```

通过本地路径安装时，对替换后的 checkout 或 tarball 再次执行 `add`。Settings 保存在 Profile 的 Settings 提供方中。候选运行时完成验证和准备后才会持久化并启用；失败候选或已经陈旧的并发候选无法替换当前服务 generation。

### 卸载

```sh
dsh plugin --profile web remove @dsh-external/dsh-vision-toolkit
dsh plugin --profile headless remove @dsh-external/dsh-vision-toolkit
```

`dsh plugin remove` 会同时移除依赖及其 Bundle 层。Profile 随即不再暴露 Vision Toolkit 工具或 skill 条目。没有 Profile 使用本包时可以另行删除 managed 缓存；缓存不是活动配置，无法自行注册任何能力。

## 配置

Bundle 默认使用 managed 运行时。Profile patch 可以覆盖提供方与限制：

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

### 配置字段

| 字段 | 默认值 | 契约 |
|---|---|---|
| `provider.baseUrl` | `https://api.inferera.com/v1` | OpenAI 兼容基础 URL；去除结尾斜杠后使用 |
| `provider.credential` | `VISION_API_KEY` | DSH Credential 引用，不是密钥值 |
| `provider.model` | `gemini-3.6-flash` | 远程工具使用的多模态模型名 |
| `language` | `zh` | 视觉输出语言：`zh` 或 `en` |
| `timeoutMs` | `60000` | 完整操作截止时间，1000-600000 毫秒；每个工具可请求更窄的覆盖值 |
| `maxImageBytes` | `10485760` | 每张输入图片的编码字节上限 |
| `maxImagePixels` | `40000000` | 每张输入图片的解码像素上限 |
| `concurrency` | `4` | 每个会话内的并发操作数，1-16 |
| `runtime.mode` | `managed` | `managed` 使用打包快照；`external` 只接受精确固定版本 |
| `runtime.agentVisionToolkitPath` | 未设置 | `external` 模式必填；必须是精确导出快照或固定 commit 的干净 Git checkout |
| `runtime.python` | 未设置 | 可选的 Python 3.11+ 引导程序/解释器覆盖值 |
| `allowedDirs` | `[]` | 额外的 realpath 解析输入根目录；会话工作区始终允许 |

### Credential

通过 DSH Credentials 创建或替换引用指向的密钥：

```sh
dsh credentials set VISION_API_KEY
```

Settings 只保存引用，不保存值。每次远程操作都会重新解析引用，并只把值注入对应子进程环境。插件排除用户 `.env`、checkout `.env`、`PYTHONPATH`、`PYTHONHOME`、`VIRTUAL_ENV` 和用户 site-packages，避免环境中的 Python 或上游配置覆盖选定的 DSH 提供方。日志、错误、工具结果、产物元数据和 Settings 响应都不包含密钥。

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

该路径必须是与打包 manifest 一致的导出副本，或 commit `c27d1a300962b553c0884993c575cd3e819465ce` 的干净 Git checkout 根目录。插件拒绝已修改的 tracked 文件和 untracked 文件，因为它们可能改变或遮蔽固定 Python 行为。

## Web Settings

Web Profile 会注册 Vision Toolkit Settings 分区，可配置提供方 URL、Credential 引用、模型、语言、超时、字节/像素限制、并发数、运行时模式、Python 覆盖值、external 源码路径和允许目录。该页面还会显示插件/上游版本、当前运行时 generation、不含密钥的 Credential configured/source/writable 状态、运行时路径、健康检查结果和产物路由可用性。

“保存并应用”会验证完整配置，准备候选 Python/上游运行时，提交 Settings revision，最后才原子切换 generation。候选被拒绝时，之前的 generation 继续服务，页面也会把这种状态与运行时确实不可用区分开来。“重新加载”始终恢复后端已保存的权威值，即使 revision 没有变化也会丢弃被拒绝的浏览器草稿。初始启动无法准备运行时时，Settings 路由仍可用于提交有效配置并激活首个 generation。陈旧浏览器 revision 不会覆盖较新的保存结果，而是返回冲突；刷新后再重试。只读 Settings 提供方允许查看和健康检查，但禁用保存。

“运行健康检查”只执行本地检查。“测试连接”是显式操作，会把已配置 Credential 发送到 `GET /models`；它不会上传图片，也不会创建 completion。插件加载和普通 Settings 读取不会发送该请求。

## 产物与展示

会生成产物的工具只能写入 `<workspace>/.dsh-vision-toolkit/artifacts`，写入形式为单个已验证文件或原子提交的运行目录。每个模型可见产物描述都包含路径、文件名、MIME 类型、种类、说明、来源工具、预览意图和字节数，因此 Headless agent 无需浏览器支持，也能在后续调用中复用该路径。

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
vision_toolkit_health testConnection=false
vision_toolkit_version
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
| Credential 显示缺失 | 执行 `dsh credentials set <REF>`，确认 `provider.credential` 指向该引用，再重新运行健康检查。本地工具不需要它。 |
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
pnpm run build
pnpm test
pnpm run example:ui-restoration
pnpm pack --dry-run
```

`pnpm run build` 会先验证 vendored manifest，再生成 JavaScript、声明文件和 loader 兼容 Web 客户端。本包提交 `lib/`，因此从 checkout 安装时不要求消费方构建。无真实 Key 的真实 Profile 测试会安装到干净 `DSH_HOME`、启动 Headless、通过真实工具调用执行远程与本地工具、验证禁用行为并卸载 Bundle。每项 P0/P1 需求对应的实现与验证位置见[需求追踪参考](docs/requirements-traceability/README.md)。

更新上游快照时只能执行 `pnpm run upstream:sync -- <checkout>`，检查源码和许可证，重新生成 manifest，并在同一变更中更新适配器兼容性测试和已提交 `lib/`。运行时绝不拉取上游 `main`。

## 范围

P0 和 P1 是本包的产品承诺。P2 是设计门槛：至少一个独立插件消费内部能力形态前，不发布稳定 `ctx.visionToolkit` 服务、能力发现 API 或提供方生态。Web 上传、拖拽、摄像头/视频/音频/文档输入、交互式标注框编辑、GUI 自动点击、远程服务集群、模型路由、模型投票和跨会话视觉缓存不属于当前产品范围。

## 许可证

插件采用 MIT 许可。打包的 `agent-vision-toolkit` 快照在 `vendor/agent-vision-toolkit/LICENSE` 保留上游 MIT 许可证，并继续作为视觉算法的唯一实现。
