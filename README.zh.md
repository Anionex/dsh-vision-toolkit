# DSH Vision Toolkit

[English](README.md) | 中文

DSH Vision Toolkit（`@dsh-external/dsh-vision-toolkit`）让纯文本 DeepSeek Harness
智能体获得结构化的"眼睛"。它把上游
[agent-vision-toolkit](https://github.com/Anionex/agent-vision-toolkit)
的视觉算法封装为六个 DSH 原生工具、统一的视觉配置与 DSH Credentials，以及随插件同生命周期挂载的
`vision-tools` Skill——一次安装、一个生命周期，无需手工拼接 Shell 命令。

当前为 P0 里程碑：五个核心工具加版本查询、结构化参数与结果、取消与超时、路径围栏、稳定错误，
以及工具/Skill 与运行时就绪状态绑定的生命周期。

## 工具

| 工具 | 用途 |
|---|---|
| `vision_glance` | 图片描述、针对性问答、OCR、一次调用比较多张图片 |
| `vision_ground` | 定位一个具名目标并返回原图像素框 |
| `vision_detect` | 盘点某一类元素，返回带编号的像素框 |
| `vision_trace` | 从平面位图恢复干净、可编辑的 SVG 几何 |
| `vision_crop` | 按像素框把图片区域裁剪为独立 PNG/JPEG 文件 |
| `vision_toolkit_version` | 查询插件与固定上游版本信息（只读） |

插件从不重写视觉算法：运行时把结构化请求转换为直接的上游 Python 调用（不经过 Shell 拼接），
解析上游稳定的输出契约，并向模型返回 JSON。坐标为原图像素框（`x1/y1/x2/y2`），可直接用于
`vision_crop`。

## 安装

插件是 Profile Bundle。在 DeepSeek Harness 检出目录中，把插件安装到需要的 Profile：

```sh
dsh plugin --profile web add /path/to/dsh-vision-toolkit
dsh plugin --profile headless add /path/to/dsh-vision-toolkit
```

随后按下方说明配置上游运行时与视觉服务并重启 Profile。`dsh --profile web --dump-config | grep vision-toolkit`
可确认挂载。

`vision-tools` Skill 只在上游检出通过就绪检查后注册，并与工具一起在禁用/卸载时注销——
Skill 永远不会介绍不可用的工具。

## 配置

在 Profile 中 patch 同 id 的配置行：

```yaml
- update:
    - id: vision-toolkit
      config:
        provider:
          baseUrl: https://api.inferera.com/v1
          credential: VISION_API_KEY
          model: gemini-3.6-flash
        language: zh
        timeoutMs: 60000
        maxImageBytes: 10485760
        concurrency: 4
        runtime:
          mode: external
          agentVisionToolkitPath: /Users/me/agent-vision-toolkit
          python: python3
        allowedDirs: []
```

| 字段 | 默认值 | 说明 |
|---|---|---|
| `provider.baseUrl` | `https://api.inferera.com/v1` | OpenAI 兼容视觉服务地址 |
| `provider.credential` | `VISION_API_KEY` | 保存 API Key 的 DSH Credential 引用 |
| `provider.model` | `gemini-3.6-flash` | 多模态模型名 |
| `language` | `zh` | 视觉输出语言（`zh` / `en`） |
| `timeoutMs` | `60000` | 单次调用预算，1000–600000 毫秒 |
| `maxImageBytes` | `10485760` | 输入图片最大字节数 |
| `concurrency` | `4` | 每会话并发工具执行数，1–16 |
| `runtime.mode` | `external` | P0 仅支持 `external`；托管运行时计划在 P1 提供 |
| `runtime.agentVisionToolkitPath` | 自动探测 | 上游检出路径；依次探测 `AGENT_VISION_TOOLKIT_PATH`、`~/.config/agent-vision-toolkit`、`~/.dsh/vision-toolkit/agent-vision-toolkit`、`~/agent-vision-toolkit` |
| `runtime.python` | `python3` | 运行上游 CLI 的 Python 可执行文件 |
| `allowedDirs` | `[]` | 除工作区外允许读取图片的目录 |

### 凭据

API Key 从不写入插件配置、日志、错误或模型上下文。`provider.credential` 是 DSH Credential
引用，每次工具调用通过 `ctx.credentials` 解析，只注入上游子进程环境（`VISION_API_KEY`）。
通过常规 DSH 凭据存储设置：

```sh
dsh credentials set VISION_API_KEY
```

如果上游 `agent-vision-toolkit` 的 env 文件存在（`~/.config/agent-vision-toolkit/env`、
上游 `.env` 或 `$PWD/.env`），按上游设计其值会覆盖插件配置；请删除或清空这些文件，让插件统一管理配置。

## 使用示例

```text
vision_glance images=["screenshot.png"] query="What error is shown?"
vision_ground image="screenshot.png" target="the send button"
vision_detect image="screenshot.png" category="buttons"
vision_crop image="screenshot.png" region="1067,841,1108,881"
vision_trace image="icon.png" color=true output="icon.svg"
```

典型 GUI 工作流：用 `vision_ground` 定位按钮，用 `vision_crop` 把紧致区域裁成文件，
再用 `vision_glance` 配合同一 `region` 读取细节，或用 `vision_trace` 恢复几何。

## 路径与安全模型

- 输入相对会话工作区解析，必须位于工作区或 `allowedDirs` 条目内（realpath 校验；符号链接仅当真实目标仍在围栏内时允许）。
- 输出落在工作区 `.dsh-vision-toolkit` 目录；拒绝绝对路径、`..` 段与错误扩展名。
- 图片 base64 不进入模型上下文、会话日志或插件日志；工具结果只有文字、数字、坐标与文件路径。
- 上游 stderr 在进入错误信息前会脱敏（API Key 替换为 `<redacted>`）。

## 上游版本策略

插件固定 [agent-vision-toolkit](https://github.com/Anionex/agent-vision-toolkit)
为 `v0.1.0`（`d194943f27bdb74dbee50760bc2c95f7d0f64fe7`，MIT 许可），绝不自动拉取 `main`。
`vision_toolkit_version` 报告打包的固定版本与本地检出路径。升级固定版本需有意为之，
并在新检出上跑完整测试后再更新。

## 开发

```sh
node ../node_modules/typescript/bin/tsc -p tsconfig.json   # build (also: npm run build)
node ../node_modules/vitest/vitest.mjs run tests           # unit + integration
```

插件类型检查使用 Harness 已构建的声明，测试通过根 `tsconfig.base.json` 的源码解析 facade
加载 Harness 源码；发布包保持裸包名导入，由宿主 Profile fallback 解析。`lib/` 构建产物已提交，
Git 检出即可安装，无需构建步骤。

## P0 范围与 P1 路线

P0 交付：标准 Bundle、六个原生工具、配置与凭据、取消/超时/错误分类、路径围栏、
随生命周期挂载的 Skill、测试、中英文文档，以及干净 `DSH_HOME` 安装验证。P1 增加 Artifact
交付、扩展工具（`pixel_diff`、长截图 OCR、前景提取、主色分析、HTML 截图）、专用 Web 展示、
健康检查、Settings 与托管运行时模式。

## License

MIT。固定上游 `agent-vision-toolkit` 保持 MIT 许可，且从不 vendored 进本包——它以外部运行时
方式在配置的检出路径被消费。
