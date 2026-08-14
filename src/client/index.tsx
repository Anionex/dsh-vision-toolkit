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
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slash/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { installPasteImages } from './paste-images.tsx'

const NS = 'vision-toolkit'
const SETTINGS_ROUTE = '/_dsh/vision-toolkit/settings'
const PRESENTATION_META_KEY = '$dshVisionToolkit'
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const en = {
  nav: 'Vision',
  settingsTitle: 'Vision Toolkit',
  settingsIntro: 'Configure the pinned visual engineering runtime, its external vision endpoint, and local safety limits.',
  externalNotice: 'Remote tools send the selected image bytes to the configured external vision API. Local crop, trace, pixel diff, palette, foreground extraction, and HTML rendering do not upload images.',
  provider: 'Vision service',
  baseUrl: 'Base URL',
  credential: 'Credential reference',
  model: 'Model',
  protocol: 'API protocol',
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
  readOnly: 'The active Settings provider is read-only.',
  configured: 'Configured',
  missing: 'Missing',
  source: 'Source',
  health: 'Health',
  runHealth: 'Run health check',
  testConnection: 'Test connection',
  testing: 'Checking…',
  connectionHint: 'Connection testing explicitly sends the configured credential to GET /models. It uploads no image and creates no completion.',
  pluginVersion: 'Plugin',
  upstreamVersion: 'Upstream',
  activeGeneration: 'Runtime generation',
  runtimeUnavailable: 'Runtime unavailable',
  runtimeCandidateRejected: 'Last runtime candidate was rejected; the active generation remains available.',
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
} as const

type LocaleKey = keyof typeof en

const zh: Record<LocaleKey, string> = {
  nav: '视觉工具',
  settingsTitle: 'Vision Toolkit',
  settingsIntro: '配置固定版本的视觉工程运行时、外部视觉服务与本地安全限制。',
  externalNotice: '远程工具会把选中的图片字节发送到已配置的外部视觉 API。本地裁剪、几何恢复、像素对比、调色板、前景提取和 HTML 渲染不会上传图片。',
  provider: '视觉服务',
  baseUrl: '服务地址',
  credential: 'Credential 引用',
  model: '模型',
  protocol: 'API 协议',
  userAgent: 'User-Agent',
  language: '输出语言',
  limits: '限制',
  timeout: '请求超时（毫秒）',
  maxBytes: '最大图片字节数',
  maxPixels: '最大图片像素数',
  concurrency: '每个 Session 并发数',
  runtime: '运行时',
  runtimeMode: '运行模式',
  toolkitPath: '固定上游 checkout 路径',
  python: 'Python 覆盖',
  allowedDirs: '额外允许目录',
  allowedDirsHint: '每行一个路径；Session 工作区始终允许。',
  save: '保存并应用',
  saving: '正在验证运行时…',
  reload: '重新加载',
  saved: '设置已验证并生效。',
  readOnly: '当前 Settings 提供方为只读。',
  configured: '已配置',
  missing: '缺失',
  source: '来源',
  health: '健康检查',
  runHealth: '运行健康检查',
  testConnection: '测试连接',
  testing: '检查中…',
  connectionHint: '连接测试会显式把已配置 Credential 发送到 GET /models；不会上传图片，也不会创建 completion。',
  pluginVersion: '插件',
  upstreamVersion: '上游',
  activeGeneration: '运行时世代',
  runtimeUnavailable: '运行时不可用',
  runtimeCandidateRejected: '最近的运行时候选已被拒绝；当前世代仍可用。',
  retry: '重试',
  open: '打开文件',
  download: '下载',
  previewUnavailable: '当前宿主不提供 HTTP 预览，请使用“打开文件”。',
  running: '运行中…',
  failed: '失败',
  matches: '个匹配',
  elements: '个元素',
  dimensions: '尺寸',
  coordinates: '坐标',
  artifact: '交付文件',
  artifacts: '交付文件',
  difference: '总体差异',
  worstRegions: '差异最大区域',
  colors: '主色',
  noResult: '结构化结果不可用，请检查原始 Tool 结果。',
  healthy: '健康',
  degraded: '需要处理',
  notTested: '未测试',
}

type Translate = (key: LocaleKey) => string

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
}

interface SettingsValue {
  provider?: { baseUrl?: string; credential?: string; model?: string; protocol?: 'openai' | 'anthropic'; userAgent?: string }
  language?: 'zh' | 'en'
  timeoutMs?: number
  maxImageBytes?: number
  maxImagePixels?: number
  concurrency?: number
  runtime?: { mode?: 'managed' | 'external'; agentVisionToolkitPath?: string; python?: string }
  allowedDirs?: string[]
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
  return (
    <article className="dvt-artifact">
      {canPreview
        ? artifact.kind === 'svg'
          ? <iframe className="dvt-preview dvt-svg" sandbox="" src={grant.previewUrl} title={artifact.description} />
          : <img className="dvt-preview" src={grant.previewUrl} alt={artifact.description} loading="lazy" />
        : null}
      <div className="dvt-artifact-meta">
        <div>
          <strong>{artifact.filename}</strong>
          <span>{artifact.description}</span>
          <small>{artifact.mimeType} · {formatBytes(artifact.bytes)}</small>
        </div>
        <ArtifactActions artifact={artifact} grant={grant} openFile={openFile} t={t} />
      </div>
      {!canPreview && grant === undefined ? <p className="dvt-muted">{t('previewUnavailable')}</p> : null}
    </article>
  )
}

type ViewProps = ToolCallViewProps & { t?: Translate }

function GroundView({ block, openFile, t = key => en[key] }: ViewProps) {
  const value = decodeVisionResult(block)
  const matches = Array.isArray(value?.matches) ? value.matches.filter(isRecord) : []
  const target = stringOf(value?.target) ?? 'Ground'
  const width = numberOf(value?.imageWidth)
  const height = numberOf(value?.imageHeight)
  const preview = artifactFrom(value?.preview)
  const grants = accessMap(value)
  return (
    <ToolShell block={block} title="Ground" summary={matches.length > 0 ? `${target} · ${matches.length} ${t('matches')}` : target} icon={<VisionIcon kind="target" />} t={t}>
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
    <ToolShell block={block} title="Detect" summary={`${elements.length} ${t('elements')}`} icon={<VisionIcon kind="layers" />} t={t}>
      {value === undefined ? <p className="dvt-muted">{t('noResult')}</p> : (
        <div className="dvt-stack">
          <div className="dvt-metrics">
            <div><span>{t('dimensions')}</span><strong>{width ?? '—'} × {height ?? '—'}</strong></div>
            <div><span>{t('elements')}</span><strong>{elements.length}</strong></div>
          </div>
          <div className="dvt-table-wrap"><table className="dvt-table"><thead><tr><th>#</th><th>Label</th><th>{t('coordinates')}</th></tr></thead><tbody>
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
  const summary = geometry === undefined ? undefined : `${numberOf(geometry.pathCount) ?? 0} paths · ${formatBytes(numberOf(geometry.bytes) ?? 0)}`
  const grants = accessMap(value)
  return (
    <ToolShell block={block} title="Trace SVG" summary={summary} icon={<VisionIcon kind="shape" />} t={t}>
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
    <ToolShell block={block} title="Pixel Diff" summary={pct === undefined ? undefined : `${pct.toFixed(3)}%`} icon={<VisionIcon kind="diff" />} t={t}>
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
  const title = toolName === 'vision_crop' ? 'Crop'
    : toolName === 'vision_long_screenshot_ocr' ? 'Long OCR'
      : toolName === 'vision_extract_foreground' ? 'Extract Foreground'
        : toolName === 'vision_html_screenshot' ? 'HTML Screenshot'
          : 'Vision Artifact'
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
    <ToolShell block={block} title="Dominant Colors" summary={`${colors.length} ${t('colors')}`} icon={<VisionIcon kind="palette" />} t={t}>
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
  action?: 'save' | 'health' | 'connection' | undefined
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
      this.set({ status: 'ready', snapshot, health: this.state.health })
    } catch (error) {
      if (generation !== this.generation) return
      this.set({ ...this.state, status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  refreshIfLoaded(): void {
    if (this.state.status === 'idle' || this.state.action === 'save') return
    void this.load()
  }

  async save(value: SettingsValue, expectedRevision: number): Promise<void> {
    this.set({ ...this.state, action: 'save', error: undefined, message: undefined })
    try {
      const snapshot = await apiRequest<SettingsSnapshot>({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', expectedRevision, value }),
      })
      this.set({ status: 'ready', snapshot, health: this.state.health, message: 'saved' })
    } catch (error) {
      this.set({ ...this.state, action: undefined, error: error instanceof Error ? error.message : String(error) })
    }
  }

  async runHealth(testConnection: boolean): Promise<void> {
    this.set({ ...this.state, action: testConnection ? 'connection' : 'health', error: undefined, message: undefined })
    try {
      const health = await apiRequest<HealthResult>({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'health', testConnection }),
      })
      this.set({ ...this.state, action: undefined, health })
    } catch (error) {
      this.set({ ...this.state, action: undefined, error: error instanceof Error ? error.message : String(error) })
    }
  }
}

interface Draft {
  baseUrl: string
  credential: string
  model: string
  protocol: 'openai' | 'anthropic'
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
    baseUrl: value.provider?.baseUrl ?? 'https://api.inferera.com/v1',
    credential: value.provider?.credential ?? 'VISION_API_KEY',
    model: value.provider?.model ?? 'gemini-3.6-flash',
    protocol: value.provider?.protocol ?? 'openai',
    userAgent: value.provider?.userAgent ?? DEFAULT_USER_AGENT,
    language: value.language ?? 'zh',
    timeoutMs: String(value.timeoutMs ?? 60000),
    maxImageBytes: String(value.maxImageBytes ?? 10485760),
    maxImagePixels: String(value.maxImagePixels ?? 40000000),
    concurrency: String(value.concurrency ?? 4),
    runtimeMode: value.runtime?.mode ?? 'managed',
    toolkitPath: value.runtime?.agentVisionToolkitPath ?? '',
    python: value.runtime?.python ?? '',
    allowedDirs: (value.allowedDirs ?? []).join('\n'),
  }
}

function positiveInteger(raw: string, label: string): number {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`)
  return value
}

function valueOf(draft: Draft): SettingsValue {
  return {
    provider: {
      baseUrl: draft.baseUrl.trim(),
      credential: draft.credential.trim(),
      model: draft.model.trim(),
      protocol: draft.protocol,
      userAgent: draft.userAgent.trim(),
    },
    language: draft.language,
    timeoutMs: positiveInteger(draft.timeoutMs, 'timeoutMs'),
    maxImageBytes: positiveInteger(draft.maxImageBytes, 'maxImageBytes'),
    maxImagePixels: positiveInteger(draft.maxImagePixels, 'maxImagePixels'),
    concurrency: positiveInteger(draft.concurrency, 'concurrency'),
    runtime: {
      mode: draft.runtimeMode,
      ...(draft.runtimeMode === 'external' ? { agentVisionToolkitPath: draft.toolkitPath.trim() } : {}),
      ...(draft.python.trim().length === 0 ? {} : { python: draft.python.trim() }),
    },
    allowedDirs: draft.allowedDirs.split(/\r?\n/).map(entry => entry.trim()).filter(Boolean),
  }
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

function LoadedSettings({ controller, t }: SettingsInjected) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot)
  const snapshot = state.snapshot
  const [draft, setDraft] = useState<Draft | undefined>(undefined)
  const [draftError, setDraftError] = useState<string | undefined>(undefined)

  useEffect(() => { if (state.status === 'idle') void controller.load() }, [controller, state.status])
  useEffect(() => {
    if (snapshot !== undefined) setDraft(draftOf(snapshot.settings.value))
  }, [snapshot])

  if (state.status === 'idle' || (state.status === 'loading' && snapshot === undefined)) {
    return <div className="dvt-settings"><div className="dvt-loading">{t('testing')}</div></div>
  }
  if (snapshot === undefined || draft === undefined) {
    return <div className="dvt-settings"><div className="dvt-alert error">{state.error ?? t('runtimeUnavailable')}</div><Button variant="outline" onClick={() => { void controller.load() }}>{t('retry')}</Button></div>
  }

  const update = <K extends keyof Draft>(key: K, value: Draft[K]): void => setDraft(current => current === undefined ? current : { ...current, [key]: value })
  const save = (): void => {
    try {
      setDraftError(undefined)
      void controller.save(valueOf(draft), snapshot.settings.revision)
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : String(error))
    }
  }
  const busy = state.action !== undefined
  const runtimeErrorTitle = snapshot.runtime.ready ? t('runtimeCandidateRejected') : t('runtimeUnavailable')

  return (
    <div className="dvt-settings">
      <header className="dvt-settings-header">
        <div><span className="dvt-kicker">DSH native plugin</span><h2>{t('settingsTitle')}</h2><p>{t('settingsIntro')}</p></div>
        <div className="dvt-release"><span>{t('pluginVersion')} <strong>{snapshot.release.pluginVersion}</strong></span><span>{t('upstreamVersion')} <strong>{snapshot.release.upstreamVersion}</strong></span><span>{t('activeGeneration')} <strong>{snapshot.runtime.generation}</strong></span></div>
      </header>
      <div className="dvt-alert notice">{t('externalNotice')}</div>
      {!snapshot.writable ? <div className="dvt-alert warning">{t('readOnly')}</div> : null}
      {draftError === undefined ? null : <div className="dvt-alert error">{draftError}</div>}
      {state.error === undefined ? null : <div className="dvt-alert error">{state.error}</div>}
      {state.message === 'saved' ? <div className="dvt-alert success">{t('saved')}</div> : null}
      {snapshot.runtime.lastError === undefined ? null : <div className="dvt-alert error"><strong>{runtimeErrorTitle}</strong><span>{snapshot.runtime.lastError}</span></div>}

      <section className="dvt-panel"><div className="dvt-panel-title"><h3>{t('provider')}</h3><span className={`dvt-badge ${snapshot.credential.configured ? 'ok' : 'error'}`}>{snapshot.credential.configured ? t('configured') : t('missing')}</span></div>
        <div className="dvt-form-grid">
          <Field label={t('baseUrl')}><Input value={draft.baseUrl} onChange={(event) => { update('baseUrl', event.target.value) }} /></Field>
          <Field label={t('model')}><Input value={draft.model} onChange={(event) => { update('model', event.target.value) }} /></Field>
          <Field label={t('protocol')}><select value={draft.protocol} onChange={(event) => { update('protocol', event.target.value as 'openai' | 'anthropic') }}><option value="openai">OpenAI Chat Completions</option><option value="anthropic">Anthropic Messages</option></select></Field>
          <Field label={t('userAgent')}><Input value={draft.userAgent} onChange={(event) => { update('userAgent', event.target.value) }} /></Field>
          <Field label={t('credential')} hint={snapshot.credential.source === undefined ? undefined : `${t('source')}: ${snapshot.credential.source}`}><Input value={draft.credential} onChange={(event) => { update('credential', event.target.value) }} /></Field>
          <Field label={t('language')}><select value={draft.language} onChange={(event) => { update('language', event.target.value as 'zh' | 'en') }}><option value="zh">中文</option><option value="en">English</option></select></Field>
        </div>
      </section>

      <section className="dvt-panel"><div className="dvt-panel-title"><h3>{t('limits')}</h3></div><div className="dvt-form-grid">
        <Field label={t('timeout')}><Input inputMode="numeric" value={draft.timeoutMs} onChange={(event) => { update('timeoutMs', event.target.value) }} /></Field>
        <Field label={t('maxBytes')}><Input inputMode="numeric" value={draft.maxImageBytes} onChange={(event) => { update('maxImageBytes', event.target.value) }} /></Field>
        <Field label={t('maxPixels')}><Input inputMode="numeric" value={draft.maxImagePixels} onChange={(event) => { update('maxImagePixels', event.target.value) }} /></Field>
        <Field label={t('concurrency')}><Input inputMode="numeric" value={draft.concurrency} onChange={(event) => { update('concurrency', event.target.value) }} /></Field>
      </div></section>

      <section className="dvt-panel"><div className="dvt-panel-title"><h3>{t('runtime')}</h3><span className={`dvt-badge ${snapshot.runtime.ready ? 'ok' : 'error'}`}>{snapshot.runtime.ready ? snapshot.runtime.upstream?.source ?? 'ready' : t('runtimeUnavailable')}</span></div><div className="dvt-form-grid">
        <Field label={t('runtimeMode')}><select value={draft.runtimeMode} onChange={(event) => { update('runtimeMode', event.target.value as 'managed' | 'external') }}><option value="managed">managed</option><option value="external">external</option></select></Field>
        {draft.runtimeMode === 'external' ? <Field label={t('toolkitPath')}><Input value={draft.toolkitPath} onChange={(event) => { update('toolkitPath', event.target.value) }} /></Field> : null}
        <Field label={t('python')}><Input placeholder="python3" value={draft.python} onChange={(event) => { update('python', event.target.value) }} /></Field>
        <Field label={t('allowedDirs')} hint={t('allowedDirsHint')}><textarea rows={3} value={draft.allowedDirs} onChange={(event) => { update('allowedDirs', event.target.value) }} /></Field>
      </div>
      {snapshot.runtime.upstream === undefined ? null : <div className="dvt-runtime-facts"><code>{snapshot.runtime.upstream.path}</code><code>{snapshot.runtime.upstream.python} · {snapshot.runtime.upstream.pythonVersion}</code><code>{snapshot.runtime.upstream.runtimeHome}</code></div>}
      </section>

      <div className="dvt-save-row"><Button variant="primary" disabled={!snapshot.writable || busy} onClick={save}>{state.action === 'save' ? t('saving') : t('save')}</Button><Button variant="outline" disabled={busy} onClick={() => { void controller.load() }}>{t('reload')}</Button></div>

      <section className="dvt-panel"><div className="dvt-panel-title"><div><h3>{t('health')}</h3><p>{t('connectionHint')}</p></div><div className="dvt-actions"><Button size="sm" variant="outline" disabled={busy || !snapshot.runtime.ready} onClick={() => { void controller.runHealth(false) }}>{state.action === 'health' ? t('testing') : t('runHealth')}</Button><Button size="sm" variant="primary" disabled={busy || !snapshot.runtime.ready} onClick={() => { void controller.runHealth(true) }}>{state.action === 'connection' ? t('testing') : t('testConnection')}</Button></div></div>
        {state.health === undefined ? <p className="dvt-muted">{t('notTested')}</p> : <div className="dvt-health-grid">{Object.entries(state.health.checks).map(([name, check]) => <div key={name} data-status={check.status}><span>{name}</span><strong>{check.status}</strong><p>{check.detail}</p></div>)}</div>}
      </section>
    </div>
  )
}

const CSS = `
.dvt-tool{margin:4px 0;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1,#dedbd5) 86%,transparent);border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fff) 96%,transparent);overflow:hidden;box-shadow:0 1px 0 rgba(0,0,0,.025)}
.dvt-tool-head{width:100%;min-height:38px;display:flex;align-items:center;gap:7px;padding:8px 10px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}.dvt-tool-head:focus-visible{outline:2px solid #7c6ff0;outline-offset:-2px}.dvt-tool-icon{width:20px;height:20px;display:grid;place-items:center;border-radius:6px;color:#6659c7;background:rgba(111,94,219,.1);flex:none}.dvt-tool-title{font-size:12px;font-weight:650;white-space:nowrap}.dvt-tool-sep{opacity:.35}.dvt-tool-summary{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-secondary,#77736d)}.dvt-tool-status{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary,#77736d);max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvt-tool[data-state=error] .dvt-tool-status{color:#c34f4f}.dvt-chevron{margin-left:auto;transition:transform .16s ease;opacity:.55}.dvt-chevron[data-open=true]{transform:rotate(180deg)}.dvt-tool-body{padding:0 10px 10px}.dvt-stack{display:grid;gap:10px}.dvt-muted{margin:0;color:var(--dsw-alias-label-secondary,#77736d);font-size:12px;line-height:1.5}
.dvt-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.dvt-metrics>div,.dvt-diff-score{padding:10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,#f7f5f1);display:grid;gap:4px}.dvt-metrics span,.dvt-diff-score span{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--dsw-alias-label-secondary,#77736d)}.dvt-metrics strong,.dvt-diff-score strong{font-size:13px}.dvt-list{list-style:none;margin:0;padding:0;display:grid;gap:4px;max-height:160px;overflow:auto}.dvt-list li{display:flex;justify-content:space-between;gap:12px;padding:6px 8px;border-radius:7px;background:var(--dsw-alias-bg-layer-2,#f7f5f1);font-size:11px}.dvt-list code{color:#6659c7}.dvt-table-wrap{max-height:220px;overflow:auto;border:1px solid var(--dsw-alias-border-l1,#dedbd5);border-radius:9px}.dvt-table{width:100%;border-collapse:collapse;font-size:11px}.dvt-table th,.dvt-table td{padding:7px 8px;text-align:left;border-bottom:1px solid var(--dsw-alias-border-l1,#e8e5df)}.dvt-table th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-2,#f7f5f1);font-size:10px;text-transform:uppercase;letter-spacing:.05em}.dvt-table tr:last-child td{border-bottom:0}
.dvt-artifact{border:1px solid var(--dsw-alias-border-l1,#dedbd5);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-1,#fff)}.dvt-preview{display:block;width:100%;max-height:360px;object-fit:contain;background:repeating-conic-gradient(#eee 0 25%,#fafafa 0 50%) 50%/18px 18px;border:0}.dvt-svg{height:280px}.dvt-artifact-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 10px}.dvt-artifact-meta>div:first-child{min-width:0;display:grid;gap:2px}.dvt-artifact-meta strong{font-size:12px;overflow:hidden;text-overflow:ellipsis}.dvt-artifact-meta span,.dvt-artifact-meta small{font-size:10px;color:var(--dsw-alias-label-secondary,#77736d)}.dvt-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.dvt-download{display:inline-flex;align-items:center;height:28px;padding:0 12px;border-radius:999px;background:#6758d4;color:#fff;text-decoration:none;font-size:12px;font-weight:600}.dvt-artifact>.dvt-muted{padding:0 10px 10px}.dvt-diff-score>div{height:5px;border-radius:99px;background:rgba(120,110,100,.13);overflow:hidden}.dvt-diff-score i{display:block;height:100%;min-width:2px;background:linear-gradient(90deg,#edb34d,#df5d5d);border-radius:99px}.dvt-tool h4{font-size:11px;margin:0 0 6px}.dvt-palette{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:7px}.dvt-palette>div{display:flex;align-items:center;gap:8px;padding:7px;border:1px solid var(--dsw-alias-border-l1,#dedbd5);border-radius:9px}.dvt-palette i{width:28px;height:28px;border-radius:7px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.12)}.dvt-palette span{display:grid}.dvt-palette strong{font-size:11px}.dvt-palette small{font-size:10px;color:var(--dsw-alias-label-secondary,#77736d)}
.dvt-settings{display:grid;gap:14px;max-width:900px;padding:8px 2px 32px;color:var(--dsw-alias-label-primary,#26231f)}.dvt-settings-header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding:8px 2px}.dvt-settings-header h2{font-size:25px;letter-spacing:-.025em;margin:3px 0 6px}.dvt-settings-header p{max-width:620px;margin:0;color:var(--dsw-alias-label-secondary,#77736d);font-size:13px;line-height:1.55}.dvt-kicker{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#6758d4;font-weight:700}.dvt-release{display:grid;gap:4px;min-width:170px;padding:9px 11px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#f7f5f1);font-size:10px;color:var(--dsw-alias-label-secondary,#77736d)}.dvt-release span{display:flex;justify-content:space-between;gap:12px}.dvt-release strong{color:var(--dsw-alias-label-primary,#26231f)}.dvt-alert{padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.5;display:grid;gap:3px}.dvt-alert.notice{background:rgba(92,108,213,.09);color:#5149a6}.dvt-alert.warning{background:rgba(224,162,55,.12);color:#986818}.dvt-alert.error{background:rgba(205,72,72,.1);color:#aa3939}.dvt-alert.success{background:rgba(48,154,100,.1);color:#267d52}.dvt-panel{display:grid;gap:12px;padding:15px;border:1px solid var(--dsw-alias-border-l1,#dedbd5);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 1px 1px rgba(0,0,0,.02)}.dvt-panel-title{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dvt-panel-title h3{font-size:14px;margin:0}.dvt-panel-title p{font-size:11px;line-height:1.45;color:var(--dsw-alias-label-secondary,#77736d);margin:4px 0 0;max-width:620px}.dvt-badge{font-size:10px;padding:3px 7px;border-radius:999px;font-weight:650}.dvt-badge.ok{background:rgba(48,154,100,.12);color:#267d52}.dvt-badge.error{background:rgba(205,72,72,.1);color:#aa3939}.dvt-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.dvt-field{display:grid;gap:6px;align-content:start}.dvt-field>span{font-size:11px;font-weight:600}.dvt-field>small{font-size:10px;color:var(--dsw-alias-label-secondary,#77736d);line-height:1.4}.dvt-field select,.dvt-field textarea{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,#d9d5ce);border-radius:9px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit;font-size:12px;padding:8px 10px}.dvt-field select{height:36px}.dvt-field textarea{resize:vertical;min-height:76px}.dvt-runtime-facts{display:grid;gap:4px;padding:9px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,#f7f5f1);overflow:auto}.dvt-runtime-facts code{font-size:10px;white-space:nowrap;color:var(--dsw-alias-label-secondary,#77736d)}.dvt-save-row{display:flex;gap:8px;padding:2px 0}
.dvt-health-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.dvt-health-grid>div{padding:9px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,#f7f5f1);border-left:3px solid #aaa}.dvt-health-grid>div[data-status=ok]{border-left-color:#39a66b}.dvt-health-grid>div[data-status=warning],.dvt-health-grid>div[data-status=not_tested]{border-left-color:#d49a37}.dvt-health-grid>div[data-status=error]{border-left-color:#cf5050}.dvt-health-grid span{font-size:10px;text-transform:capitalize}.dvt-health-grid strong{float:right;font-size:9px;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#77736d)}.dvt-health-grid p{clear:both;margin:5px 0 0;font-size:10px;line-height:1.4;color:var(--dsw-alias-label-secondary,#77736d)}.dvt-loading{padding:24px;border-radius:12px;background:var(--dsw-alias-bg-layer-2,#f7f5f1);font-size:12px;color:var(--dsw-alias-label-secondary,#77736d)}
body[data-ds-dark-theme] .dvt-tool-icon,body[data-ds-dark-theme] .dvt-list code,body[data-ds-dark-theme] .dvt-kicker{color:var(--dsw-alias-state-business-primary)}body[data-ds-dark-theme] .dvt-tool[data-state=error] .dvt-tool-status{color:var(--dsw-alias-state-error-primary)}body[data-ds-dark-theme] .dvt-alert.notice{color:var(--dsw-alias-state-business-primary)}body[data-ds-dark-theme] .dvt-alert.warning{color:var(--dsw-alias-state-warn-label)}body[data-ds-dark-theme] .dvt-alert.error,body[data-ds-dark-theme] .dvt-badge.error{color:var(--dsw-alias-state-error-primary)}body[data-ds-dark-theme] .dvt-alert.success,body[data-ds-dark-theme] .dvt-badge.ok{color:var(--dsw-alias-state-success-primary)}
.dvt-paste-dock{box-sizing:border-box;width:calc(100% - 32px);max-width:var(--dsh-composer-card-max-width,960px);margin:0 auto;display:flex;flex-wrap:wrap;gap:6px;padding:0 2px 6px}.dvt-paste-chip{max-width:100%;height:32px;box-sizing:border-box;display:flex;align-items:center;gap:7px;padding:0 6px 0 10px;border:1px solid var(--dsw-alias-border-l1,#dedbd5);border-radius:9px;background:var(--dsw-specific-tip,var(--dsw-alias-bg-layer-1,#fff));font-size:12px}.dvt-paste-chip[data-status=copying]{border-color:var(--dsw-alias-state-business-primary,#6758d4)}.dvt-paste-chip[data-status=error]{border-color:var(--dsw-alias-state-error-primary,#cf5050)}.dvt-paste-name{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvt-paste-detail{color:var(--dsw-alias-label-caption,#77736d);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvt-paste-chip[data-status=error] .dvt-paste-detail{color:var(--dsw-alias-state-error-primary,#cf5050)}.dvt-paste-chip button{width:20px;height:20px;display:grid;place-items:center;border:0;border-radius:50%;padding:0;background:transparent;color:var(--dsw-alias-label-caption,#77736d);font:inherit;font-size:16px;cursor:pointer}.dvt-paste-chip button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#26231f)}.dvt-paste-chip button:disabled{opacity:.4;cursor:default}
@media(max-width:720px){.dvt-settings-header{display:grid}.dvt-release{width:auto}.dvt-form-grid{grid-template-columns:1fr}.dvt-metrics{grid-template-columns:1fr}.dvt-artifact-meta{align-items:flex-start;flex-direction:column}.dvt-panel-title{flex-direction:column}}
`

function installStyles(): () => void {
  const id = '@dsh-external/dsh-vision-toolkit/client'
  const existing = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${id}"]`)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.plugin = '@dsh-external/dsh-vision-toolkit'
  style.dataset.pluginCss = id
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}

/** Required client services. */
export const inject = ['slots', 'locale', 'remote', 'conversation', 'sessions', 'slash']

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
    const disposers = [
      ctx.remote.$on('settings/document-updated', (namespace) => {
        if (namespace === 'vision-toolkit') controller.refreshIfLoaded()
      }),
      ctx.remote.$on('credentials/updated', (ref) => {
        const current = controller.snapshot().snapshot
        if (current?.credential.ref === ref) controller.refreshIfLoaded()
      }),
      ctx.on('connection/reset', () => { controller.refreshIfLoaded() }),
    ]
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
