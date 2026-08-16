/**
 * DSH Vision Toolkit browser plugin: dedicated Tool cards plus the Settings,
 * health, connection-test, and safe Artifact preview experience.
 */

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContext, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-credentials/types'
import type {} from '@deepseek-ai/dsh-settings/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { installPasteImages } from './paste-images.tsx'

const NS = 'vision-toolkit'
const SETTINGS_ROUTE = '/_dsh/vision-toolkit/settings'
const PRESENTATION_META_KEY = '$dshVisionToolkit'
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
// Keep these browser defaults aligned with src/defaults.ts without importing server-side config.
const BUILT_IN_FREE_VISION_BASE_URL = 'https://vision.anionex.me/v1'
const BUILT_IN_FREE_VISION_CREDENTIAL = 'ANIONEX_FREE_VISION'
const BUILT_IN_FREE_VISION_MODEL = 'gemma-4-26b-a4b-it'

const en = {
  nav: 'Vision',
  settingsTitle: 'Vision Toolkit',
  settingsIntro: 'Configure the pinned visual engineering runtime, its external vision endpoint, and local safety limits.',
  externalNotice: 'Remote tools send the selected image bytes to the configured external vision API. Local crop, trace, pixel diff, palette, foreground extraction, and HTML rendering do not upload images.',
  provider: 'Vision service',
  providerHint: 'Choose the API protocol, then provide the service address, model, and API key used by online vision features.',
  baseUrl: 'Base URL',
  apiKey: 'API key',
  apiKeyPlaceholderMissing: 'Paste the API key',
  apiKeyPlaceholderConfigured: 'Saved; leave blank to keep it',
  apiKeyHint: 'The key is stored in DSH Credentials and is never shown again after saving.',
  apiKeyLocked: 'The current key comes from a read-only source and cannot be replaced here.',
  apiKeyBlank: 'The API key cannot contain only spaces.',
  apiKeyInvalid: 'Paste only the key, without a variable name, quotes, spaces, or line breaks.',
  credential: 'Credential name',
  credentialHint: 'The built-in free provider needs no user key. For a custom provider, this is the DSH credential reference used to store its key.',
  model: 'Model',
  protocol: 'API protocol',
  anthropicThinking: 'Anthropic thinking',
  anthropicThinkingHint: 'omit has the broadest compatibility. Use disabled or adaptive only when the selected model documents that mode; restore omit first after HTTP 400.',
  userAgent: 'User-Agent',
  language: 'Output language',
  limits: 'Limits',
  timeout: 'Request timeout (ms)',
  maxBytes: 'Maximum image bytes',
  maxPixels: 'Maximum image pixels',
  concurrency: 'Concurrent calls per session',
  runtime: 'Runtime',
  runtimeMode: 'Runtime mode',
  toolkitPath: 'Pinned checkout path',
  python: 'Python override',
  allowedDirs: 'Additional allowed directories',
  allowedDirsHint: 'One path per line. The session workspace is always allowed.',
  save: 'Save and apply',
  saving: 'Validating runtime…',
  reload: 'Reload',
  saved: 'Settings validated and applied.',
  readOnly: 'Service settings are read-only. A writable API key can still be saved.',
  configured: 'Configured',
  missing: 'Missing',
  source: 'Source',
  sourceHint: '{source}: {value}',
  sourceEnv: 'Environment variable',
  sourceFile: 'Credential file',
  health: 'Health',
  runHealth: 'Run health check',
  testConnection: 'Test API connection',
  testModel: 'Test vision model',
  testing: 'Checking…',
  testingModel: 'Testing model…',
  connectionHint: 'The API connection test only queries GET /models. The vision model test sends the bundled diagnostic image and verifies one real multimodal request.',
  saveBeforeTesting: 'Save service changes before testing the connection.',
  advanced: 'Advanced settings',
  advancedHint: 'Credential name, provider compatibility, output language, resource limits, runtime source, Python, and additional readable directories.',
  pluginVersion: 'Plugin',
  upstreamVersion: 'Upstream',
  activeGeneration: 'Runtime generation',
  activeGenerationValue: 'Generation {generation}',
  updates: 'Plugin updates',
  updatesHint: 'Check npm for a newer release, install it into this DSH profile, and restart DSH Web automatically.',
  checkUpdate: 'Check for updates',
  checkingUpdate: 'Checking for updates…',
  updateAvailable: 'Update available',
  updateAvailableDetail: 'Version {version} is available. Updating restarts DSH Web and may interrupt work that is currently running.',
  upToDate: 'Up to date',
  upToDateDetail: 'Version {version} is the latest release.',
  updateNow: 'Update and restart',
  updatingPlugin: 'Updating and restarting…',
  updateConfirm: 'Install Vision Toolkit {version} and restart DSH Web now? Running work may be interrupted.',
  restarting: 'Version {version} was installed. Waiting for DSH Web to restart…',
  updateProfile: 'Profile',
  updateInstalled: 'Installed',
  updateLatest: 'Latest',
  updateUnsupported: 'Automatic updates are unavailable for this installation.',
  updateReasonProfileNotFound: 'The running plugin could not be matched to a DSH profile installation.',
  updateReasonNotDependency: 'The plugin is not a direct dependency of this DSH profile.',
  updateReasonLocalSource: 'This profile uses a local, workspace, URL, or git installation; update that source manually so local work is not overwritten.',
  updateReasonReadOnly: 'The profile package manifest is read-only.',
  updateReasonPnpm: 'pnpm is unavailable in the DSH execution environment.',
  updateReasonPlatform: 'Automatic restart is unavailable on this operating system.',
  updateReasonRestartUnmanaged: 'Detached self-restart is disabled. Use a supported process manager, or explicitly opt in with DSH_VISION_TOOLKIT_ALLOW_DETACHED_RESTART=1 for an unsupervised Web process.',
  updateReasonRestartAddress: 'Automatic restart is unavailable when DSH Web uses an unknown or dynamically allocated port. Start it with a fixed --port value.',
  updateSaveFirst: 'Save or discard the current Settings and API key changes before updating the plugin.',
  restartTimedOut: 'DSH Web did not return with the target plugin version. Check the restart log and restart the Web profile through its original process manager.',
  restartRolledBack: 'The new plugin did not become ready, so the previous version was restored. Check the restart log before trying again.',
  pluginKind: 'DSH native plugin',
  runtimeUnavailable: 'Runtime unavailable',
  runtimeCandidateRejected: 'Last runtime candidate was rejected; the active generation remains available.',
  runtimeReady: 'Ready',
  runtimeManaged: 'Managed',
  runtimeExternal: 'External checkout',
  retry: 'Retry',
  open: 'Open file',
  download: 'Download',
  previewUnavailable: 'HTTP preview is unavailable in this host; use Open file.',
  running: 'Running…',
  failed: 'Failed',
  matches: 'matches',
  elements: 'elements',
  dimensions: 'Dimensions',
  coordinates: 'Coordinates',
  artifact: 'Artifact',
  artifacts: 'Artifacts',
  difference: 'Overall difference',
  worstRegions: 'Worst regions',
  colors: 'Dominant colors',
  noResult: 'Structured result unavailable; inspect the raw Tool result.',
  healthy: 'Healthy',
  degraded: 'Needs attention',
  notTested: 'Not tested',
  groundTitle: 'Ground',
  detectTitle: 'Detect',
  traceTitle: 'Trace SVG',
  pixelDiffTitle: 'Pixel Diff',
  cropTitle: 'Crop',
  longOcrTitle: 'Long OCR',
  extractForegroundTitle: 'Extract Foreground',
  htmlScreenshotTitle: 'HTML Screenshot',
  artifactTitle: 'Vision Artifact',
  dominantColorsTitle: 'Dominant Colors',
  artifactGroundPreview: 'Grounding bounding-box preview',
  artifactDetectPreview: 'Detected-element bounding-box preview',
  artifactCrop: 'Cropped image region',
  artifactTrace: 'Traced vector geometry',
  artifactDiffHeatmap: 'Pixel-difference heatmap',
  artifactDiffReport: 'Structured pixel-difference report',
  artifactLongManifest: 'Long-screenshot split and merge manifest',
  artifactLongTranscript: 'Merged long-screenshot OCR transcript',
  artifactLongAudit: 'Long-screenshot OCR boundary audit',
  artifactLongChunk: 'Long-screenshot OCR chunk {index}',
  artifactOcrSidecar: 'OCR sidecar for chunk {index}',
  artifactForeground: 'Extracted transparent foreground',
  artifactHtmlScreenshot: 'Headless browser screenshot of local HTML',
  label: 'Label',
  paths: 'paths',
  healthPython: 'Python',
  healthDependencies: 'Dependencies',
  healthChrome: 'Browser',
  healthCredential: 'Credential',
  healthArtifactDirectory: 'Artifact directory',
  healthTempDirectory: 'Temporary directory',
  healthService: 'Vision service',
  healthModel: 'Vision model',
  statusOk: 'OK',
  statusWarning: 'Warning',
  statusError: 'Error',
  statusNotTested: 'Not tested',
  positiveInteger: '{field} must be a positive integer.',
  healthPythonDetail: '{version} via {path}',
  healthChromeMissing: 'Chrome, Chromium, or Edge was not found; HTML Screenshot is unavailable.',
  healthChromeProbeFailed: 'Could not check whether a supported browser is available.',
  healthCredentialMissing: 'Credential {credential} is not configured.',
  healthCredentialReady: 'Credential {credential} is available.',
  healthCredentialFailed: 'Could not read credential {credential}.',
  healthDirectoryWritable: '{directory} is writable: {path}',
  healthDirectoryNotWritable: '{directory} is not writable: {path}',
  healthArtifactDirectoryFailed: 'Could not prepare the artifact directory.',
  healthConnectionNotTested: 'API connection not tested. Use Test API connection to query /models.',
  healthConnectionCredentialMissing: 'Connection test skipped because the credential is unavailable.',
  healthServiceResponded: 'Service responded at {endpoint} (HTTP {status}).',
  healthServiceRejectedCredential: 'Service rejected the configured credential (HTTP {status}).',
  healthServiceNoModels: 'Service is reachable but does not support GET /models (HTTP {status}).',
  healthServiceRateLimited: 'Service is reachable, but the connection test was rate-limited (HTTP 429).',
  healthServiceHttpFailed: 'Connection test failed with HTTP {status}.',
  healthServiceUnreachable: 'Could not reach {endpoint}.',
  healthModelNotTested: 'Vision model not tested. Run Test vision model to make one real multimodal request.',
  healthModelCredentialMissing: 'Vision model test skipped because the credential is unavailable.',
  healthModelReady: 'Model {model} completed a real multimodal request.',
  healthModelFailed: 'Real multimodal request failed: {detail}',
  modelTestVerifiedTag: 'Verified',
  modelTestNotRunTag: 'Not tested',
  modelTestFailedTag: 'Test failed',
} as const

type LocaleKey = keyof typeof en

const zh: Record<LocaleKey, string> = {
  nav: '视觉工具',
  settingsTitle: '视觉工具箱',
  settingsIntro: '在这里设置视觉模型服务、工具运行环境，以及图片和文件的本地访问范围。',
  externalNotice: '使用图像理解、目标定位、界面检测或文字识别等在线功能时，所选图片会发送到下方配置的视觉服务。图片裁剪、轮廓描摹、像素对比、主色提取、前景提取和网页截图均在本机完成，不会上传图片。',
  provider: '在线视觉服务',
  providerHint: '选择接口协议后，填写在线视觉功能使用的 API 地址、模型名称和 API 密钥。',
  baseUrl: 'API 地址',
  apiKey: 'API 密钥',
  apiKeyPlaceholderMissing: '粘贴 API 密钥',
  apiKeyPlaceholderConfigured: '已保存；留空表示不修改',
  apiKeyHint: '密钥会保存到 DSH 凭据存储，保存后不会在页面中回显。',
  apiKeyLocked: '当前密钥来自只读配置，无法在此替换。',
  apiKeyBlank: 'API 密钥不能只包含空格。',
  apiKeyInvalid: '请只粘贴密钥本身，不要包含变量名、引号、空格或换行。',
  credential: '凭据名称',
  credentialHint: '内置免费视觉服务无需用户密钥；切换到自定义服务时，此处是保存其密钥的 DSH 凭据名称。',
  model: '模型名称',
  protocol: 'API 协议',
  anthropicThinking: 'Anthropic thinking',
  anthropicThinkingHint: 'omit 兼容性最好。仅当所选模型明确支持时使用 disabled 或 adaptive；遇到 HTTP 400 时先恢复 omit。',
  userAgent: 'User-Agent',
  language: '结果语言',
  limits: '资源与并发限制',
  timeout: '单次请求超时（毫秒）',
  maxBytes: '单张图片大小上限（字节）',
  maxPixels: '单张图片最大像素数',
  concurrency: '单个会话最多并发任务数',
  runtime: '工具运行环境',
  runtimeMode: '环境来源',
  toolkitPath: 'agent-vision-toolkit 目录',
  python: 'Python 解释器（可选）',
  allowedDirs: '允许读取的其他目录',
  allowedDirsHint: '每行填写一个目录。当前会话的工作目录始终可以读取，无需重复填写。',
  save: '保存设置',
  saving: '正在检查并应用…',
  reload: '重新加载',
  saved: '设置已保存并生效。',
  readOnly: '服务设置来自只读配置；如果 API 密钥可写，仍可在此保存密钥。',
  configured: '已就绪',
  missing: '未配置',
  source: '配置来源',
  sourceHint: '{source}：{value}',
  sourceEnv: '环境变量',
  sourceFile: '凭据文件',
  health: '运行检查',
  runHealth: '检查本地环境',
  testConnection: '测试 API 连接',
  testModel: '测试视觉模型',
  testing: '检查中…',
  testingModel: '正在测试模型…',
  connectionHint: '“测试 API 连接”只请求 GET /models；“测试视觉模型”会发送插件自带的诊断图片，验证一次真实多模态调用。',
  saveBeforeTesting: '修改服务配置后，请先保存，再执行 API 或视觉模型测试。',
  advanced: '高级设置',
  advancedHint: '凭据名称、服务兼容参数、结果语言、资源限制、运行环境来源、Python 和额外可读目录。一般无需修改。',
  pluginVersion: '插件版本',
  upstreamVersion: '工具包版本',
  activeGeneration: '本次运行已应用',
  activeGenerationValue: '{generation} 次',
  updates: '插件更新',
  updatesHint: '检查 npm 新版本，自动更新当前 DSH Profile 中的插件，然后重启 DSH Web。',
  checkUpdate: '检查更新',
  checkingUpdate: '正在检查更新…',
  updateAvailable: '发现新版本',
  updateAvailableDetail: '可更新到 {version}。更新会重启 DSH Web，正在运行的任务可能会被中断。',
  upToDate: '已是最新版',
  upToDateDetail: '当前 {version} 已是最新正式版本。',
  updateNow: '自动更新并重启',
  updatingPlugin: '正在更新并重启…',
  updateConfirm: '现在安装 Vision Toolkit {version} 并重启 DSH Web 吗？正在运行的任务可能会被中断。',
  restarting: '已安装 {version}，正在等待 DSH Web 重启…',
  updateProfile: 'Profile',
  updateInstalled: '当前版本',
  updateLatest: '最新版本',
  updateUnsupported: '当前安装方式不支持自动更新。',
  updateReasonProfileNotFound: '无法把正在运行的插件匹配到某个 DSH Profile 安装。',
  updateReasonNotDependency: '该插件不是当前 DSH Profile 的直接依赖。',
  updateReasonLocalSource: '当前使用本地、workspace、URL 或 git 安装；为避免覆盖本地修改，请手动更新对应来源。',
  updateReasonReadOnly: '当前 Profile 的 package.json 不可写。',
  updateReasonPnpm: 'DSH 运行环境中找不到 pnpm。',
  updateReasonPlatform: '当前操作系统不支持安全的自动重启。',
  updateReasonRestartUnmanaged: '默认禁用脱离原进程管理器的自重启。仅对无人监管的 Web 进程明确设置 DSH_VISION_TOOLKIT_ALLOW_DETACHED_RESTART=1 后开放。',
  updateReasonRestartAddress: 'DSH Web 使用未知端口或动态端口时无法安全自动重启。请用固定的 --port 值启动。',
  updateSaveFirst: '更新插件前，请先保存或放弃当前 Settings 和 API 密钥修改。',
  restartTimedOut: 'DSH Web 未能以目标插件版本恢复。请检查重启日志，并通过原进程管理器重启 Web Profile。',
  restartRolledBack: '新插件未能就绪，系统已恢复上一版本。再次尝试前请检查重启日志。',
  pluginKind: 'DSH 原生插件',
  runtimeUnavailable: '运行环境尚未就绪',
  runtimeCandidateRejected: '新设置未能生效，仍在使用上一次可用的设置。',
  runtimeReady: '已就绪',
  runtimeManaged: '自动安装',
  runtimeExternal: '本地源码',
  retry: '重试',
  open: '在工作区中打开',
  download: '下载',
  previewUnavailable: '此页面无法直接预览该文件，请在工作区中打开。',
  running: '运行中…',
  failed: '运行失败',
  matches: '处匹配',
  elements: '个元素',
  dimensions: '图片尺寸',
  coordinates: '坐标',
  artifact: '生成文件',
  artifacts: '个生成文件',
  difference: '像素差异',
  worstRegions: '差异最大的区域',
  colors: '种颜色',
  noResult: '未能读取结果，请查看工具的原始输出。',
  healthy: '一切正常',
  degraded: '有项目需要处理',
  notTested: '尚未检查',
  groundTitle: '目标定位',
  detectTitle: '界面元素识别',
  traceTitle: '描摹为 SVG',
  pixelDiffTitle: '像素对比',
  cropTitle: '裁剪图片',
  longOcrTitle: '长图文字识别',
  extractForegroundTitle: '提取前景',
  htmlScreenshotTitle: '网页截图',
  artifactTitle: '视觉处理结果',
  dominantColorsTitle: '主色提取',
  artifactGroundPreview: '目标定位框预览',
  artifactDetectPreview: '界面元素标注预览',
  artifactCrop: '裁剪后的图片',
  artifactTrace: '描摹得到的矢量图',
  artifactDiffHeatmap: '像素差异热力图',
  artifactDiffReport: '像素差异详细报告',
  artifactLongManifest: '长图切分与合并记录',
  artifactLongTranscript: '长图文字识别结果',
  artifactLongAudit: '长图分块边界检查记录',
  artifactLongChunk: '长图文字识别分块 {index}',
  artifactOcrSidecar: '分块 {index} 的文字识别记录',
  artifactForeground: '提取后的透明背景前景图',
  artifactHtmlScreenshot: '本地网页截图',
  label: '名称',
  paths: '条路径',
  healthPython: 'Python',
  healthDependencies: 'Python 依赖',
  healthChrome: '浏览器',
  healthCredential: 'API 密钥',
  healthArtifactDirectory: '输出目录',
  healthTempDirectory: '临时目录',
  healthService: '视觉服务',
  healthModel: '视觉模型',
  statusOk: '正常',
  statusWarning: '注意',
  statusError: '异常',
  statusNotTested: '未检查',
  positiveInteger: '{field}必须填写正整数。',
  healthPythonDetail: '版本 {version}；解释器：{path}',
  healthChromeMissing: '未找到 Chrome、Chromium 或 Edge，网页截图功能暂不可用。',
  healthChromeProbeFailed: '无法检查浏览器是否可用。',
  healthCredentialMissing: '尚未配置凭据 {credential}。',
  healthCredentialReady: '已找到凭据 {credential}。',
  healthCredentialFailed: '无法读取凭据 {credential}。',
  healthDirectoryWritable: '{directory}可写：{path}',
  healthDirectoryNotWritable: '{directory}不可写：{path}',
  healthArtifactDirectoryFailed: '无法准备输出目录。',
  healthConnectionNotTested: '尚未测试 API 连接。点击“测试 API 连接”可请求 /models。',
  healthConnectionCredentialMissing: 'API 密钥不可用，未执行连接测试。',
  healthServiceResponded: '服务已响应：{endpoint}（HTTP {status}）。',
  healthServiceRejectedCredential: '服务拒绝了当前 API 密钥（HTTP {status}）。',
  healthServiceNoModels: '服务可以访问，但不支持 GET /models（HTTP {status}）。',
  healthServiceRateLimited: '服务可以访问，但本次连接测试触发了限流（HTTP 429）。',
  healthServiceHttpFailed: '连接测试失败（HTTP {status}）。',
  healthServiceUnreachable: '无法连接到 {endpoint}。',
  healthModelNotTested: '尚未测试视觉模型。点击“测试视觉模型”可执行一次真实多模态请求。',
  healthModelCredentialMissing: '视觉模型测试已跳过，因为当前 API 密钥不可用。',
  healthModelReady: '模型 {model} 已完成一次真实多模态请求。',
  healthModelFailed: '真实多模态请求失败：{detail}',
  modelTestVerifiedTag: '已实测',
  modelTestNotRunTag: '未测试',
  modelTestFailedTag: '测试失败',
}

type Translate = (key: LocaleKey, params?: Record<string, unknown>) => string

interface ToolCallOwnerProps {
  callId: string
  toolName: string
  block: ToolCallBlock
  cwd?: string | undefined
  openFile: (path: string) => void
  inspect?: (() => void) | undefined
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Keyed atomic Tool call view, dispatched by wire Tool name. */
    'tool.call.toolview': { kind: 'keyed'; scope: 'session'; owner: ToolCallOwnerProps }
  }

  interface LocaleNamespaceMap {
    /** DSH Vision Toolkit Tool cards and Settings copy. */
    'vision-toolkit': LocaleKey
  }
}

type ToolCallViewProps = PropsRuntime<'tool.call.toolview'>

interface ArtifactDescriptor {
  path: string
  filename: string
  mimeType: string
  kind: 'image' | 'svg' | 'markdown' | 'json'
  description: string
  sourceTool: string
  previewIntent: 'image' | 'svg' | 'text' | 'download'
  bytes: number
}

interface ArtifactGrant {
  path: string
  previewUrl: string
  downloadUrl: string
}

interface HealthCheck {
  status: 'ok' | 'warning' | 'error' | 'not_tested'
  detail: string
}

interface HealthResult {
  pluginVersion: string
  checks: Record<string, HealthCheck>
  healthy: boolean
  connectionTested: boolean
  modelTested: boolean
}

interface SettingsValue {
  provider?: {
    baseUrl?: string
    credential?: string
    model?: string
    protocol?: 'openai' | 'anthropic'
    anthropicThinking?: 'omit' | 'disabled' | 'adaptive'
    userAgent?: string
  }
  language?: 'zh' | 'en'
  timeoutMs?: number
  maxImageBytes?: number
  maxImagePixels?: number
  concurrency?: number
  runtime?: { mode?: 'managed' | 'external'; agentVisionToolkitPath?: string; python?: string }
  allowedDirs?: string[]
}

type PluginUpdateUnavailableReason =
  | 'profile-not-found'
  | 'not-direct-dependency'
  | 'unsupported-install-source'
  | 'profile-read-only'
  | 'pnpm-unavailable'
  | 'unsupported-platform'
  | 'restart-unmanaged'
  | 'restart-address-unavailable'

interface PluginUpdateCapability {
  supported: boolean
  checkSupported?: boolean
  profile?: string
  dependencySpec?: string
  reason?: PluginUpdateUnavailableReason
}

interface PluginUpdateCheck extends PluginUpdateCapability {
  currentVersion: string
  latestVersion?: string
  updateAvailable: boolean
  checkedAt: string
}

interface PluginUpdateResult {
  fromVersion: string
  toVersion: string
  profile: string
  restarting: true
  retryAfterMs: number
}

interface SettingsSnapshot {
  schemaVersion: 1
  writable: boolean
  settings: { value: SettingsValue; revision: number; applies: 'live' }
  credential: { ref: string; configured: boolean; source?: string; writable: boolean }
  runtime: {
    ready: boolean
    generation: number
    activeConfig?: SettingsValue
    upstream?: {
      source: 'managed' | 'external'
      path: string
      runtimeHome: string
      python: string
      pythonVersion: string
    }
    lastError?: string
  }
  release: {
    pluginVersion: string
    upstreamRepository: string
    upstreamVersion: string
    upstreamCommit: string
    update: PluginUpdateCapability
  }
  artifactRouteAvailable: boolean
}

interface ApiSuccess<T> { ok: true; value: T }
interface ApiFailure { ok: false; error: { code: string; message: string } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textOfContent(block: ToolCallBlock): string {
  if (!('kind' in block)) return ''
  return block.content
    .filter((entry): entry is Extract<typeof entry, { type: 'text' }> => entry.type === 'text')
    .map(entry => entry.text)
    .join('\n')
}

/** Decode canonical presentation metadata with a JSON-text fallback. */
export function decodeVisionResult(block: ToolCallBlock): Record<string, unknown> | undefined {
  if (!('kind' in block) || block.isError) return undefined
  if (isRecord(block.meta)) return block.meta
  const text = textOfContent(block).trim()
  if (text.length === 0) return undefined
  try {
    const parsed = JSON.parse(text) as unknown
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function accessMap(value: Record<string, unknown> | undefined): Map<string, ArtifactGrant> {
  const map = new Map<string, ArtifactGrant>()
  if (value === undefined) return map
  const envelope = value[PRESENTATION_META_KEY]
  if (!isRecord(envelope) || envelope.schemaVersion !== 1 || !Array.isArray(envelope.artifacts)) return map
  for (const entry of envelope.artifacts) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.previewUrl !== 'string' || typeof entry.downloadUrl !== 'string') continue
    map.set(entry.path, entry as unknown as ArtifactGrant)
  }
  return map
}

function artifactFrom(value: unknown): ArtifactDescriptor | undefined {
  if (!isRecord(value)) return undefined
  if (
    typeof value.path !== 'string'
    || typeof value.filename !== 'string'
    || typeof value.mimeType !== 'string'
    || (value.kind !== 'image' && value.kind !== 'svg' && value.kind !== 'markdown' && value.kind !== 'json')
    || typeof value.description !== 'string'
    || typeof value.sourceTool !== 'string'
    || (value.previewIntent !== 'image' && value.previewIntent !== 'svg' && value.previewIntent !== 'text' && value.previewIntent !== 'download')
    || typeof value.bytes !== 'number'
  ) return undefined
  return value as unknown as ArtifactDescriptor
}

function collectArtifacts(value: unknown, found = new Map<string, ArtifactDescriptor>(), depth = 0): ArtifactDescriptor[] {
  if (depth > 16) return [...found.values()]
  const artifact = artifactFrom(value)
  if (artifact !== undefined) {
    found.set(artifact.path, artifact)
    return [...found.values()]
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectArtifacts(entry, found, depth + 1)
  } else if (isRecord(value)) {
    for (const entry of Object.values(value)) collectArtifacts(entry, found, depth + 1)
  }
  return [...found.values()]
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function boxText(value: unknown): string {
  if (!isRecord(value)) return '—'
  const parts = ['x1', 'y1', 'x2', 'y2'].map(key => numberOf(value[key]))
  return parts.every(part => part !== undefined) ? parts.join(', ') : '—'
}

function statusText(block: ToolCallBlock, t: Translate): string | undefined {
  if (!('kind' in block)) return t('running')
  if (block.isError) return textOfContent(block).split('\n')[0] || t('failed')
  return undefined
}

function VisionIcon({ kind = 'scan' }: { kind?: 'scan' | 'target' | 'layers' | 'shape' | 'diff' | 'palette' }) {
  const path = kind === 'target'
    ? 'M8 2v2m0 8v2M2 8h2m8 0h2M5 5h6v6H5z'
    : kind === 'layers'
      ? 'm3 6 5-3 5 3-5 3-5-3Zm0 3 5 3 5-3M3 12l5 3 5-3'
      : kind === 'shape'
        ? 'M3 12 6 4l7-1-1 7-9 2Zm3-8 6 6'
        : kind === 'diff'
          ? 'M3 3h4v4H3V3Zm6 6h4v4H9V9Zm0-6h4M3 11h4'
          : kind === 'palette'
            ? 'M8 2a6 6 0 1 0 0 12h1.2a1.3 1.3 0 0 0 0-2.6H8a1.5 1.5 0 0 1 0-3h3.5A2.5 2.5 0 0 0 14 5.9C13.2 3.6 10.9 2 8 2Z'
            : 'M3 5V3h2M11 3h2v2M13 11v2h-2M5 13H3v-2M5 8h6'
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  )
}

function ToolShell({
  block, title, summary, icon, children, t,
}: {
  block: ToolCallBlock
  title: string
  summary?: string | undefined
  icon: ReactNode
  children?: ReactNode | undefined
  t: Translate
}) {
  const [open, setOpen] = useState(true)
  const status = statusText(block, t)
  const expandable = children !== undefined && children !== null
  return (
    <section className="dvt-tool" data-state={!('kind' in block) ? 'running' : block.isError ? 'error' : 'success'}>
      <button type="button" className="dvt-tool-head" onClick={() => { if (expandable) setOpen(value => !value) }} aria-expanded={expandable ? open : undefined}>
        <span className="dvt-tool-icon">{icon}</span>
        <span className="dvt-tool-title">{title}</span>
        {summary !== undefined && summary.length > 0 ? <span className="dvt-tool-sep" aria-hidden="true">·</span> : null}
        {summary !== undefined ? <span className="dvt-tool-summary">{summary}</span> : null}
        {status !== undefined ? <span className="dvt-tool-status">{status}</span> : null}
        {expandable ? <span className="dvt-chevron" data-open={open || undefined}>⌄</span> : null}
      </button>
      {expandable && open ? <div className="dvt-tool-body">{children}</div> : null}
    </section>
  )
}

function ArtifactActions({ artifact, grant, openFile, t }: {
  artifact: ArtifactDescriptor
  grant?: ArtifactGrant | undefined
  openFile: (path: string) => void
  t: Translate
}) {
  return (
    <div className="dvt-actions">
      <Button size="sm" variant="outline" onClick={() => { openFile(artifact.path) }}>{t('open')}</Button>
      {grant === undefined ? null : <a className="dvt-download" href={grant.downloadUrl} download={artifact.filename}>{t('download')}</a>}
    </div>
  )
}

function ArtifactPreview({ artifact, grant, openFile, t }: {
  artifact: ArtifactDescriptor
  grant?: ArtifactGrant | undefined
  openFile: (path: string) => void
  t: Translate
}) {
  const canPreview = grant !== undefined && (artifact.kind === 'image' || artifact.kind === 'svg')
  const description = artifactDescription(artifact.description, t)
  return (
    <article className="dvt-artifact">
      {canPreview
        ? artifact.kind === 'svg'
          ? <iframe className="dvt-preview dvt-svg" sandbox="" src={grant.previewUrl} title={description} />
          : <img className="dvt-preview" src={grant.previewUrl} alt={description} loading="lazy" />
        : null}
      <div className="dvt-artifact-meta">
        <div>
          <strong>{artifact.filename}</strong>
          <span>{description}</span>
          <small>{artifact.mimeType} · {formatBytes(artifact.bytes)}</small>
        </div>
        <ArtifactActions artifact={artifact} grant={grant} openFile={openFile} t={t} />
      </div>
      {!canPreview && grant === undefined ? <p className="dvt-muted">{t('previewUnavailable')}</p> : null}
    </article>
  )
}

const ARTIFACT_DESCRIPTION_KEYS: Record<string, LocaleKey> = {
  'Grounding bounding-box preview': 'artifactGroundPreview',
  'Detected-element bounding-box preview': 'artifactDetectPreview',
  'Cropped image region': 'artifactCrop',
  'Traced vector geometry': 'artifactTrace',
  'Pixel-difference heatmap': 'artifactDiffHeatmap',
  'Structured pixel-difference report': 'artifactDiffReport',
  'Long-screenshot split and merge manifest': 'artifactLongManifest',
  'Merged long-screenshot OCR transcript': 'artifactLongTranscript',
  'Long-screenshot OCR boundary audit': 'artifactLongAudit',
  'Extracted transparent foreground': 'artifactForeground',
  'Headless browser screenshot of local HTML': 'artifactHtmlScreenshot',
}

function artifactDescription(description: string, t: Translate): string {
  const key = ARTIFACT_DESCRIPTION_KEYS[description]
  if (key !== undefined) {
    const translated = t(key)
    return translated === key ? description : translated
  }
  let match = /^Long-screenshot OCR chunk (\d+)$/u.exec(description)
  if (match !== null) {
    const translated = t('artifactLongChunk', { index: match[1] })
    return translated === 'artifactLongChunk' ? description : translated
  }
  match = /^OCR sidecar for chunk (\d+)$/u.exec(description)
  if (match !== null) {
    const translated = t('artifactOcrSidecar', { index: match[1] })
    return translated === 'artifactOcrSidecar' ? description : translated
  }
  return description
}

type ViewProps = ToolCallViewProps & { t?: Translate }

function GroundView({ block, openFile, t = key => en[key] }: ViewProps) {
  const value = decodeVisionResult(block)
  const matches = Array.isArray(value?.matches) ? value.matches.filter(isRecord) : []
  const target = stringOf(value?.target) ?? t('groundTitle')
  const width = numberOf(value?.imageWidth)
  const height = numberOf(value?.imageHeight)
  const preview = artifactFrom(value?.preview)
  const grants = accessMap(value)
  return (
    <ToolShell block={block} title={t('groundTitle')} summary={matches.length > 0 ? `${target} · ${matches.length} ${t('matches')}` : target} icon={<VisionIcon kind="target" />} t={t}>
      {value === undefined ? <p className="dvt-muted">{t('noResult')}</p> : (
        <div className="dvt-stack">
          <div className="dvt-metrics">
            <div><span>{t('dimensions')}</span><strong>{width ?? '—'} × {height ?? '—'}</strong></div>
            <div><span>{t('coordinates')}</span><strong>{matches[0] === undefined ? '—' : boxText(matches[0].box)}</strong></div>
          </div>
          {matches.length > 1 ? (
            <ol className="dvt-list">{matches.map((match, index) => <li key={index}><span>{stringOf(match.label) ?? `#${index + 1}`}</span><code>{boxText(match.box)}</code></li>)}</ol>
          ) : null}
          {preview === undefined ? null : <ArtifactPreview artifact={preview} grant={grants.get(preview.path)} openFile={openFile} t={t} />}
        </div>
      )}
    </ToolShell>
  )
}

function DetectView({ block, openFile, t = key => en[key] }: ViewProps) {
  const value = decodeVisionResult(block)
  const elements = Array.isArray(value?.elements) ? value.elements.filter(isRecord) : []
  const width = numberOf(value?.imageWidth)
  const height = numberOf(value?.imageHeight)
  const preview = artifactFrom(value?.preview)
  const grants = accessMap(value)
  return (
    <ToolShell block={block} title={t('detectTitle')} summary={`${elements.length} ${t('elements')}`} icon={<VisionIcon kind="layers" />} t={t}>
      {value === undefined ? <p className="dvt-muted">{t('noResult')}</p> : (
        <div className="dvt-stack">
          <div className="dvt-metrics">
            <div><span>{t('dimensions')}</span><strong>{width ?? '—'} × {height ?? '—'}</strong></div>
            <div><span>{t('elements')}</span><strong>{elements.length}</strong></div>
          </div>
          <div className="dvt-table-wrap"><table className="dvt-table"><thead><tr><th>#</th><th>{t('label')}</th><th>{t('coordinates')}</th></tr></thead><tbody>
            {elements.map((element, index) => <tr key={index}><td>{numberOf(element.index) ?? index + 1}</td><td>{stringOf(element.label) ?? '—'}</td><td><code>{boxText(element.box)}</code></td></tr>)}
          </tbody></table></div>
          {preview === undefined ? null : <ArtifactPreview artifact={preview} grant={grants.get(preview.path)} openFile={openFile} t={t} />}
        </div>
      )}
    </ToolShell>
  )
}

function TraceView({ block, openFile, t = key => en[key] }: ViewProps) {
  const value = decodeVisionResult(block)
  const artifact = artifactFrom(value?.artifact)
  const geometry = isRecord(value?.geometry) ? value.geometry : undefined
  const summary = geometry === undefined ? undefined : `${numberOf(geometry.pathCount) ?? 0} ${t('paths')} · ${formatBytes(numberOf(geometry.bytes) ?? 0)}`
  const grants = accessMap(value)
  return (
    <ToolShell block={block} title={t('traceTitle')} summary={summary} icon={<VisionIcon kind="shape" />} t={t}>
      {artifact === undefined ? <p className="dvt-muted">{t('noResult')}</p> : <ArtifactPreview artifact={artifact} grant={grants.get(artifact.path)} openFile={openFile} t={t} />}
    </ToolShell>
  )
}

function PixelDiffView({ block, openFile, t = key => en[key] }: ViewProps) {
  const value = decodeVisionResult(block)
  const pct = numberOf(value?.overallDifferencePct)
  const regions = Array.isArray(value?.worstRegions) ? value.worstRegions.filter(isRecord) : []
  const heatmap = artifactFrom(value?.heatmap)
  const report = artifactFrom(value?.report)
  const grants = accessMap(value)
  return (
    <ToolShell block={block} title={t('pixelDiffTitle')} summary={pct === undefined ? undefined : `${pct.toFixed(3)}%`} icon={<VisionIcon kind="diff" />} t={t}>
      {value === undefined ? <p className="dvt-muted">{t('noResult')}</p> : (
        <div className="dvt-stack">
          <div className="dvt-diff-score"><span>{t('difference')}</span><strong>{pct?.toFixed(4) ?? '—'}%</strong><div><i style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} /></div></div>
          {regions.length === 0 ? null : <div><h4>{t('worstRegions')}</h4><ol className="dvt-list">{regions.map((region, index) => <li key={index}><span>{(numberOf(region.differencePct) ?? 0).toFixed(3)}%</span><code>{boxText(region.box)}</code></li>)}</ol></div>}
          {heatmap === undefined ? null : <ArtifactPreview artifact={heatmap} grant={grants.get(heatmap.path)} openFile={openFile} t={t} />}
          {report === undefined ? null : <ArtifactPreview artifact={report} grant={grants.get(report.path)} openFile={openFile} t={t} />}
        </div>
      )}
    </ToolShell>
  )
}

function ArtifactView({ block, openFile, toolName, t = key => en[key] }: ViewProps) {
  const value = decodeVisionResult(block)
  const artifacts = collectArtifacts(value)
  const grants = accessMap(value)
  const title = toolName === 'vision_crop' ? t('cropTitle')
    : toolName === 'vision_long_screenshot_ocr' ? t('longOcrTitle')
      : toolName === 'vision_extract_foreground' ? t('extractForegroundTitle')
        : toolName === 'vision_html_screenshot' ? t('htmlScreenshotTitle')
          : t('artifactTitle')
  return (
    <ToolShell block={block} title={title} summary={artifacts.length > 0 ? `${artifacts.length} ${t('artifacts')}` : undefined} icon={<VisionIcon />} t={t}>
      {artifacts.length === 0 ? <p className="dvt-muted">{t('noResult')}</p> : <div className="dvt-stack">{artifacts.map(artifact => <ArtifactPreview key={artifact.path} artifact={artifact} grant={grants.get(artifact.path)} openFile={openFile} t={t} />)}</div>}
    </ToolShell>
  )
}

function PaletteView({ block, t = key => en[key] }: ViewProps) {
  const value = decodeVisionResult(block)
  const analysis = isRecord(value?.analysis) ? value.analysis : undefined
  const colors = Array.isArray(analysis?.colors) ? analysis.colors.filter(isRecord) : []
  return (
    <ToolShell block={block} title={t('dominantColorsTitle')} summary={`${colors.length} ${t('colors')}`} icon={<VisionIcon kind="palette" />} t={t}>
      {colors.length === 0 ? <p className="dvt-muted">{t('noResult')}</p> : <div className="dvt-palette">{colors.map((color, index) => {
        const hex = stringOf(color.color) ?? '#000000'
        const share = numberOf(color.sharePct)
        return <div key={`${hex}-${index}`}><i style={{ background: hex }} /><span><strong>{hex}</strong><small>{share === undefined ? '' : `${share.toFixed(2)}%`}</small></span></div>
      })}</div>}
    </ToolShell>
  )
}

async function apiRequest<T>(init?: RequestInit): Promise<T> {
  const response = await fetch(SETTINGS_ROUTE, { credentials: 'same-origin', ...init })
  const body = await response.json() as ApiSuccess<T> | ApiFailure
  if (!response.ok || !body.ok) {
    const failure = body as ApiFailure
    throw new Error(failure.error?.message ?? `Vision Toolkit request failed with HTTP ${response.status}`)
  }
  return body.value
}

interface SettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  snapshot?: SettingsSnapshot | undefined
  health?: HealthResult | undefined
  update?: PluginUpdateCheck | undefined
  restart?: PluginUpdateResult | undefined
  action?: 'save' | 'health' | 'connection' | 'model' | 'check-update' | 'apply-update' | undefined
  message?: string | undefined
  error?: string | undefined
}

/** Small external store shared by the Settings route and pushed invalidations. */
export class VisionSettingsController {
  private state: SettingsState = { status: 'idle' }
  private listeners = new Set<() => void>()
  private generation = 0

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  snapshot = (): SettingsState => this.state

  private set(next: SettingsState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  async load(): Promise<void> {
    const generation = ++this.generation
    this.set({ ...this.state, status: 'loading', error: undefined, message: undefined })
    try {
      const snapshot = await apiRequest<SettingsSnapshot>()
      if (generation !== this.generation) return
      this.set({
        status: 'ready',
        snapshot,
        health: this.state.health,
        update: this.state.update,
        restart: this.state.restart,
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.set({ ...this.state, status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  refreshIfLoaded(): void {
    if (this.state.status === 'idle' || this.state.action === 'save') return
    void this.load()
  }

  async save(
    value: SettingsValue,
    expectedRevision: number,
    credentialValue: string | undefined,
    writeSettings: boolean,
  ): Promise<boolean> {
    this.set({ ...this.state, action: 'save', error: undefined, message: undefined })
    let snapshot = this.state.snapshot
    try {
      if (writeSettings) {
        snapshot = await apiRequest<SettingsSnapshot>({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save', expectedRevision, value }),
        })
      }
      if (snapshot === undefined) throw new Error('Vision Toolkit Settings are unavailable')
      if (credentialValue !== undefined) {
        try {
          snapshot = await apiRequest<SettingsSnapshot>({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'credential',
              expectedRevision: snapshot.settings.revision,
              ref: snapshot.credential.ref,
              value: credentialValue,
            }),
          })
        } catch (error) {
          this.set({
            status: 'ready',
            snapshot,
            health: this.state.health,
            update: this.state.update,
            restart: this.state.restart,
            error: error instanceof Error ? error.message : String(error),
          })
          return false
        }
      }
      this.set({
        status: 'ready',
        snapshot,
        health: this.state.health,
        update: this.state.update,
        restart: this.state.restart,
        message: 'saved',
      })
      return true
    } catch (error) {
      this.set({ ...this.state, action: undefined, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  async runHealth(mode: 'health' | 'connection' | 'model'): Promise<void> {
    const testConnection = mode !== 'health'
    const testModel = mode === 'model'
    this.set({ ...this.state, action: mode, error: undefined, message: undefined })
    try {
      const health = await apiRequest<HealthResult>({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'health', testConnection, testModel }),
      })
      this.set({ ...this.state, action: undefined, health })
    } catch (error) {
      this.set({ ...this.state, action: undefined, error: error instanceof Error ? error.message : String(error) })
    }
  }

  async checkUpdate(): Promise<void> {
    this.set({ ...this.state, action: 'check-update', error: undefined, message: undefined })
    try {
      const update = await apiRequest<PluginUpdateCheck>({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check-update' }),
      })
      this.set({ ...this.state, action: undefined, update })
    } catch (error) {
      this.set({ ...this.state, action: undefined, error: error instanceof Error ? error.message : String(error) })
    }
  }

  async applyUpdate(expectedVersion: string): Promise<void> {
    this.set({ ...this.state, action: 'apply-update', error: undefined, message: undefined })
    try {
      const restart = await apiRequest<PluginUpdateResult>({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply-update', expectedVersion }),
      })
      this.set({ ...this.state, action: undefined, restart, message: 'restarting' })
    } catch (error) {
      this.set({ ...this.state, action: undefined, error: error instanceof Error ? error.message : String(error) })
    }
  }

  reportRestartTimeout(message: string): void {
    this.set({ ...this.state, restart: undefined, message: undefined, error: message })
  }
}

interface Draft {
  baseUrl: string
  credential: string
  model: string
  protocol: 'openai' | 'anthropic'
  anthropicThinking: 'omit' | 'disabled' | 'adaptive'
  userAgent: string
  language: 'zh' | 'en'
  timeoutMs: string
  maxImageBytes: string
  maxImagePixels: string
  concurrency: string
  runtimeMode: 'managed' | 'external'
  toolkitPath: string
  python: string
  allowedDirs: string
}

function draftOf(value: SettingsValue): Draft {
  return {
    baseUrl: value.provider?.baseUrl ?? BUILT_IN_FREE_VISION_BASE_URL,
    credential: value.provider?.credential ?? BUILT_IN_FREE_VISION_CREDENTIAL,
    model: value.provider?.model ?? BUILT_IN_FREE_VISION_MODEL,
    protocol: value.provider?.protocol ?? 'openai',
    anthropicThinking: value.provider?.anthropicThinking ?? 'omit',
    userAgent: value.provider?.userAgent ?? DEFAULT_USER_AGENT,
    language: value.language ?? 'zh',
    timeoutMs: String(value.timeoutMs ?? 60000),
    maxImageBytes: String(value.maxImageBytes ?? 4194304),
    maxImagePixels: String(value.maxImagePixels ?? 20000000),
    concurrency: String(value.concurrency ?? 4),
    runtimeMode: value.runtime?.mode ?? 'managed',
    toolkitPath: value.runtime?.agentVisionToolkitPath ?? '',
    python: value.runtime?.python ?? '',
    allowedDirs: (value.allowedDirs ?? []).join('\n'),
  }
}

function positiveInteger(raw: string, label: string, t: Translate): number {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(t('positiveInteger', { field: label }))
  return value
}

function apiKeyFailure(value: string, t: Translate): string | undefined {
  if (value.length === 0) return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) return t('apiKeyBlank')
  const quoted = trimmed.length > 1 && ['"', '\'', '`'].includes(trimmed[0] ?? '') && trimmed.endsWith(trimmed[0] ?? '')
  const environmentLine = /^[A-Z][A-Z0-9_]*=[^=]/u.test(trimmed)
  if (quoted || environmentLine || !/^[\x21-\x7E]+$/u.test(trimmed)) return t('apiKeyInvalid')
  return undefined
}

function valueOf(draft: Draft, t: Translate): SettingsValue {
  return {
    provider: {
      baseUrl: draft.baseUrl.trim(),
      credential: draft.credential.trim(),
      model: draft.model.trim(),
      protocol: draft.protocol,
      anthropicThinking: draft.anthropicThinking,
      userAgent: draft.userAgent.trim(),
    },
    language: draft.language,
    timeoutMs: positiveInteger(draft.timeoutMs, t('timeout'), t),
    maxImageBytes: positiveInteger(draft.maxImageBytes, t('maxBytes'), t),
    maxImagePixels: positiveInteger(draft.maxImagePixels, t('maxPixels'), t),
    concurrency: positiveInteger(draft.concurrency, t('concurrency'), t),
    runtime: {
      mode: draft.runtimeMode,
      ...(draft.runtimeMode === 'external' ? { agentVisionToolkitPath: draft.toolkitPath.trim() } : {}),
      ...(draft.python.trim().length === 0 ? {} : { python: draft.python.trim() }),
    },
    allowedDirs: draft.allowedDirs.split(/\r?\n/).map(entry => entry.trim()).filter(Boolean),
  }
}

function settingsDraftChanged(draft: Draft, saved: SettingsValue, t: Translate): boolean {
  try {
    return JSON.stringify(valueOf(draft, t)) !== JSON.stringify(valueOf(draftOf(saved), t))
  } catch {
    return true
  }
}

function isBuiltInFreeVisionDraft(draft: Draft): boolean {
  return draft.baseUrl.trim().replace(/\/+$/, '') === BUILT_IN_FREE_VISION_BASE_URL
    && draft.credential.trim() === BUILT_IN_FREE_VISION_CREDENTIAL
    && draft.model.trim() === BUILT_IN_FREE_VISION_MODEL
    && draft.protocol === 'openai'
}

interface SettingsInjected {
  controller: VisionSettingsController
  t: Translate
}

type SettingsProps = PropsRuntime<'settings.section'> & Partial<SettingsInjected>

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string | undefined }) {
  return <label className="dvt-field"><span>{label}</span>{children}{hint === undefined ? null : <small>{hint}</small>}</label>
}

function SettingsSection({ controller, t }: SettingsProps) {
  if (controller === undefined || t === undefined) return null
  return <LoadedSettings controller={controller} t={t} />
}

const HEALTH_NAME_KEYS: Record<string, LocaleKey> = {
  python: 'healthPython',
  dependencies: 'healthDependencies',
  chrome: 'healthChrome',
  credential: 'healthCredential',
  artifactDirectory: 'healthArtifactDirectory',
  tempDirectory: 'healthTempDirectory',
  service: 'healthService',
  model: 'healthModel',
}

const HEALTH_STATUS_KEYS: Record<HealthCheck['status'], LocaleKey> = {
  ok: 'statusOk',
  warning: 'statusWarning',
  error: 'statusError',
  not_tested: 'statusNotTested',
}

function healthDetail(name: string, detail: string, t: Translate): string {
  if (name === 'python') {
    const match = /^(.+) via (.+)$/u.exec(detail)
    if (match !== null) return t('healthPythonDetail', { version: match[1], path: match[2] })
  }
  if (detail === 'Chrome/Chromium/Edge was not found; vision_html_screenshot is unavailable') return t('healthChromeMissing')
  if (detail === 'Chrome availability probe failed') return t('healthChromeProbeFailed')
  let match = /^credential (.+) is not configured$/u.exec(detail)
  if (match !== null) return t('healthCredentialMissing', { credential: match[1] })
  match = /^credential (.+) is resolvable$/u.exec(detail)
  if (match !== null) return t('healthCredentialReady', { credential: match[1] })
  match = /^credential (.+) could not be resolved$/u.exec(detail)
  if (match !== null) return t('healthCredentialFailed', { credential: match[1] })
  match = /^(Artifact directory|Runtime temp directory) is writable: (.+)$/u.exec(detail)
  if (match !== null) return t('healthDirectoryWritable', {
    directory: match[1] === 'Artifact directory' ? t('healthArtifactDirectory') : t('healthTempDirectory'),
    path: match[2],
  })
  match = /^(Artifact directory|Runtime temp directory) is not writable: (.+)$/u.exec(detail)
  if (match !== null) return t('healthDirectoryNotWritable', {
    directory: match[1] === 'Artifact directory' ? t('healthArtifactDirectory') : t('healthTempDirectory'),
    path: match[2],
  })
  if (detail === 'Artifact directory could not be prepared') return t('healthArtifactDirectoryFailed')
  if (detail === 'Connection was not tested; pass testConnection=true to query the configured /models endpoint') return t('healthConnectionNotTested')
  if (detail === 'Connection test skipped because the configured credential is unavailable') return t('healthConnectionCredentialMissing')
  match = /^Service responded at (.+) \(HTTP (\d+)\)$/u.exec(detail)
  if (match !== null) return t('healthServiceResponded', { endpoint: match[1], status: match[2] })
  match = /^Service rejected the configured credential \(HTTP (\d+)\)$/u.exec(detail)
  if (match !== null) return t('healthServiceRejectedCredential', { status: match[1] })
  match = /^Service is reachable but does not expose GET \/models \(HTTP (\d+)\)$/u.exec(detail)
  if (match !== null) return t('healthServiceNoModels', { status: match[1] })
  if (detail === 'Service is reachable but rate-limited the connection test (HTTP 429)') return t('healthServiceRateLimited')
  match = /^Service connection test failed with HTTP (\d+)$/u.exec(detail)
  if (match !== null) return t('healthServiceHttpFailed', { status: match[1] })
  match = /^Service could not be reached at (.+)$/u.exec(detail)
  if (match !== null) return t('healthServiceUnreachable', { endpoint: match[1] })
  if (detail === 'Vision model was not tested; run an explicit model test to send the bundled diagnostic image') return t('healthModelNotTested')
  if (detail === 'Vision model test skipped because the configured credential is unavailable') return t('healthModelCredentialMissing')
  match = /^Vision model (.+) completed a multimodal request$/u.exec(detail)
  if (match !== null) return t('healthModelReady', { model: match[1] })
  match = /^Vision model test failed: (.+)$/u.exec(detail)
  if (match !== null) return t('healthModelFailed', { detail: match[1] })
  return detail
}

function modelTestTag(health: HealthResult, check: HealthCheck): { status: 'ok' | 'warning' | 'error'; label: LocaleKey } {
  if (!health.modelTested) return { status: 'warning', label: 'modelTestNotRunTag' }
  if (check.status === 'ok') return { status: 'ok', label: 'modelTestVerifiedTag' }
  return { status: 'error', label: 'modelTestFailedTag' }
}

function credentialSource(source: string, t: Translate): string {
  if (source === 'env') return t('sourceEnv')
  if (source === 'file') return t('sourceFile')
  return source
}

const UPDATE_REASON_KEYS: Record<PluginUpdateUnavailableReason, LocaleKey> = {
  'profile-not-found': 'updateReasonProfileNotFound',
  'not-direct-dependency': 'updateReasonNotDependency',
  'unsupported-install-source': 'updateReasonLocalSource',
  'profile-read-only': 'updateReasonReadOnly',
  'pnpm-unavailable': 'updateReasonPnpm',
  'unsupported-platform': 'updateReasonPlatform',
  'restart-unmanaged': 'updateReasonRestartUnmanaged',
  'restart-address-unavailable': 'updateReasonRestartAddress',
}

function wait(delayMs: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, delayMs) })
}

function LoadedSettings({ controller, t }: SettingsInjected) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot)
  const snapshot = state.snapshot
  const [draft, setDraft] = useState<Draft | undefined>(undefined)
  const [apiKey, setApiKey] = useState('')
  const [draftError, setDraftError] = useState<string | undefined>(undefined)

  useEffect(() => { if (state.status === 'idle') void controller.load() }, [controller, state.status])
  useEffect(() => {
    if (snapshot !== undefined) setDraft(draftOf(snapshot.settings.value))
  }, [snapshot])
  useEffect(() => {
    const restart = state.restart
    if (restart === undefined) return
    let cancelled = false
    void (async () => {
      await wait(restart.retryAfterMs)
      const deadline = Date.now() + 390_000
      let outageSeen = false
      while (!cancelled && Date.now() < deadline) {
        try {
          const current = await apiRequest<SettingsSnapshot>()
          if (current.release.pluginVersion === restart.toVersion) {
            window.location.reload()
            return
          }
          if (outageSeen && current.release.pluginVersion === restart.fromVersion) {
            controller.reportRestartTimeout(t('restartRolledBack'))
            return
          }
        } catch {
          // The expected outage while the replacement process starts.
          outageSeen = true
        }
        await wait(1_000)
      }
      if (!cancelled) controller.reportRestartTimeout(t('restartTimedOut'))
    })()
    return () => { cancelled = true }
  }, [controller, state.restart, t])

  if (state.status === 'idle' || (state.status === 'loading' && snapshot === undefined)) {
    return <div className="dvt-settings"><div className="dvt-loading">{t('testing')}</div></div>
  }
  if (snapshot === undefined || draft === undefined) {
    return <div className="dvt-settings"><div className="dvt-alert error">{state.error ?? t('runtimeUnavailable')}</div><Button variant="outline" onClick={() => { void controller.load() }}>{t('retry')}</Button></div>
  }

  const update = <K extends keyof Draft>(key: K, value: Draft[K]): void => setDraft(current => current === undefined ? current : { ...current, [key]: value })
  const save = (): void => {
    try {
      const keyFailure = apiKeyFailure(apiKey, t)
      if (keyFailure !== undefined) {
        setDraftError(keyFailure)
        return
      }
      const credentialValue = apiKey.length === 0 ? undefined : apiKey.trim()
      setDraftError(undefined)
      void controller.save(
        valueOf(draft, t),
        snapshot.settings.revision,
        credentialValue,
        snapshot.writable,
      ).then(saved => { if (saved) setApiKey('') })
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : String(error))
    }
  }
  const busy = state.action !== undefined
  const credentialMatchesSnapshot = draft.credential.trim() === snapshot.credential.ref
  const builtInCredentialChangedProvider = snapshot.credential.source === 'built-in-free'
    && !isBuiltInFreeVisionDraft(draft)
  const keyLocked = credentialMatchesSnapshot
    && !snapshot.credential.writable
    && !builtInCredentialChangedProvider
  const canSave = snapshot.writable || (apiKey.length > 0 && !keyLocked)
  const runtimeErrorTitle = snapshot.runtime.ready ? t('runtimeCandidateRejected') : t('runtimeUnavailable')
  const pluginUpdate = state.update
  const updateCapability = pluginUpdate ?? snapshot.release.update
  const latestVersion = pluginUpdate?.latestVersion
  const updateReason = updateCapability.reason === undefined ? undefined : t(UPDATE_REASON_KEYS[updateCapability.reason])
  const updateCheckSupported = updateCapability.checkSupported ?? updateCapability.supported
  const updateHasUnsavedChanges = apiKey.length > 0 || settingsDraftChanged(draft, snapshot.settings.value, t)
  const applyUpdate = (): void => {
    if (latestVersion === undefined) return
    if (!window.confirm(t('updateConfirm', { version: latestVersion }))) return
    void controller.applyUpdate(latestVersion)
  }

  return (
    <div className="dvt-settings">
      <div className="dvt-alert notice">{t('externalNotice')}</div>
      {!snapshot.writable ? <div className="dvt-alert warning">{t('readOnly')}</div> : null}
      {draftError === undefined ? null : <div className="dvt-alert error">{draftError}</div>}
      {state.error === undefined ? null : <div className="dvt-alert error">{state.error}</div>}
      {state.message === 'saved' ? <div className="dvt-alert success">{t('saved')}</div> : null}
      {state.message === 'restarting' && state.restart !== undefined ? <div className="dvt-alert success">{t('restarting', { version: state.restart.toVersion })}</div> : null}
      {snapshot.runtime.lastError === undefined ? null : <div className="dvt-alert error"><strong>{runtimeErrorTitle}</strong><span>{snapshot.runtime.lastError}</span></div>}

      <section className="dvt-panel dvt-essential"><div className="dvt-panel-title"><div><h3>{t('provider')}</h3><p>{t('providerHint')}</p></div><span className={`dvt-badge ${snapshot.credential.configured ? 'ok' : 'error'}`}>{snapshot.credential.configured ? t('configured') : t('missing')}</span></div>
        <div className="dvt-form-grid">
          <Field label={t('protocol')}><select disabled={!snapshot.writable || busy} value={draft.protocol} onChange={(event) => { update('protocol', event.target.value as 'openai' | 'anthropic') }}><option value="openai">OpenAI Chat Completions</option><option value="anthropic">Anthropic Messages</option></select></Field>
          <Field label={t('baseUrl')}><Input disabled={!snapshot.writable || busy} value={draft.baseUrl} onChange={(event) => { update('baseUrl', event.target.value) }} /></Field>
          <Field label={t('model')}><Input disabled={!snapshot.writable || busy} value={draft.model} onChange={(event) => { update('model', event.target.value) }} /></Field>
          <Field label={t('apiKey')} hint={keyLocked ? t('apiKeyLocked') : snapshot.credential.source === undefined ? t('apiKeyHint') : `${t('apiKeyHint')} ${t('sourceHint', { source: t('source'), value: credentialSource(snapshot.credential.source, t) })}`}><Input aria-label={t('apiKey')} type="password" autoComplete="new-password" disabled={busy || keyLocked} placeholder={snapshot.credential.configured ? t('apiKeyPlaceholderConfigured') : t('apiKeyPlaceholderMissing')} value={apiKey} onChange={(event) => { setApiKey(event.target.value); setDraftError(undefined) }} /></Field>
        </div>
      </section>

      <div className="dvt-save-row"><Button variant="primary" disabled={!canSave || busy} onClick={save}>{state.action === 'save' ? t('saving') : t('save')}</Button><Button variant="outline" disabled={busy} onClick={() => { void controller.load() }}>{t('reload')}</Button></div>

      <section className="dvt-panel"><div className="dvt-panel-title"><div><h3>{t('health')}</h3><p>{t('connectionHint')}</p></div><div className="dvt-actions"><Button size="sm" variant="outline" disabled={busy || !snapshot.runtime.ready} onClick={() => { void controller.runHealth('health') }}>{state.action === 'health' ? t('testing') : t('runHealth')}</Button><Button size="sm" variant="outline" disabled={busy || !snapshot.runtime.ready} onClick={() => { void controller.runHealth('connection') }}>{state.action === 'connection' ? t('testing') : t('testConnection')}</Button><Button size="sm" variant="primary" disabled={busy || !snapshot.runtime.ready} onClick={() => { void controller.runHealth('model') }}>{state.action === 'model' ? t('testingModel') : t('testModel')}</Button></div></div>
        <p className="dvt-muted">{t('saveBeforeTesting')}</p>
        {state.health === undefined ? <p className="dvt-muted">{t('notTested')}</p> : <div className="dvt-health-grid">{Object.entries(state.health.checks).map(([name, check]) => {
          const testTag = name === 'model' ? modelTestTag(state.health as HealthResult, check) : undefined
          return <div key={name} data-status={check.status}><span>{t(HEALTH_NAME_KEYS[name] ?? 'health')}</span>{testTag === undefined ? null : <em className="dvt-health-test-tag" data-status={testTag.status}>{t(testTag.label)}</em>}<strong>{t(HEALTH_STATUS_KEYS[check.status])}</strong><p>{healthDetail(name, check.detail, t)}</p></div>
        })}</div>}
      </section>

      <section className="dvt-panel dvt-update-panel">
        <div className="dvt-panel-title">
          <div><h3>{t('updates')}</h3><p>{t('updatesHint')}</p></div>
          <span className={`dvt-badge ${pluginUpdate?.updateAvailable ? 'warning' : pluginUpdate !== undefined && pluginUpdate.supported ? 'ok' : ''}`}>
            {pluginUpdate?.updateAvailable ? t('updateAvailable') : pluginUpdate !== undefined && pluginUpdate.supported ? t('upToDate') : t('pluginVersion')}
          </span>
        </div>
        <div className="dvt-update-grid">
          <div><span>{t('updateInstalled')}</span><strong>{snapshot.release.pluginVersion}</strong></div>
          <div><span>{t('updateLatest')}</span><strong>{latestVersion ?? '—'}</strong></div>
          <div><span>{t('updateProfile')}</span><strong>{updateCapability.profile ?? '—'}</strong></div>
        </div>
        {!updateCapability.supported ? <div className="dvt-alert warning"><strong>{t('updateUnsupported')}</strong><span>{updateReason}</span></div> : null}
        {updateCapability.supported && updateHasUnsavedChanges ? <div className="dvt-alert warning">{t('updateSaveFirst')}</div> : null}
        {pluginUpdate?.supported && pluginUpdate.updateAvailable && latestVersion !== undefined ? <p className="dvt-muted">{t('updateAvailableDetail', { version: latestVersion })}</p> : null}
        {pluginUpdate?.supported && !pluginUpdate.updateAvailable && latestVersion !== undefined ? <p className="dvt-muted">{t('upToDateDetail', { version: latestVersion })}</p> : null}
        <div className="dvt-actions">
          <Button variant="outline" disabled={busy || !updateCheckSupported || state.restart !== undefined} onClick={() => { void controller.checkUpdate() }}>{state.action === 'check-update' ? t('checkingUpdate') : t('checkUpdate')}</Button>
          {pluginUpdate?.supported && pluginUpdate.updateAvailable && latestVersion !== undefined ? <Button variant="primary" disabled={busy || state.restart !== undefined || updateHasUnsavedChanges} onClick={applyUpdate}>{state.action === 'apply-update' ? t('updatingPlugin') : t('updateNow')}</Button> : null}
        </div>
      </section>

      <details className="dvt-advanced">
        <summary><span><strong>{t('advanced')}</strong><small>{t('advancedHint')}</small></span><span className="dvt-details-chevron" aria-hidden="true">⌄</span></summary>
        <div className="dvt-advanced-body">
          <section className="dvt-panel"><div className="dvt-panel-title"><h3>{t('provider')}</h3></div><div className="dvt-form-grid">
            <Field label={t('credential')} hint={t('credentialHint')}><Input aria-label={t('credential')} disabled={!snapshot.writable || busy} value={draft.credential} onChange={(event) => { update('credential', event.target.value) }} /></Field>
            {draft.protocol === 'anthropic' ? <Field label={t('anthropicThinking')} hint={t('anthropicThinkingHint')}><select aria-label={t('anthropicThinking')} value={draft.anthropicThinking} onChange={(event) => { update('anthropicThinking', event.target.value as 'omit' | 'disabled' | 'adaptive') }}><option value="omit">omit (widest compatibility)</option><option value="disabled">disabled (model support required)</option><option value="adaptive">adaptive (model support required)</option></select></Field> : null}
            <Field label={t('userAgent')}><Input value={draft.userAgent} onChange={(event) => { update('userAgent', event.target.value) }} /></Field>
          </div></section>

          <section className="dvt-panel"><div className="dvt-panel-title"><h3>{t('limits')}</h3></div><div className="dvt-form-grid">
            <Field label={t('language')}><select value={draft.language} onChange={(event) => { update('language', event.target.value as 'zh' | 'en') }}><option value="zh">中文</option><option value="en">English</option></select></Field>
            <Field label={t('timeout')}><Input inputMode="numeric" value={draft.timeoutMs} onChange={(event) => { update('timeoutMs', event.target.value) }} /></Field>
            <Field label={t('maxBytes')}><Input inputMode="numeric" value={draft.maxImageBytes} onChange={(event) => { update('maxImageBytes', event.target.value) }} /></Field>
            <Field label={t('maxPixels')}><Input inputMode="numeric" value={draft.maxImagePixels} onChange={(event) => { update('maxImagePixels', event.target.value) }} /></Field>
            <Field label={t('concurrency')}><Input inputMode="numeric" value={draft.concurrency} onChange={(event) => { update('concurrency', event.target.value) }} /></Field>
          </div></section>

          <section className="dvt-panel"><div className="dvt-panel-title"><h3>{t('runtime')}</h3><span className={`dvt-badge ${snapshot.runtime.ready ? 'ok' : 'error'}`}>{snapshot.runtime.ready ? snapshot.runtime.upstream?.source === 'managed' ? t('runtimeManaged') : snapshot.runtime.upstream?.source === 'external' ? t('runtimeExternal') : t('runtimeReady') : t('runtimeUnavailable')}</span></div><div className="dvt-form-grid">
            <Field label={t('runtimeMode')}><select value={draft.runtimeMode} onChange={(event) => { update('runtimeMode', event.target.value as 'managed' | 'external') }}><option value="managed">{t('runtimeManaged')}</option><option value="external">{t('runtimeExternal')}</option></select></Field>
            {draft.runtimeMode === 'external' ? <Field label={t('toolkitPath')}><Input value={draft.toolkitPath} onChange={(event) => { update('toolkitPath', event.target.value) }} /></Field> : null}
            <Field label={t('python')}><Input placeholder="python3" value={draft.python} onChange={(event) => { update('python', event.target.value) }} /></Field>
            <Field label={t('allowedDirs')} hint={t('allowedDirsHint')}><textarea rows={3} value={draft.allowedDirs} onChange={(event) => { update('allowedDirs', event.target.value) }} /></Field>
          </div>
          {snapshot.runtime.upstream === undefined ? null : <div className="dvt-runtime-facts"><code>{snapshot.runtime.upstream.path}</code><code>{snapshot.runtime.upstream.python} · {snapshot.runtime.upstream.pythonVersion}</code><code>{snapshot.runtime.upstream.runtimeHome}</code></div>}
          </section>

        </div>
      </details>

      <footer className="dvt-settings-footer">
        <div><span className="dvt-kicker">{t('pluginKind')}</span><h2>{t('settingsTitle')}</h2><p>{t('settingsIntro')}</p></div>
        <div className="dvt-release"><span>{t('pluginVersion')} <strong>{snapshot.release.pluginVersion}</strong></span><span>{t('upstreamVersion')} <strong>{snapshot.release.upstreamVersion}</strong></span><span>{t('activeGeneration')} <strong>{t('activeGenerationValue', { generation: snapshot.runtime.generation })}</strong></span></div>
      </footer>
    </div>
  )
}

const CSS = `
.dvt-tool{margin:4px 0;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;box-shadow:var(--dsw-shadow-lv1)}
.dvt-tool-head{width:100%;min-height:38px;display:flex;align-items:center;gap:7px;padding:8px 10px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}.dvt-tool-head:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dvt-tool-icon{width:20px;height:20px;display:grid;place-items:center;border-radius:6px;color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);flex:none}.dvt-tool-title{font-size:12px;font-weight:650;white-space:nowrap}.dvt-tool-sep{opacity:.35}.dvt-tool-summary{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-secondary)}.dvt-tool-status{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvt-tool[data-state=error] .dvt-tool-status{color:var(--dsw-alias-state-error-primary)}.dvt-chevron{margin-left:auto;transition:transform .16s ease;opacity:.55}.dvt-chevron[data-open=true]{transform:rotate(180deg)}.dvt-tool-body{padding:0 10px 10px}.dvt-stack{display:grid;gap:10px}.dvt-muted{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
.dvt-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.dvt-metrics>div,.dvt-diff-score{padding:10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);display:grid;gap:4px}.dvt-metrics span,.dvt-diff-score span{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--dsw-alias-label-secondary)}.dvt-metrics strong,.dvt-diff-score strong{font-size:13px}.dvt-list{list-style:none;margin:0;padding:0;display:grid;gap:4px;max-height:160px;overflow:auto}.dvt-list li{display:flex;justify-content:space-between;gap:12px;padding:6px 8px;border-radius:7px;background:var(--dsw-alias-bg-layer-2);font-size:11px}.dvt-list code{color:var(--dsw-alias-state-business-primary)}.dvt-table-wrap{max-height:220px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:9px}.dvt-table{width:100%;border-collapse:collapse;font-size:11px}.dvt-table th,.dvt-table td{padding:7px 8px;text-align:left;border-bottom:1px solid var(--dsw-alias-border-l1)}.dvt-table th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-2);font-size:10px;text-transform:uppercase;letter-spacing:.05em}.dvt-table tr:last-child td{border-bottom:0}
.dvt-artifact{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}.dvt-preview{display:block;width:100%;max-height:360px;object-fit:contain;background:repeating-conic-gradient(var(--dsw-alias-bg-module-platform) 0 25%,var(--dsw-alias-bg-layer-1) 0 50%) 50%/18px 18px;border:0}.dvt-svg{height:280px}.dvt-artifact-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 10px}.dvt-artifact-meta>div:first-child{min-width:0;display:grid;gap:2px}.dvt-artifact-meta strong{font-size:12px;overflow:hidden;text-overflow:ellipsis}.dvt-artifact-meta span,.dvt-artifact-meta small{font-size:10px;color:var(--dsw-alias-label-secondary)}.dvt-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.dvt-download{display:inline-flex;align-items:center;height:28px;padding:0 12px;border-radius:999px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);text-decoration:none;font-size:12px;font-weight:600}.dvt-download:hover{background:var(--dsw-alias-button-primary-hover)}.dvt-download:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.dvt-artifact>.dvt-muted{padding:0 10px 10px}.dvt-diff-score>div{height:5px;border-radius:99px;background:var(--dsw-alias-border-l2);overflow:hidden}.dvt-diff-score i{display:block;height:100%;min-width:2px;background:linear-gradient(90deg,var(--dsw-alias-state-warn-primary),var(--dsw-alias-state-error-primary));border-radius:99px}.dvt-tool h4{font-size:11px;margin:0 0 6px}.dvt-palette{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:7px}.dvt-palette>div{display:flex;align-items:center;gap:8px;padding:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px}.dvt-palette i{width:28px;height:28px;border-radius:7px;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}.dvt-palette span{display:grid}.dvt-palette strong{font-size:11px}.dvt-palette small{font-size:10px;color:var(--dsw-alias-label-secondary)}
.dvt-settings{display:grid;gap:14px;max-width:900px;padding:8px 2px 32px;color:var(--dsw-alias-label-primary)}.dvt-settings-footer{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding:8px 2px}.dvt-settings-footer h2{font-size:25px;letter-spacing:-.025em;margin:3px 0 6px}.dvt-settings-footer p{max-width:620px;margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.55}.dvt-kicker{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--dsw-alias-state-business-primary);font-weight:700}.dvt-release{display:grid;gap:4px;min-width:170px;padding:9px 11px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);font-size:10px;color:var(--dsw-alias-label-secondary)}.dvt-release span{display:flex;justify-content:space-between;gap:12px}.dvt-release strong{color:var(--dsw-alias-label-primary)}.dvt-alert{padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.5;display:grid;gap:3px}.dvt-alert.notice{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary)}.dvt-alert.warning{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-label)}.dvt-alert.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}.dvt-alert.success{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}.dvt-panel{display:grid;gap:12px;padding:15px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv1)}.dvt-panel-title{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dvt-panel-title h3{font-size:14px;margin:0}.dvt-panel-title p{font-size:11px;line-height:1.45;color:var(--dsw-alias-label-secondary);margin:4px 0 0;max-width:620px}.dvt-badge{font-size:10px;padding:3px 7px;border-radius:999px;font-weight:650}.dvt-badge.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary)}.dvt-badge.warning{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-label)}.dvt-badge.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}.dvt-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.dvt-field{display:grid;gap:6px;align-content:start}.dvt-field>span{font-size:11px;font-weight:600}.dvt-field>small{font-size:10px;color:var(--dsw-alias-label-secondary);line-height:1.4}.dvt-field select,.dvt-field textarea{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:8px 10px}.dvt-field select{height:36px}.dvt-field textarea{resize:vertical;min-height:76px}.dvt-runtime-facts{display:grid;gap:4px;padding:9px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);overflow:auto}.dvt-runtime-facts code{font-size:10px;white-space:nowrap;color:var(--dsw-alias-label-secondary)}.dvt-save-row{display:flex;gap:8px;padding:2px 0}.dvt-update-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.dvt-update-grid>div{display:grid;gap:3px;padding:9px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2)}.dvt-update-grid span{font-size:9px;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-label-caption)}.dvt-update-grid strong{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dvt-settings-footer{margin-top:8px;padding:20px 2px 4px;border-top:1px solid var(--dsw-alias-border-l1);opacity:.82}.dvt-settings-footer h2{font-size:18px;letter-spacing:-.015em;margin:3px 0 5px}.dvt-settings-footer p{font-size:11px;line-height:1.5}.dvt-release{min-width:220px}.dvt-release span{white-space:nowrap}.dvt-essential{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 30%,var(--dsw-alias-border-l1));box-shadow:var(--dsw-shadow-lv1),0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 5%,transparent)}.dvt-advanced{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}.dvt-advanced>summary{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 15px;cursor:pointer;list-style:none}.dvt-advanced>summary::-webkit-details-marker{display:none}.dvt-advanced>summary>span:first-child{display:grid;gap:3px}.dvt-advanced>summary strong{font-size:13px}.dvt-advanced>summary small{font-size:10px;line-height:1.45;color:var(--dsw-alias-label-secondary);font-weight:400}.dvt-details-chevron{font-size:15px;opacity:.55;transition:transform .16s ease}.dvt-advanced[open] .dvt-details-chevron{transform:rotate(180deg)}.dvt-advanced-body{display:grid;gap:12px;padding:0 12px 12px}.dvt-advanced-body>.dvt-panel{box-shadow:none}
.dvt-health-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.dvt-health-grid>div{padding:9px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border-left:3px solid var(--dsw-alias-border-l4)}.dvt-health-grid>div[data-status=ok]{border-left-color:var(--dsw-alias-state-success-primary)}.dvt-health-grid>div[data-status=warning],.dvt-health-grid>div[data-status=not_tested]{border-left-color:var(--dsw-alias-state-warn-primary)}.dvt-health-grid>div[data-status=error]{border-left-color:var(--dsw-alias-state-error-primary)}.dvt-health-grid span{font-size:10px;text-transform:capitalize}.dvt-health-grid strong{float:right;font-size:9px;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}.dvt-health-test-tag{display:inline-flex;margin-left:6px;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);font-size:9px;font-style:normal;font-weight:600;color:var(--dsw-alias-label-secondary)}.dvt-health-test-tag[data-status=ok]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary)}.dvt-health-test-tag[data-status=warning]{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-label)}.dvt-health-test-tag[data-status=error]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}.dvt-health-grid p{clear:both;margin:5px 0 0;font-size:10px;line-height:1.4;color:var(--dsw-alias-label-secondary)}.dvt-loading{padding:24px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);font-size:12px;color:var(--dsw-alias-label-secondary)}
.dvt-paste-dock{box-sizing:border-box;width:calc(100% - 32px);max-width:var(--dsh-composer-card-max-width,960px);margin:0 auto;display:flex;flex-wrap:wrap;gap:6px;padding:0 2px 6px}.dvt-paste-chip{max-width:100%;height:32px;box-sizing:border-box;display:flex;align-items:center;gap:7px;padding:0 6px 0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-specific-tip);font-size:12px}.dvt-paste-chip[data-status=copying]{border-color:var(--dsw-alias-state-business-primary)}.dvt-paste-chip[data-status=error]{border-color:var(--dsw-alias-state-error-primary)}.dvt-paste-name{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvt-paste-detail{color:var(--dsw-alias-label-caption);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvt-paste-chip[data-status=error] .dvt-paste-detail{color:var(--dsw-alias-state-error-primary)}.dvt-paste-chip button{width:20px;height:20px;display:grid;place-items:center;border:0;border-radius:50%;padding:0;background:transparent;color:var(--dsw-alias-label-caption);font:inherit;font-size:16px;cursor:pointer}.dvt-paste-chip button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dvt-paste-chip button:disabled{opacity:.4;cursor:default}
@media(max-width:720px){.dvt-settings-footer{display:grid}.dvt-release{width:auto}.dvt-form-grid,.dvt-update-grid{grid-template-columns:1fr}.dvt-metrics{grid-template-columns:1fr}.dvt-artifact-meta{align-items:flex-start;flex-direction:column}.dvt-panel-title{flex-direction:column}}
`

function installStyles(): () => void {
  const id = '@anionex/dsh-vision-toolkit/client'
  const existing = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${id}"]`)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.plugin = '@anionex/dsh-vision-toolkit'
  style.dataset.pluginCss = id
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}

/** Required client services. The pasted-image codec attaches to either trigger-service generation after load. */
export const inject = ['slots', 'locale', 'remote', 'conversation', 'sessions']

/** Register dedicated Tool views and the Vision Settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(installStyles, 'dsh-vision-toolkit: styles')
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-vision-toolkit: locale')
  installPasteImages(ctx)
  const t = ctx.locale.bind(NS)
  const injected = () => ({ t })
  const entries: Array<[string, (props: ViewProps) => ReactNode]> = [
    ['vision_ground', GroundView],
    ['vision_detect', DetectView],
    ['vision_trace', TraceView],
    ['vision_pixel_diff', PixelDiffView],
    ['vision_crop', ArtifactView],
    ['vision_long_screenshot_ocr', ArtifactView],
    ['vision_extract_foreground', ArtifactView],
    ['vision_html_screenshot', ArtifactView],
    ['vision_dominant_colors', PaletteView],
  ]
  ctx.slots.inject('tool.call.toolview', function* () {
    for (const [key, component] of entries) {
      yield ctx.slots.register({ name: 'tool.call.toolview', key, inject: injected }, component)
    }
  })

  const controller = new VisionSettingsController()
  ctx.effect(() => {
    const refreshSettings = (namespace: string): void => {
      if (namespace === 'vision-toolkit') controller.refreshIfLoaded()
    }
    const refreshCredential = (ref: string): void => {
      const current = controller.snapshot().snapshot
      if (current?.credential.ref === ref) controller.refreshIfLoaded()
    }
    const legacyRemote = ctx.remote as typeof ctx.remote & {
      $on?: (event: string, listener: (value: string) => void) => () => void
    }
    const currentEvents = ctx as unknown as {
      on(event: 'settings/changed', listener: (namespace: string) => void): () => void
      on(event: 'credentials/changed', listener: (ref: string) => void): () => void
    }
    const disposers = typeof legacyRemote.$on === 'function'
      ? [
        legacyRemote.$on('settings/document-updated', refreshSettings),
        legacyRemote.$on('credentials/updated', refreshCredential),
      ]
      : [
        currentEvents.on('settings/changed', (namespace) => {
          refreshSettings(namespace)
        }),
        currentEvents.on('credentials/changed', (ref) => {
          refreshCredential(ref)
        }),
      ]
    disposers.push(ctx.on('connection/reset', () => { controller.refreshIfLoaded() }))
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-vision-toolkit: Settings invalidations')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'vision-toolkit',
    order: 30,
    label: () => t('nav'),
    inject: () => ({ controller, t }),
  }, SettingsSection))
}
