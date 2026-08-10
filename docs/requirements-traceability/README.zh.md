# Vision Toolkit 需求追踪

[English](README.md) | 中文

本参考将 DSH Vision Toolkit 产品需求中承诺的 P0/P1 条目映射到对应实现、自动化覆盖和可运行验收证据。标记为**已交付**的条目属于软件包契约；P2/P3 条目记录有意设置的产品边界，不代表尚未完成的 P0/P1 工作。

## P0 产品需求

| 需求 | 状态 | 负责实现 | 验证 |
|---|---|---|---|
| P0-1 标准 Profile Bundle | **已交付** | [`package.json`](../../package.json)、[`cordis.patch.yml`](../../cordis.patch.yml)、[`src/index.ts`](../../src/index.ts)、已提交的 `lib/` | [`tests/package-layout.spec.ts`](../../tests/package-layout.spec.ts)、[`tests/profile-install.e2e.spec.ts`](../../tests/profile-install.e2e.spec.ts)、干净 `--dump-config`、Web/Headless 启动、禁用和移除检查 |
| P0-2 上游复用 | **已交付** | [`src/version.ts`](../../src/version.ts)、[`src/runtime-install.ts`](../../src/runtime-install.ts)、[`scripts/upstream-manifest.mjs`](../../scripts/upstream-manifest.mjs)、[`scripts/sync-upstream.mjs`](../../scripts/sync-upstream.mjs)、[`vendor/agent-vision-toolkit/UPSTREAM_MANIFEST.json`](../../vendor/agent-vision-toolkit/UPSTREAM_MANIFEST.json) | [`tests/upstream.spec.ts`](../../tests/upstream.spec.ts)、[`tests/runtime-install.spec.ts`](../../tests/runtime-install.spec.ts)、构建时 manifest 验证 |
| P0-3 原生工具 | **已交付** | [`src/tools.ts`](../../src/tools.ts)、[`src/runtime.ts`](../../src/runtime.ts)、[`src/upstream.ts`](../../src/upstream.ts) | [`tests/tools.spec.ts`](../../tests/tools.spec.ts)、[`tests/runtime.spec.ts`](../../tests/runtime.spec.ts)、[`tests/upstream.spec.ts`](../../tests/upstream.spec.ts)、真实 Profile `vision_glance` 调用 |
| P0-4 配置与 Credential | **已交付** | [`src/config.ts`](../../src/config.ts)、[`src/runtime.ts`](../../src/runtime.ts) 中的逐操作解析、[`src/upstream.ts`](../../src/upstream.ts) 中的隔离环境构造 | [`tests/config.spec.ts`](../../tests/config.spec.ts)、[`tests/runtime.spec.ts`](../../tests/runtime.spec.ts) 和 [`tests/errors.spec.ts`](../../tests/errors.spec.ts) 中的 Credential/错误/脱敏用例 |
| P0-5 skill 生命周期 | **已交付** | [`src/index.ts`](../../src/index.ts) 中的就绪顺序和 disposer、[`src/skill.ts`](../../src/skill.ts) 中的打包内容 | [`tests/tools.spec.ts`](../../tests/tools.spec.ts)、[`tests/profile-install.e2e.spec.ts`](../../tests/profile-install.e2e.spec.ts) 中的禁用/卸载路径 |
| P0-6 纯文本模型结果 | **已交付** | [`src/tools.ts`](../../src/tools.ts) 中的 JSON 输出 schema 与纯渲染函数；[`src/artifacts.ts`](../../src/artifacts.ts) 中的规范产物描述 | [`tests/tools.spec.ts`](../../tests/tools.spec.ts) 中的工具 schema/展示断言、[`tests/profile-install.e2e.spec.ts`](../../tests/profile-install.e2e.spec.ts) 中的模型可见 transcript（文本记录）断言 |
| P0-7 稳定错误 | **已交付** | [`src/errors.ts`](../../src/errors.ts)，以及 [`src/paths.ts`](../../src/paths.ts)、[`src/runtime.ts`](../../src/runtime.ts)、[`src/upstream.ts`](../../src/upstream.ts) 中的边界验证 | [`tests/errors.spec.ts`](../../tests/errors.spec.ts)、[`tests/paths.spec.ts`](../../tests/paths.spec.ts)，以及运行时/上游测试中的解析、超时、取消、Credential 和容量用例 |
| P0-8 测试与文档 | **已交付** | 双语 [`README.md`](../../README.md)、软件包测试、managed 运行时、示例和已提交构建产物 | `pnpm run build`、`pnpm test`、`pnpm pack --dry-run`、翻译/Markdown 门禁和无真实 Key 的干净 Profile e2e |

## P1 产品需求

| 需求 | 状态 | 负责实现 | 验证 |
|---|---|---|---|
| P1-1 产物交付 | **已交付** | [`src/artifacts.ts`](../../src/artifacts.ts) 中的产物描述创建、[`src/paths.ts`](../../src/paths.ts) 中受围栏保护的原子路径、[`src/artifact-access.ts`](../../src/artifact-access.ts) 中的签名能力交付 | [`tests/artifacts.spec.ts`](../../tests/artifacts.spec.ts)、[`tests/artifact-access.spec.ts`](../../tests/artifact-access.spec.ts)、会生成产物的运行时/Profile 测试 |
| P1-2 扩展工具 | **已交付** | [`src/tools.ts`](../../src/tools.ts) 和 [`src/runtime.ts`](../../src/runtime.ts) 中的 `vision_pixel_diff`、`vision_long_screenshot_ocr`、`vision_extract_foreground`、`vision_dominant_colors`、`vision_html_screenshot` | [`tests/upstream.spec.ts`](../../tests/upstream.spec.ts) 和 [`tests/runtime.spec.ts`](../../tests/runtime.spec.ts) 中的 P1 解析器/运行时用例；真实 Profile pixel-diff 和长截图 OCR 调用 |
| P1-3 专用 Web 展示 | **已交付** | [`src/client/index.tsx`](../../src/client/index.tsx) 中的浏览器插件与专用卡片；[`src/artifact-access.ts`](../../src/artifact-access.ts) 中仅供展示的能力元数据 | [`tests/client.spec.ts`](../../tests/client.spec.ts)、[`tests/artifact-access.spec.ts`](../../tests/artifact-access.spec.ts) 中的安全预览测试、Web 视觉/Console QA |
| P1-4 健康检查 | **已交付** | [`src/runtime.ts`](../../src/runtime.ts) 中的 `vision_toolkit_health`、[`src/tools.ts`](../../src/tools.ts) 中的 schema、[`src/web.ts`](../../src/web.ts) 中的 Web 操作 | [`tests/runtime.spec.ts`](../../tests/runtime.spec.ts) 中的健康检查用例、[`tests/web.spec.ts`](../../tests/web.spec.ts) 中的显式连接行为 |
| P1-5 Settings | **已交付** | [`src/config.ts`](../../src/config.ts) 中的 namespace/配置、[`src/runtime-manager.ts`](../../src/runtime-manager.ts) 中的 prepare-before-swap manager、[`src/web.ts`](../../src/web.ts) 中的同源私有路由、[`src/client/index.tsx`](../../src/client/index.tsx) 中的 Settings 分区 | [`tests/runtime-manager.spec.ts`](../../tests/runtime-manager.spec.ts)、[`tests/web.spec.ts`](../../tests/web.spec.ts)、[`tests/client.spec.ts`](../../tests/client.spec.ts)、干净 Web Profile 保存/重启 QA |
| P1-6 安装与升级体验 | **已交付** | [`src/index.ts`](../../src/index.ts) 中的 Bundle 生命周期、[`src/runtime-install.ts`](../../src/runtime-install.ts) 中的内容寻址 managed 运行时、[`src/runtime-manager.ts`](../../src/runtime-manager.ts) 中的 generation manager | 运行时中断/并发测试、软件包布局测试、干净 Profile 生命周期、Settings 持久化和失败候选保留检查 |

## 横切需求

| 领域 | 契约与证据 |
|---|---|
| 安全 | [`src/paths.ts`](../../src/paths.ts) 通过 realpath 限制读写范围；[`src/runtime.ts`](../../src/runtime.ts) 在上传前解码并限制图片；[`src/artifact-access.ts`](../../src/artifact-access.ts) 每次读取都重新验证签名文件并 sandbox SVG；[`src/errors.ts`](../../src/errors.ts) 对密钥脱敏。路径、符号链接、格式、大小、伪造 token、文件替换和 CSP 用例均有自动化覆盖。 |
| 可移植性 | 运行时和浏览器调用使用 argv 向量与 Node 文件系统/进程 API，不拼接 POSIX Shell。Managed 准备同时提供 `uv` 和 `venv`/pip 路径；Python 与 Chrome 探测包含平台候选。软件包测试拒绝机器本地依赖声明，已提交 fixture/Profile 流程无需真实 Key。 |
| 性能与取消 | [`src/runtime.ts`](../../src/runtime.ts) 应用一个硬截止时间、传递 `AbortSignal`、限制每个会话的并发数、在远程 I/O 前拒绝解码后过大的图片，并在一次 glance 操作中对重复真实图片去重。超时、取消、信号量和独立会话行为均有自动化覆盖。 |
| 可观察性 | [`src/runtime.ts`](../../src/runtime.ts) 记录有界的工具名、结果、总耗时/上游耗时、图片数量/字节/像素、缓存命中、模型和错误类别，同时排除 base64、Credential、鉴权头和无界上游输出。 |
| 可维护性 | 每个工具都调用同一个 [`VisionToolkitRuntime`](../../src/runtime.ts)；DSH 专用适配保留在 [`src/tools.ts`](../../src/tools.ts)、[`src/index.ts`](../../src/index.ts)、[`src/web.ts`](../../src/web.ts) 和 [`src/client/index.tsx`](../../src/client/index.tsx)，固定上游继续作为算法唯一来源。工具 schema 与打包 skill 在同一生命周期 generation 中注册。 |
| HTML 截图隔离 | 固定截图 guard 使用一次性 Chrome Profile、`--use-mock-keychain` 和 `--incognito`，每次调用后删除 Profile，并保持网络禁用。[`tests/html-screenshot-guard.spec.ts`](../../tests/html-screenshot-guard.spec.ts) 捕获实际 argv 与清理行为。 |
| UI 还原验收 | [`scripts/ui-restoration-example.ts`](../../scripts/ui-restoration-example.ts) 通过真实运行时执行参考页面 → HTML 渲染 → 像素差异。[`examples/ui-restoration/README.md`](../../examples/ui-restoration/README.md) 负责可复现流程与已提交证据；[`tests/ui-restoration-example.spec.ts`](../../tests/ui-restoration-example.spec.ts) 强制执行该契约。 |

## 错误与生命周期场景

| 场景 | 预期行为 | 证据 |
|---|---|---|
| 图片缺失/无效、格式、区域或路径错误 | 在执行上游前以输入、容量或路径安全错误拒绝 | [`tests/paths.spec.ts`](../../tests/paths.spec.ts)、[`tests/runtime.spec.ts`](../../tests/runtime.spec.ts) |
| Credential 缺失 | 本地工具保持可用；远程工具和显式连接测试返回脱敏且可执行下一步的配置/服务结果 | [`tests/runtime.spec.ts`](../../tests/runtime.spec.ts)、[`tests/web.spec.ts`](../../tests/web.spec.ts) |
| 401/403、429、超时、畸形输出或取消 | 返回稳定且可执行下一步的类别，保留有界诊断信息，并停止请求/子进程 | [`tests/errors.spec.ts`](../../tests/errors.spec.ts)、[`tests/runtime.spec.ts`](../../tests/runtime.spec.ts)、[`tests/upstream.spec.ts`](../../tests/upstream.spec.ts) |
| 初始加载时运行时不可用 | 不注册工具或 skill；保留 Web Settings 以供修复 | [`src/index.ts`](../../src/index.ts)、[`tests/tools.spec.ts`](../../tests/tools.spec.ts) 与 [`tests/web.spec.ts`](../../tests/web.spec.ts) 中的生命周期测试 |
| 实时更新时运行时候选失败 | 保留当前服务 generation 和已存储的可用配置 | [`tests/runtime-manager.spec.ts`](../../tests/runtime-manager.spec.ts)、[`tests/web.spec.ts`](../../tests/web.spec.ts) |
| 并发 Settings 候选乱序完成 | 较新的 ticket 获胜；较慢的陈旧候选不能激活 | [`tests/runtime-manager.spec.ts`](../../tests/runtime-manager.spec.ts) |
| 禁用、重新启用或卸载 | 工具与 skill 作为一个生命周期单元一起消失和恢复；卸载会移除 Bundle layer | [`tests/tools.spec.ts`](../../tests/tools.spec.ts)、[`tests/profile-install.e2e.spec.ts`](../../tests/profile-install.e2e.spec.ts) |

## P2 与 P3 边界

| 范围 | 状态 | 决策 |
|---|---|---|
| P2 稳定 `ctx.visionToolkit` 服务与能力发现 | **按设计推迟** | 产品需求要求至少一个独立插件消费方出现后再稳定该 API。`VisionToolkitRuntime` 保持包内部使用，使 P0/P1 可以继续演进，而不会制造虚假的兼容性承诺。 |
| P2 提供方生态 | **按设计推迟** | 本包支持固定上游和一个已配置的 OpenAI 兼容视觉端点；不会预先构建无人使用的提供方注册表。 |
| P3 探索性输入与自动化 | **范围外** | 上传/拖拽、摄像头/视频/音频/文档输入、交互式标注、自动点击、远程集群、模型路由/投票和跨 Session 缓存不属于本版本契约。 |

## 可复现验证

在 `dsh-vision-toolkit/` 中运行软件包检查：

```sh
pnpm run build
pnpm test
pnpm run example:ui-restoration
pnpm pack --dry-run
```

发布验收还会运行仓库插件检查器，把软件包分别安装到干净的 Web 和 Headless `DSH_HOME`，检查 `--dump-config`，执行本地工具和由无真实 Key mock 支持的远程工具调用，验证 Settings 持久化与实时切换，检查专用 Web 卡片且确保浏览器 Console 无错误，禁用/重新启用插件行，最后移除软件包。这些运行时检查补充自动化测试，不替代自动化测试。
