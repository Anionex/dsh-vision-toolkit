window.__ModuleLoader__.load({ id: "@anionex/dsh-vision-toolkit", factory: (require) => {
var __modules = Object.create(null); var __cache = Object.create(null);
__modules["./index.js"] = function(module, exports, require, __load_) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inject = exports.VisionSettingsController = void 0;
exports.decodeVisionResult = decodeVisionResult;
exports.apply = apply;
const jsx_runtime_1 = require("react/jsx-runtime");
/**
 * DSH Vision Toolkit browser plugin: dedicated Tool cards plus the Settings,
 * health, connection-test, and safe Artifact preview experience.
 */
const react_1 = require("react");
const dsh_client_ui_primitives_1 = require("@deepseek-ai/dsh-client-ui-primitives");
const paste_images_tsx_1 = __load_("./paste-images.js");
const NS = 'vision-toolkit';
const SETTINGS_ROUTE = '/_dsh/vision-toolkit/settings';
const PRESENTATION_META_KEY = '$dshVisionToolkit';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
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
};
const zh = {
    nav: '视觉工具',
    settingsTitle: 'Vision Toolkit',
    settingsIntro: '配置固定版本的视觉工程运行时、外部视觉服务与本地安全限制。',
    externalNotice: '远程工具会把选中的图片字节发送到已配置的外部视觉 API。本地裁剪、几何恢复、像素对比、调色板、前景提取和 HTML 渲染不会上传图片。',
    provider: '视觉服务',
    baseUrl: '服务地址',
    credential: 'Credential 引用',
    model: '模型',
    protocol: 'API 协议',
    anthropicThinking: 'Anthropic thinking',
    anthropicThinkingHint: 'omit 兼容性最好。仅当所选模型明确支持时使用 disabled 或 adaptive；遇到 HTTP 400 时先恢复 omit。',
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
};
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function textOfContent(block) {
    if (!('kind' in block))
        return '';
    return block.content
        .filter((entry) => entry.type === 'text')
        .map(entry => entry.text)
        .join('\n');
}
/** Decode canonical presentation metadata with a JSON-text fallback. */
function decodeVisionResult(block) {
    if (!('kind' in block) || block.isError)
        return undefined;
    if (isRecord(block.meta))
        return block.meta;
    const text = textOfContent(block).trim();
    if (text.length === 0)
        return undefined;
    try {
        const parsed = JSON.parse(text);
        return isRecord(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function accessMap(value) {
    const map = new Map();
    if (value === undefined)
        return map;
    const envelope = value[PRESENTATION_META_KEY];
    if (!isRecord(envelope) || envelope.schemaVersion !== 1 || !Array.isArray(envelope.artifacts))
        return map;
    for (const entry of envelope.artifacts) {
        if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.previewUrl !== 'string' || typeof entry.downloadUrl !== 'string')
            continue;
        map.set(entry.path, entry);
    }
    return map;
}
function artifactFrom(value) {
    if (!isRecord(value))
        return undefined;
    if (typeof value.path !== 'string'
        || typeof value.filename !== 'string'
        || typeof value.mimeType !== 'string'
        || (value.kind !== 'image' && value.kind !== 'svg' && value.kind !== 'markdown' && value.kind !== 'json')
        || typeof value.description !== 'string'
        || typeof value.sourceTool !== 'string'
        || (value.previewIntent !== 'image' && value.previewIntent !== 'svg' && value.previewIntent !== 'text' && value.previewIntent !== 'download')
        || typeof value.bytes !== 'number')
        return undefined;
    return value;
}
function collectArtifacts(value, found = new Map(), depth = 0) {
    if (depth > 16)
        return [...found.values()];
    const artifact = artifactFrom(value);
    if (artifact !== undefined) {
        found.set(artifact.path, artifact);
        return [...found.values()];
    }
    if (Array.isArray(value)) {
        for (const entry of value)
            collectArtifacts(entry, found, depth + 1);
    }
    else if (isRecord(value)) {
        for (const entry of Object.values(value))
            collectArtifacts(entry, found, depth + 1);
    }
    return [...found.values()];
}
function numberOf(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function stringOf(value) {
    return typeof value === 'string' ? value : undefined;
}
function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function boxText(value) {
    if (!isRecord(value))
        return '—';
    const parts = ['x1', 'y1', 'x2', 'y2'].map(key => numberOf(value[key]));
    return parts.every(part => part !== undefined) ? parts.join(', ') : '—';
}
function statusText(block, t) {
    if (!('kind' in block))
        return t('running');
    if (block.isError)
        return textOfContent(block).split('\n')[0] || t('failed');
    return undefined;
}
function VisionIcon({ kind = 'scan' }) {
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
                        : 'M3 5V3h2M11 3h2v2M13 11v2h-2M5 13H3v-2M5 8h6';
    return ((0, jsx_runtime_1.jsx)("svg", { viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": "true", fill: "none", stroke: "currentColor", strokeWidth: "1.35", strokeLinecap: "round", strokeLinejoin: "round", children: (0, jsx_runtime_1.jsx)("path", { d: path }) }));
}
function ToolShell({ block, title, summary, icon, children, t, }) {
    const [open, setOpen] = (0, react_1.useState)(true);
    const status = statusText(block, t);
    const expandable = children !== undefined && children !== null;
    return ((0, jsx_runtime_1.jsxs)("section", { className: "dvt-tool", "data-state": !('kind' in block) ? 'running' : block.isError ? 'error' : 'success', children: [(0, jsx_runtime_1.jsxs)("button", { type: "button", className: "dvt-tool-head", onClick: () => { if (expandable)
                    setOpen(value => !value); }, "aria-expanded": expandable ? open : undefined, children: [(0, jsx_runtime_1.jsx)("span", { className: "dvt-tool-icon", children: icon }), (0, jsx_runtime_1.jsx)("span", { className: "dvt-tool-title", children: title }), summary !== undefined && summary.length > 0 ? (0, jsx_runtime_1.jsx)("span", { className: "dvt-tool-sep", "aria-hidden": "true", children: "\u00B7" }) : null, summary !== undefined ? (0, jsx_runtime_1.jsx)("span", { className: "dvt-tool-summary", children: summary }) : null, status !== undefined ? (0, jsx_runtime_1.jsx)("span", { className: "dvt-tool-status", children: status }) : null, expandable ? (0, jsx_runtime_1.jsx)("span", { className: "dvt-chevron", "data-open": open || undefined, children: "\u2304" }) : null] }), expandable && open ? (0, jsx_runtime_1.jsx)("div", { className: "dvt-tool-body", children: children }) : null] }));
}
function ArtifactActions({ artifact, grant, openFile, t }) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "dvt-actions", children: [(0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { size: "sm", variant: "outline", onClick: () => { openFile(artifact.path); }, children: t('open') }), grant === undefined ? null : (0, jsx_runtime_1.jsx)("a", { className: "dvt-download", href: grant.downloadUrl, download: artifact.filename, children: t('download') })] }));
}
function ArtifactPreview({ artifact, grant, openFile, t }) {
    const canPreview = grant !== undefined && (artifact.kind === 'image' || artifact.kind === 'svg');
    return ((0, jsx_runtime_1.jsxs)("article", { className: "dvt-artifact", children: [canPreview
                ? artifact.kind === 'svg'
                    ? (0, jsx_runtime_1.jsx)("iframe", { className: "dvt-preview dvt-svg", sandbox: "", src: grant.previewUrl, title: artifact.description })
                    : (0, jsx_runtime_1.jsx)("img", { className: "dvt-preview", src: grant.previewUrl, alt: artifact.description, loading: "lazy" })
                : null, (0, jsx_runtime_1.jsxs)("div", { className: "dvt-artifact-meta", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("strong", { children: artifact.filename }), (0, jsx_runtime_1.jsx)("span", { children: artifact.description }), (0, jsx_runtime_1.jsxs)("small", { children: [artifact.mimeType, " \u00B7 ", formatBytes(artifact.bytes)] })] }), (0, jsx_runtime_1.jsx)(ArtifactActions, { artifact: artifact, grant: grant, openFile: openFile, t: t })] }), !canPreview && grant === undefined ? (0, jsx_runtime_1.jsx)("p", { className: "dvt-muted", children: t('previewUnavailable') }) : null] }));
}
function GroundView({ block, openFile, t = key => en[key] }) {
    const value = decodeVisionResult(block);
    const matches = Array.isArray(value?.matches) ? value.matches.filter(isRecord) : [];
    const target = stringOf(value?.target) ?? 'Ground';
    const width = numberOf(value?.imageWidth);
    const height = numberOf(value?.imageHeight);
    const preview = artifactFrom(value?.preview);
    const grants = accessMap(value);
    return ((0, jsx_runtime_1.jsx)(ToolShell, { block: block, title: "Ground", summary: matches.length > 0 ? `${target} · ${matches.length} ${t('matches')}` : target, icon: (0, jsx_runtime_1.jsx)(VisionIcon, { kind: "target" }), t: t, children: value === undefined ? (0, jsx_runtime_1.jsx)("p", { className: "dvt-muted", children: t('noResult') }) : ((0, jsx_runtime_1.jsxs)("div", { className: "dvt-stack", children: [(0, jsx_runtime_1.jsxs)("div", { className: "dvt-metrics", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { children: t('dimensions') }), (0, jsx_runtime_1.jsxs)("strong", { children: [width ?? '—', " \u00D7 ", height ?? '—'] })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { children: t('coordinates') }), (0, jsx_runtime_1.jsx)("strong", { children: matches[0] === undefined ? '—' : boxText(matches[0].box) })] })] }), matches.length > 1 ? ((0, jsx_runtime_1.jsx)("ol", { className: "dvt-list", children: matches.map((match, index) => (0, jsx_runtime_1.jsxs)("li", { children: [(0, jsx_runtime_1.jsx)("span", { children: stringOf(match.label) ?? `#${index + 1}` }), (0, jsx_runtime_1.jsx)("code", { children: boxText(match.box) })] }, index)) })) : null, preview === undefined ? null : (0, jsx_runtime_1.jsx)(ArtifactPreview, { artifact: preview, grant: grants.get(preview.path), openFile: openFile, t: t })] })) }));
}
function DetectView({ block, openFile, t = key => en[key] }) {
    const value = decodeVisionResult(block);
    const elements = Array.isArray(value?.elements) ? value.elements.filter(isRecord) : [];
    const width = numberOf(value?.imageWidth);
    const height = numberOf(value?.imageHeight);
    const preview = artifactFrom(value?.preview);
    const grants = accessMap(value);
    return ((0, jsx_runtime_1.jsx)(ToolShell, { block: block, title: "Detect", summary: `${elements.length} ${t('elements')}`, icon: (0, jsx_runtime_1.jsx)(VisionIcon, { kind: "layers" }), t: t, children: value === undefined ? (0, jsx_runtime_1.jsx)("p", { className: "dvt-muted", children: t('noResult') }) : ((0, jsx_runtime_1.jsxs)("div", { className: "dvt-stack", children: [(0, jsx_runtime_1.jsxs)("div", { className: "dvt-metrics", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { children: t('dimensions') }), (0, jsx_runtime_1.jsxs)("strong", { children: [width ?? '—', " \u00D7 ", height ?? '—'] })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { children: t('elements') }), (0, jsx_runtime_1.jsx)("strong", { children: elements.length })] })] }), (0, jsx_runtime_1.jsx)("div", { className: "dvt-table-wrap", children: (0, jsx_runtime_1.jsxs)("table", { className: "dvt-table", children: [(0, jsx_runtime_1.jsx)("thead", { children: (0, jsx_runtime_1.jsxs)("tr", { children: [(0, jsx_runtime_1.jsx)("th", { children: "#" }), (0, jsx_runtime_1.jsx)("th", { children: "Label" }), (0, jsx_runtime_1.jsx)("th", { children: t('coordinates') })] }) }), (0, jsx_runtime_1.jsx)("tbody", { children: elements.map((element, index) => (0, jsx_runtime_1.jsxs)("tr", { children: [(0, jsx_runtime_1.jsx)("td", { children: numberOf(element.index) ?? index + 1 }), (0, jsx_runtime_1.jsx)("td", { children: stringOf(element.label) ?? '—' }), (0, jsx_runtime_1.jsx)("td", { children: (0, jsx_runtime_1.jsx)("code", { children: boxText(element.box) }) })] }, index)) })] }) }), preview === undefined ? null : (0, jsx_runtime_1.jsx)(ArtifactPreview, { artifact: preview, grant: grants.get(preview.path), openFile: openFile, t: t })] })) }));
}
function TraceView({ block, openFile, t = key => en[key] }) {
    const value = decodeVisionResult(block);
    const artifact = artifactFrom(value?.artifact);
    const geometry = isRecord(value?.geometry) ? value.geometry : undefined;
    const summary = geometry === undefined ? undefined : `${numberOf(geometry.pathCount) ?? 0} paths · ${formatBytes(numberOf(geometry.bytes) ?? 0)}`;
    const grants = accessMap(value);
    return ((0, jsx_runtime_1.jsx)(ToolShell, { block: block, title: "Trace SVG", summary: summary, icon: (0, jsx_runtime_1.jsx)(VisionIcon, { kind: "shape" }), t: t, children: artifact === undefined ? (0, jsx_runtime_1.jsx)("p", { className: "dvt-muted", children: t('noResult') }) : (0, jsx_runtime_1.jsx)(ArtifactPreview, { artifact: artifact, grant: grants.get(artifact.path), openFile: openFile, t: t }) }));
}
function PixelDiffView({ block, openFile, t = key => en[key] }) {
    const value = decodeVisionResult(block);
    const pct = numberOf(value?.overallDifferencePct);
    const regions = Array.isArray(value?.worstRegions) ? value.worstRegions.filter(isRecord) : [];
    const heatmap = artifactFrom(value?.heatmap);
    const report = artifactFrom(value?.report);
    const grants = accessMap(value);
    return ((0, jsx_runtime_1.jsx)(ToolShell, { block: block, title: "Pixel Diff", summary: pct === undefined ? undefined : `${pct.toFixed(3)}%`, icon: (0, jsx_runtime_1.jsx)(VisionIcon, { kind: "diff" }), t: t, children: value === undefined ? (0, jsx_runtime_1.jsx)("p", { className: "dvt-muted", children: t('noResult') }) : ((0, jsx_runtime_1.jsxs)("div", { className: "dvt-stack", children: [(0, jsx_runtime_1.jsxs)("div", { className: "dvt-diff-score", children: [(0, jsx_runtime_1.jsx)("span", { children: t('difference') }), (0, jsx_runtime_1.jsxs)("strong", { children: [pct?.toFixed(4) ?? '—', "%"] }), (0, jsx_runtime_1.jsx)("div", { children: (0, jsx_runtime_1.jsx)("i", { style: { width: `${Math.min(100, Math.max(0, pct ?? 0))}%` } }) })] }), regions.length === 0 ? null : (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h4", { children: t('worstRegions') }), (0, jsx_runtime_1.jsx)("ol", { className: "dvt-list", children: regions.map((region, index) => (0, jsx_runtime_1.jsxs)("li", { children: [(0, jsx_runtime_1.jsxs)("span", { children: [(numberOf(region.differencePct) ?? 0).toFixed(3), "%"] }), (0, jsx_runtime_1.jsx)("code", { children: boxText(region.box) })] }, index)) })] }), heatmap === undefined ? null : (0, jsx_runtime_1.jsx)(ArtifactPreview, { artifact: heatmap, grant: grants.get(heatmap.path), openFile: openFile, t: t }), report === undefined ? null : (0, jsx_runtime_1.jsx)(ArtifactPreview, { artifact: report, grant: grants.get(report.path), openFile: openFile, t: t })] })) }));
}
function ArtifactView({ block, openFile, toolName, t = key => en[key] }) {
    const value = decodeVisionResult(block);
    const artifacts = collectArtifacts(value);
    const grants = accessMap(value);
    const title = toolName === 'vision_crop' ? 'Crop'
        : toolName === 'vision_long_screenshot_ocr' ? 'Long OCR'
            : toolName === 'vision_extract_foreground' ? 'Extract Foreground'
                : toolName === 'vision_html_screenshot' ? 'HTML Screenshot'
                    : 'Vision Artifact';
    return ((0, jsx_runtime_1.jsx)(ToolShell, { block: block, title: title, summary: artifacts.length > 0 ? `${artifacts.length} ${t('artifacts')}` : undefined, icon: (0, jsx_runtime_1.jsx)(VisionIcon, {}), t: t, children: artifacts.length === 0 ? (0, jsx_runtime_1.jsx)("p", { className: "dvt-muted", children: t('noResult') }) : (0, jsx_runtime_1.jsx)("div", { className: "dvt-stack", children: artifacts.map(artifact => (0, jsx_runtime_1.jsx)(ArtifactPreview, { artifact: artifact, grant: grants.get(artifact.path), openFile: openFile, t: t }, artifact.path)) }) }));
}
function PaletteView({ block, t = key => en[key] }) {
    const value = decodeVisionResult(block);
    const analysis = isRecord(value?.analysis) ? value.analysis : undefined;
    const colors = Array.isArray(analysis?.colors) ? analysis.colors.filter(isRecord) : [];
    return ((0, jsx_runtime_1.jsx)(ToolShell, { block: block, title: "Dominant Colors", summary: `${colors.length} ${t('colors')}`, icon: (0, jsx_runtime_1.jsx)(VisionIcon, { kind: "palette" }), t: t, children: colors.length === 0 ? (0, jsx_runtime_1.jsx)("p", { className: "dvt-muted", children: t('noResult') }) : (0, jsx_runtime_1.jsx)("div", { className: "dvt-palette", children: colors.map((color, index) => {
                const hex = stringOf(color.color) ?? '#000000';
                const share = numberOf(color.sharePct);
                return (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("i", { style: { background: hex } }), (0, jsx_runtime_1.jsxs)("span", { children: [(0, jsx_runtime_1.jsx)("strong", { children: hex }), (0, jsx_runtime_1.jsx)("small", { children: share === undefined ? '' : `${share.toFixed(2)}%` })] })] }, `${hex}-${index}`);
            }) }) }));
}
async function apiRequest(init) {
    const response = await fetch(SETTINGS_ROUTE, { credentials: 'same-origin', ...init });
    const body = await response.json();
    if (!response.ok || !body.ok) {
        const failure = body;
        throw new Error(failure.error?.message ?? `Vision Toolkit request failed with HTTP ${response.status}`);
    }
    return body.value;
}
/** Small external store shared by the Settings route and pushed invalidations. */
class VisionSettingsController {
    state = { status: 'idle' };
    listeners = new Set();
    generation = 0;
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    snapshot = () => this.state;
    set(next) {
        this.state = next;
        for (const listener of this.listeners)
            listener();
    }
    async load() {
        const generation = ++this.generation;
        this.set({ ...this.state, status: 'loading', error: undefined, message: undefined });
        try {
            const snapshot = await apiRequest();
            if (generation !== this.generation)
                return;
            this.set({ status: 'ready', snapshot, health: this.state.health });
        }
        catch (error) {
            if (generation !== this.generation)
                return;
            this.set({ ...this.state, status: 'error', error: error instanceof Error ? error.message : String(error) });
        }
    }
    refreshIfLoaded() {
        if (this.state.status === 'idle' || this.state.action === 'save')
            return;
        void this.load();
    }
    async save(value, expectedRevision) {
        this.set({ ...this.state, action: 'save', error: undefined, message: undefined });
        try {
            const snapshot = await apiRequest({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'save', expectedRevision, value }),
            });
            this.set({ status: 'ready', snapshot, health: this.state.health, message: 'saved' });
        }
        catch (error) {
            this.set({ ...this.state, action: undefined, error: error instanceof Error ? error.message : String(error) });
        }
    }
    async runHealth(testConnection) {
        this.set({ ...this.state, action: testConnection ? 'connection' : 'health', error: undefined, message: undefined });
        try {
            const health = await apiRequest({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'health', testConnection }),
            });
            this.set({ ...this.state, action: undefined, health });
        }
        catch (error) {
            this.set({ ...this.state, action: undefined, error: error instanceof Error ? error.message : String(error) });
        }
    }
}
exports.VisionSettingsController = VisionSettingsController;
function draftOf(value) {
    return {
        baseUrl: value.provider?.baseUrl ?? 'https://api.inferera.com/v1',
        credential: value.provider?.credential ?? 'VISION_API_KEY',
        model: value.provider?.model ?? 'gemini-3.6-flash',
        protocol: value.provider?.protocol ?? 'openai',
        anthropicThinking: value.provider?.anthropicThinking ?? 'omit',
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
    };
}
function positiveInteger(raw, label) {
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0)
        throw new Error(`${label} must be a positive integer`);
    return value;
}
function valueOf(draft) {
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
    };
}
function Field({ label, children, hint }) {
    return (0, jsx_runtime_1.jsxs)("label", { className: "dvt-field", children: [(0, jsx_runtime_1.jsx)("span", { children: label }), children, hint === undefined ? null : (0, jsx_runtime_1.jsx)("small", { children: hint })] });
}
function SettingsSection({ controller, t }) {
    if (controller === undefined || t === undefined)
        return null;
    return (0, jsx_runtime_1.jsx)(LoadedSettings, { controller: controller, t: t });
}
function LoadedSettings({ controller, t }) {
    const state = (0, react_1.useSyncExternalStore)(controller.subscribe, controller.snapshot, controller.snapshot);
    const snapshot = state.snapshot;
    const [draft, setDraft] = (0, react_1.useState)(undefined);
    const [draftError, setDraftError] = (0, react_1.useState)(undefined);
    (0, react_1.useEffect)(() => { if (state.status === 'idle')
        void controller.load(); }, [controller, state.status]);
    (0, react_1.useEffect)(() => {
        if (snapshot !== undefined)
            setDraft(draftOf(snapshot.settings.value));
    }, [snapshot]);
    if (state.status === 'idle' || (state.status === 'loading' && snapshot === undefined)) {
        return (0, jsx_runtime_1.jsx)("div", { className: "dvt-settings", children: (0, jsx_runtime_1.jsx)("div", { className: "dvt-loading", children: t('testing') }) });
    }
    if (snapshot === undefined || draft === undefined) {
        return (0, jsx_runtime_1.jsxs)("div", { className: "dvt-settings", children: [(0, jsx_runtime_1.jsx)("div", { className: "dvt-alert error", children: state.error ?? t('runtimeUnavailable') }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { variant: "outline", onClick: () => { void controller.load(); }, children: t('retry') })] });
    }
    const update = (key, value) => setDraft(current => current === undefined ? current : { ...current, [key]: value });
    const save = () => {
        try {
            setDraftError(undefined);
            void controller.save(valueOf(draft), snapshot.settings.revision);
        }
        catch (error) {
            setDraftError(error instanceof Error ? error.message : String(error));
        }
    };
    const busy = state.action !== undefined;
    const runtimeErrorTitle = snapshot.runtime.ready ? t('runtimeCandidateRejected') : t('runtimeUnavailable');
    return ((0, jsx_runtime_1.jsxs)("div", { className: "dvt-settings", children: [(0, jsx_runtime_1.jsxs)("header", { className: "dvt-settings-header", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { className: "dvt-kicker", children: "DSH native plugin" }), (0, jsx_runtime_1.jsx)("h2", { children: t('settingsTitle') }), (0, jsx_runtime_1.jsx)("p", { children: t('settingsIntro') })] }), (0, jsx_runtime_1.jsxs)("div", { className: "dvt-release", children: [(0, jsx_runtime_1.jsxs)("span", { children: [t('pluginVersion'), " ", (0, jsx_runtime_1.jsx)("strong", { children: snapshot.release.pluginVersion })] }), (0, jsx_runtime_1.jsxs)("span", { children: [t('upstreamVersion'), " ", (0, jsx_runtime_1.jsx)("strong", { children: snapshot.release.upstreamVersion })] }), (0, jsx_runtime_1.jsxs)("span", { children: [t('activeGeneration'), " ", (0, jsx_runtime_1.jsx)("strong", { children: snapshot.runtime.generation })] })] })] }), (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert notice", children: t('externalNotice') }), !snapshot.writable ? (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert warning", children: t('readOnly') }) : null, draftError === undefined ? null : (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert error", children: draftError }), state.error === undefined ? null : (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert error", children: state.error }), state.message === 'saved' ? (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert success", children: t('saved') }) : null, snapshot.runtime.lastError === undefined ? null : (0, jsx_runtime_1.jsxs)("div", { className: "dvt-alert error", children: [(0, jsx_runtime_1.jsx)("strong", { children: runtimeErrorTitle }), (0, jsx_runtime_1.jsx)("span", { children: snapshot.runtime.lastError })] }), (0, jsx_runtime_1.jsxs)("section", { className: "dvt-panel", children: [(0, jsx_runtime_1.jsxs)("div", { className: "dvt-panel-title", children: [(0, jsx_runtime_1.jsx)("h3", { children: t('provider') }), (0, jsx_runtime_1.jsx)("span", { className: `dvt-badge ${snapshot.credential.configured ? 'ok' : 'error'}`, children: snapshot.credential.configured ? t('configured') : t('missing') })] }), (0, jsx_runtime_1.jsxs)("div", { className: "dvt-form-grid", children: [(0, jsx_runtime_1.jsx)(Field, { label: t('baseUrl'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { value: draft.baseUrl, onChange: (event) => { update('baseUrl', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('model'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { value: draft.model, onChange: (event) => { update('model', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('protocol'), children: (0, jsx_runtime_1.jsxs)("select", { value: draft.protocol, onChange: (event) => { update('protocol', event.target.value); }, children: [(0, jsx_runtime_1.jsx)("option", { value: "openai", children: "OpenAI Chat Completions" }), (0, jsx_runtime_1.jsx)("option", { value: "anthropic", children: "Anthropic Messages" })] }) }), draft.protocol === 'anthropic' ? (0, jsx_runtime_1.jsx)(Field, { label: t('anthropicThinking'), hint: t('anthropicThinkingHint'), children: (0, jsx_runtime_1.jsxs)("select", { "aria-label": t('anthropicThinking'), value: draft.anthropicThinking, onChange: (event) => { update('anthropicThinking', event.target.value); }, children: [(0, jsx_runtime_1.jsx)("option", { value: "omit", children: "omit (widest compatibility)" }), (0, jsx_runtime_1.jsx)("option", { value: "disabled", children: "disabled (model support required)" }), (0, jsx_runtime_1.jsx)("option", { value: "adaptive", children: "adaptive (model support required)" })] }) }) : null, (0, jsx_runtime_1.jsx)(Field, { label: t('userAgent'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { value: draft.userAgent, onChange: (event) => { update('userAgent', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('credential'), hint: snapshot.credential.source === undefined ? undefined : `${t('source')}: ${snapshot.credential.source}`, children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { value: draft.credential, onChange: (event) => { update('credential', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('language'), children: (0, jsx_runtime_1.jsxs)("select", { value: draft.language, onChange: (event) => { update('language', event.target.value); }, children: [(0, jsx_runtime_1.jsx)("option", { value: "zh", children: "\u4E2D\u6587" }), (0, jsx_runtime_1.jsx)("option", { value: "en", children: "English" })] }) })] })] }), (0, jsx_runtime_1.jsxs)("section", { className: "dvt-panel", children: [(0, jsx_runtime_1.jsx)("div", { className: "dvt-panel-title", children: (0, jsx_runtime_1.jsx)("h3", { children: t('limits') }) }), (0, jsx_runtime_1.jsxs)("div", { className: "dvt-form-grid", children: [(0, jsx_runtime_1.jsx)(Field, { label: t('timeout'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { inputMode: "numeric", value: draft.timeoutMs, onChange: (event) => { update('timeoutMs', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('maxBytes'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { inputMode: "numeric", value: draft.maxImageBytes, onChange: (event) => { update('maxImageBytes', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('maxPixels'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { inputMode: "numeric", value: draft.maxImagePixels, onChange: (event) => { update('maxImagePixels', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('concurrency'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { inputMode: "numeric", value: draft.concurrency, onChange: (event) => { update('concurrency', event.target.value); } }) })] })] }), (0, jsx_runtime_1.jsxs)("section", { className: "dvt-panel", children: [(0, jsx_runtime_1.jsxs)("div", { className: "dvt-panel-title", children: [(0, jsx_runtime_1.jsx)("h3", { children: t('runtime') }), (0, jsx_runtime_1.jsx)("span", { className: `dvt-badge ${snapshot.runtime.ready ? 'ok' : 'error'}`, children: snapshot.runtime.ready ? snapshot.runtime.upstream?.source ?? 'ready' : t('runtimeUnavailable') })] }), (0, jsx_runtime_1.jsxs)("div", { className: "dvt-form-grid", children: [(0, jsx_runtime_1.jsx)(Field, { label: t('runtimeMode'), children: (0, jsx_runtime_1.jsxs)("select", { value: draft.runtimeMode, onChange: (event) => { update('runtimeMode', event.target.value); }, children: [(0, jsx_runtime_1.jsx)("option", { value: "managed", children: "managed" }), (0, jsx_runtime_1.jsx)("option", { value: "external", children: "external" })] }) }), draft.runtimeMode === 'external' ? (0, jsx_runtime_1.jsx)(Field, { label: t('toolkitPath'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { value: draft.toolkitPath, onChange: (event) => { update('toolkitPath', event.target.value); } }) }) : null, (0, jsx_runtime_1.jsx)(Field, { label: t('python'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { placeholder: "python3", value: draft.python, onChange: (event) => { update('python', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('allowedDirs'), hint: t('allowedDirsHint'), children: (0, jsx_runtime_1.jsx)("textarea", { rows: 3, value: draft.allowedDirs, onChange: (event) => { update('allowedDirs', event.target.value); } }) })] }), snapshot.runtime.upstream === undefined ? null : (0, jsx_runtime_1.jsxs)("div", { className: "dvt-runtime-facts", children: [(0, jsx_runtime_1.jsx)("code", { children: snapshot.runtime.upstream.path }), (0, jsx_runtime_1.jsxs)("code", { children: [snapshot.runtime.upstream.python, " \u00B7 ", snapshot.runtime.upstream.pythonVersion] }), (0, jsx_runtime_1.jsx)("code", { children: snapshot.runtime.upstream.runtimeHome })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "dvt-save-row", children: [(0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { variant: "primary", disabled: !snapshot.writable || busy, onClick: save, children: state.action === 'save' ? t('saving') : t('save') }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { variant: "outline", disabled: busy, onClick: () => { void controller.load(); }, children: t('reload') })] }), (0, jsx_runtime_1.jsxs)("section", { className: "dvt-panel", children: [(0, jsx_runtime_1.jsxs)("div", { className: "dvt-panel-title", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h3", { children: t('health') }), (0, jsx_runtime_1.jsx)("p", { children: t('connectionHint') })] }), (0, jsx_runtime_1.jsxs)("div", { className: "dvt-actions", children: [(0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { size: "sm", variant: "outline", disabled: busy || !snapshot.runtime.ready, onClick: () => { void controller.runHealth(false); }, children: state.action === 'health' ? t('testing') : t('runHealth') }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { size: "sm", variant: "primary", disabled: busy || !snapshot.runtime.ready, onClick: () => { void controller.runHealth(true); }, children: state.action === 'connection' ? t('testing') : t('testConnection') })] })] }), state.health === undefined ? (0, jsx_runtime_1.jsx)("p", { className: "dvt-muted", children: t('notTested') }) : (0, jsx_runtime_1.jsx)("div", { className: "dvt-health-grid", children: Object.entries(state.health.checks).map(([name, check]) => (0, jsx_runtime_1.jsxs)("div", { "data-status": check.status, children: [(0, jsx_runtime_1.jsx)("span", { children: name }), (0, jsx_runtime_1.jsx)("strong", { children: check.status }), (0, jsx_runtime_1.jsx)("p", { children: check.detail })] }, name)) })] })] }));
}
const CSS = `
.dvt-tool{margin:4px 0;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;box-shadow:var(--dsw-shadow-lv1)}
.dvt-tool-head{width:100%;min-height:38px;display:flex;align-items:center;gap:7px;padding:8px 10px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}.dvt-tool-head:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dvt-tool-icon{width:20px;height:20px;display:grid;place-items:center;border-radius:6px;color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);flex:none}.dvt-tool-title{font-size:12px;font-weight:650;white-space:nowrap}.dvt-tool-sep{opacity:.35}.dvt-tool-summary{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-secondary)}.dvt-tool-status{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvt-tool[data-state=error] .dvt-tool-status{color:var(--dsw-alias-state-error-primary)}.dvt-chevron{margin-left:auto;transition:transform .16s ease;opacity:.55}.dvt-chevron[data-open=true]{transform:rotate(180deg)}.dvt-tool-body{padding:0 10px 10px}.dvt-stack{display:grid;gap:10px}.dvt-muted{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
.dvt-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.dvt-metrics>div,.dvt-diff-score{padding:10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);display:grid;gap:4px}.dvt-metrics span,.dvt-diff-score span{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--dsw-alias-label-secondary)}.dvt-metrics strong,.dvt-diff-score strong{font-size:13px}.dvt-list{list-style:none;margin:0;padding:0;display:grid;gap:4px;max-height:160px;overflow:auto}.dvt-list li{display:flex;justify-content:space-between;gap:12px;padding:6px 8px;border-radius:7px;background:var(--dsw-alias-bg-layer-2);font-size:11px}.dvt-list code{color:var(--dsw-alias-state-business-primary)}.dvt-table-wrap{max-height:220px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:9px}.dvt-table{width:100%;border-collapse:collapse;font-size:11px}.dvt-table th,.dvt-table td{padding:7px 8px;text-align:left;border-bottom:1px solid var(--dsw-alias-border-l1)}.dvt-table th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-2);font-size:10px;text-transform:uppercase;letter-spacing:.05em}.dvt-table tr:last-child td{border-bottom:0}
.dvt-artifact{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}.dvt-preview{display:block;width:100%;max-height:360px;object-fit:contain;background:repeating-conic-gradient(var(--dsw-alias-bg-module-platform) 0 25%,var(--dsw-alias-bg-layer-1) 0 50%) 50%/18px 18px;border:0}.dvt-svg{height:280px}.dvt-artifact-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 10px}.dvt-artifact-meta>div:first-child{min-width:0;display:grid;gap:2px}.dvt-artifact-meta strong{font-size:12px;overflow:hidden;text-overflow:ellipsis}.dvt-artifact-meta span,.dvt-artifact-meta small{font-size:10px;color:var(--dsw-alias-label-secondary)}.dvt-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.dvt-download{display:inline-flex;align-items:center;height:28px;padding:0 12px;border-radius:999px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);text-decoration:none;font-size:12px;font-weight:600}.dvt-download:hover{background:var(--dsw-alias-button-primary-hover)}.dvt-download:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.dvt-artifact>.dvt-muted{padding:0 10px 10px}.dvt-diff-score>div{height:5px;border-radius:99px;background:var(--dsw-alias-border-l2);overflow:hidden}.dvt-diff-score i{display:block;height:100%;min-width:2px;background:linear-gradient(90deg,var(--dsw-alias-state-warn-primary),var(--dsw-alias-state-error-primary));border-radius:99px}.dvt-tool h4{font-size:11px;margin:0 0 6px}.dvt-palette{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:7px}.dvt-palette>div{display:flex;align-items:center;gap:8px;padding:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px}.dvt-palette i{width:28px;height:28px;border-radius:7px;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}.dvt-palette span{display:grid}.dvt-palette strong{font-size:11px}.dvt-palette small{font-size:10px;color:var(--dsw-alias-label-secondary)}
.dvt-settings{display:grid;gap:14px;max-width:900px;padding:8px 2px 32px;color:var(--dsw-alias-label-primary)}.dvt-settings-header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding:8px 2px}.dvt-settings-header h2{font-size:25px;letter-spacing:-.025em;margin:3px 0 6px}.dvt-settings-header p{max-width:620px;margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.55}.dvt-kicker{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--dsw-alias-state-business-primary);font-weight:700}.dvt-release{display:grid;gap:4px;min-width:170px;padding:9px 11px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);font-size:10px;color:var(--dsw-alias-label-secondary)}.dvt-release span{display:flex;justify-content:space-between;gap:12px}.dvt-release strong{color:var(--dsw-alias-label-primary)}.dvt-alert{padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.5;display:grid;gap:3px}.dvt-alert.notice{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary)}.dvt-alert.warning{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-label)}.dvt-alert.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}.dvt-alert.success{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}.dvt-panel{display:grid;gap:12px;padding:15px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv1)}.dvt-panel-title{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dvt-panel-title h3{font-size:14px;margin:0}.dvt-panel-title p{font-size:11px;line-height:1.45;color:var(--dsw-alias-label-secondary);margin:4px 0 0;max-width:620px}.dvt-badge{font-size:10px;padding:3px 7px;border-radius:999px;font-weight:650}.dvt-badge.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary)}.dvt-badge.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}.dvt-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.dvt-field{display:grid;gap:6px;align-content:start}.dvt-field>span{font-size:11px;font-weight:600}.dvt-field>small{font-size:10px;color:var(--dsw-alias-label-secondary);line-height:1.4}.dvt-field select,.dvt-field textarea{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:8px 10px}.dvt-field select{height:36px}.dvt-field textarea{resize:vertical;min-height:76px}.dvt-runtime-facts{display:grid;gap:4px;padding:9px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);overflow:auto}.dvt-runtime-facts code{font-size:10px;white-space:nowrap;color:var(--dsw-alias-label-secondary)}.dvt-save-row{display:flex;gap:8px;padding:2px 0}
.dvt-health-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.dvt-health-grid>div{padding:9px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border-left:3px solid var(--dsw-alias-border-l4)}.dvt-health-grid>div[data-status=ok]{border-left-color:var(--dsw-alias-state-success-primary)}.dvt-health-grid>div[data-status=warning],.dvt-health-grid>div[data-status=not_tested]{border-left-color:var(--dsw-alias-state-warn-primary)}.dvt-health-grid>div[data-status=error]{border-left-color:var(--dsw-alias-state-error-primary)}.dvt-health-grid span{font-size:10px;text-transform:capitalize}.dvt-health-grid strong{float:right;font-size:9px;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}.dvt-health-grid p{clear:both;margin:5px 0 0;font-size:10px;line-height:1.4;color:var(--dsw-alias-label-secondary)}.dvt-loading{padding:24px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);font-size:12px;color:var(--dsw-alias-label-secondary)}
.dvt-paste-dock{box-sizing:border-box;width:calc(100% - 32px);max-width:var(--dsh-composer-card-max-width,960px);margin:0 auto;display:flex;flex-wrap:wrap;gap:6px;padding:0 2px 6px}.dvt-paste-chip{max-width:100%;height:32px;box-sizing:border-box;display:flex;align-items:center;gap:7px;padding:0 6px 0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-specific-tip);font-size:12px}.dvt-paste-chip[data-status=copying]{border-color:var(--dsw-alias-state-business-primary)}.dvt-paste-chip[data-status=error]{border-color:var(--dsw-alias-state-error-primary)}.dvt-paste-name{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvt-paste-detail{color:var(--dsw-alias-label-caption);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvt-paste-chip[data-status=error] .dvt-paste-detail{color:var(--dsw-alias-state-error-primary)}.dvt-paste-chip button{width:20px;height:20px;display:grid;place-items:center;border:0;border-radius:50%;padding:0;background:transparent;color:var(--dsw-alias-label-caption);font:inherit;font-size:16px;cursor:pointer}.dvt-paste-chip button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dvt-paste-chip button:disabled{opacity:.4;cursor:default}
@media(max-width:720px){.dvt-settings-header{display:grid}.dvt-release{width:auto}.dvt-form-grid{grid-template-columns:1fr}.dvt-metrics{grid-template-columns:1fr}.dvt-artifact-meta{align-items:flex-start;flex-direction:column}.dvt-panel-title{flex-direction:column}}
`;
function installStyles() {
    const id = '@anionex/dsh-vision-toolkit/client';
    const existing = document.querySelector(`style[data-plugin-css="${id}"]`);
    if (existing !== null)
        return () => { };
    const style = document.createElement('style');
    style.dataset.plugin = '@anionex/dsh-vision-toolkit';
    style.dataset.pluginCss = id;
    style.textContent = CSS;
    document.head.appendChild(style);
    return () => { style.remove(); };
}
/** Required client services. The pasted-image codec attaches to either trigger-service generation after load. */
exports.inject = ['slots', 'locale', 'remote', 'conversation', 'sessions'];
/** Register dedicated Tool views and the Vision Settings section. */
function apply(ctx) {
    ctx.effect(installStyles, 'dsh-vision-toolkit: styles');
    ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-vision-toolkit: locale');
    (0, paste_images_tsx_1.installPasteImages)(ctx);
    const t = ctx.locale.bind(NS);
    const injected = () => ({ t });
    const entries = [
        ['vision_ground', GroundView],
        ['vision_detect', DetectView],
        ['vision_trace', TraceView],
        ['vision_pixel_diff', PixelDiffView],
        ['vision_crop', ArtifactView],
        ['vision_long_screenshot_ocr', ArtifactView],
        ['vision_extract_foreground', ArtifactView],
        ['vision_html_screenshot', ArtifactView],
        ['vision_dominant_colors', PaletteView],
    ];
    ctx.slots.inject('tool.call.toolview', function* () {
        for (const [key, component] of entries) {
            yield ctx.slots.register({ name: 'tool.call.toolview', key, inject: injected }, component);
        }
    });
    const controller = new VisionSettingsController();
    ctx.effect(() => {
        const refreshSettings = (namespace) => {
            if (namespace === 'vision-toolkit')
                controller.refreshIfLoaded();
        };
        const refreshCredential = (ref) => {
            const current = controller.snapshot().snapshot;
            if (current?.credential.ref === ref)
                controller.refreshIfLoaded();
        };
        const legacyRemote = ctx.remote;
        const currentEvents = ctx;
        const disposers = typeof legacyRemote.$on === 'function'
            ? [
                legacyRemote.$on('settings/document-updated', refreshSettings),
                legacyRemote.$on('credentials/updated', refreshCredential),
            ]
            : [
                currentEvents.on('settings/changed', (namespace) => {
                    refreshSettings(namespace);
                }),
                currentEvents.on('credentials/changed', (ref) => {
                    refreshCredential(ref);
                }),
            ];
        disposers.push(ctx.on('connection/reset', () => { controller.refreshIfLoaded(); }));
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'dsh-vision-toolkit: Settings invalidations');
    ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'vision-toolkit',
        order: 30,
        label: () => t('nav'),
        inject: () => ({ controller, t }),
    }, SettingsSection));
}
};
__modules["./paste-images.js"] = function(module, exports, require, __load_) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PasteImageController = exports.PASTE_IMAGES_ROUTE = void 0;
exports.PasteImageDock = PasteImageDock;
exports.installPasteImages = installPasteImages;
const jsx_runtime_1 = require("react/jsx-runtime");
/** Clipboard-only multi-image input for DSH Web. */
const react_1 = require("react");
const SOURCE = 'vision-toolkit-pasted-image';
exports.PASTE_IMAGES_ROUTE = '/_dsh/vision-toolkit/paste-images';
const MAX_IMAGES = 20;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_BYTES = 80 * 1024 * 1024;
const CORDIS_ORIGINAL = Symbol.for('cordis.original');
function registryIdentity(registry) {
    let current = registry;
    while (true) {
        const original = current[CORDIS_ORIGINAL];
        if ((typeof original !== 'object' && typeof original !== 'function') || original === null || original === current) {
            return current;
        }
        current = original;
    }
}
let fallbackId = 0;
function id() {
    if (typeof globalThis.crypto?.randomUUID === 'function')
        return globalThis.crypto.randomUUID();
    fallbackId += 1;
    return `paste-${Date.now()}-${fallbackId}`;
}
function humanBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 ** 2)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
function message(error) {
    return error instanceof Error ? error.message : String(error);
}
function imageFiles(data) {
    if (data === null)
        return [];
    const itemFiles = Array.from(data.items)
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .filter((file) => file !== null);
    const candidates = itemFiles.length > 0 ? itemFiles : Array.from(data.files);
    return candidates.filter(file => file.type.toLowerCase().startsWith('image/'));
}
function validateImages(files) {
    if (files.length > MAX_IMAGES)
        throw new Error(`Paste at most ${MAX_IMAGES} images at a time`);
    let total = 0;
    for (const file of files) {
        if (!file.type.toLowerCase().startsWith('image/'))
            throw new Error(`${file.name || 'clipboard item'} is not an image`);
        if (file.size <= 0)
            throw new Error(`${file.name || 'clipboard image'} is empty`);
        if (file.size > MAX_IMAGE_BYTES)
            throw new Error(`${file.name || 'clipboard image'} exceeds ${humanBytes(MAX_IMAGE_BYTES)}`);
        total += file.size;
    }
    if (total > MAX_BATCH_BYTES)
        throw new Error(`Pasted images exceed ${humanBytes(MAX_BATCH_BYTES)} in total`);
}
async function responseJson(response) {
    const body = await response.json();
    if (!response.ok || body.ok !== true)
        throw new Error(body.error?.message ?? `Image copy failed (${response.status})`);
    return body;
}
function pasteLabel(file, index) {
    return file.name.trim() || `clipboard-image-${index + 1}`;
}
/** Owns browser File objects until DSH serializes the corresponding text references. */
class PasteImageController {
    ctx;
    records = new Map();
    listeners = new Set();
    revision = 0;
    constructor(ctx) {
        this.ctx = ctx;
    }
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    snapshot = () => this.revision;
    changed() {
        this.revision += 1;
        for (const listener of this.listeners)
            listener();
    }
    source() {
        return {
            trigger: '@',
            name: SOURCE,
            order: 1000,
            candidates: () => Promise.resolve([]),
            onPick: () => undefined,
            codec: {
                clipboardText: ref => `[pasted image: ${this.records.get(ref)?.file.name ?? ref}]`,
                serialize: (ref, signal) => this.serialize(ref, signal),
            },
        };
    }
    recordsFor(occurrences) {
        return occurrences
            .filter(occurrence => occurrence.source === SOURCE)
            .map(occurrence => this.records.get(occurrence.ref))
            .filter((record) => record !== undefined);
    }
    inputFor(sessionId) {
        const actx = this.ctx.sessions.scope(sessionId);
        if (actx === undefined)
            throw new Error('Open a live session before pasting images');
        return this.ctx.conversation.input.for(actx);
    }
    insertText(input, text, start, end = start) {
        if (text === '')
            return start;
        const snapshot = input.state.getSnapshot();
        input.setDraft(snapshot.draft.slice(0, start) + text + snapshot.draft.slice(end));
        return start + text.length;
    }
    insertRecords(sessionId, input, files, cursor) {
        const batch = { sessionId, records: [] };
        const draftBeforeReferences = input.state.getSnapshot().draft;
        try {
            const before = input.state.getSnapshot().draft.slice(0, cursor);
            if (before !== '' && !/\s$/u.test(before))
                cursor = this.insertText(input, ' ', cursor);
            for (const [index, file] of files.entries()) {
                const ref = id();
                const record = { ref, file, batch, status: 'ready' };
                batch.records.push(record);
                this.records.set(ref, record);
                const snapshot = input.state.getSnapshot();
                const accepted = input.insertReference({
                    source: SOURCE,
                    ref,
                    label: pasteLabel(file, index),
                    clipboardText: `[pasted image: ${pasteLabel(file, index)}]`,
                }, { start: cursor, end: cursor, draftRev: snapshot.draftRev });
                if (!accepted)
                    throw new Error('The composer changed before pasted images could be inserted');
                cursor += 1;
                const hasNext = index + 1 < files.length;
                const suffix = input.state.getSnapshot().draft.slice(cursor);
                if (hasNext || (suffix !== '' && !/^\s/u.test(suffix)))
                    cursor = this.insertText(input, ' ', cursor);
            }
            batch.unsubscribe = input.state.subscribe(() => {
                const alive = new Set(input.state.getSnapshot().occurrences
                    .filter(occurrence => occurrence.source === SOURCE)
                    .map(occurrence => occurrence.ref));
                let changed = false;
                for (const record of batch.records) {
                    if (alive.has(record.ref) || record.batch.inflight !== undefined)
                        continue;
                    changed = this.records.delete(record.ref) || changed;
                }
                if (batch.records.every(record => !this.records.has(record.ref)) && batch.inflight === undefined) {
                    batch.unsubscribe?.();
                    batch.unsubscribe = undefined;
                }
                if (changed)
                    this.changed();
            });
            this.changed();
            return cursor;
        }
        catch (error) {
            input.setDraft(draftBeforeReferences);
            for (const record of batch.records)
                this.records.delete(record.ref);
            throw error;
        }
    }
    handlePaste(event) {
        const files = imageFiles(event.clipboardData);
        if (files.length === 0)
            return false;
        const target = event.target;
        if (!(target instanceof HTMLTextAreaElement) || target.closest('[data-composer-card]') === null)
            return false;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const sessionId = this.ctx.sessions.list.getSnapshot().current;
        if (sessionId === undefined)
            return true;
        const input = this.inputFor(sessionId);
        const snapshot = input.state.getSnapshot();
        if (snapshot.phase !== 'plain')
            return true;
        const start = Math.max(0, Math.min(target.selectionStart ?? snapshot.draft.length, snapshot.draft.length));
        const end = Math.max(start, Math.min(target.selectionEnd ?? start, snapshot.draft.length));
        const text = (event.clipboardData?.getData('text/plain') ?? '').replaceAll('\uFFFC', '');
        try {
            let cursor = this.insertText(input, text, start, end);
            validateImages(files);
            cursor = this.insertRecords(String(sessionId), input, files, cursor);
            requestAnimationFrame(() => {
                target.focus({ preventScroll: true });
                target.setSelectionRange(cursor, cursor);
            });
        }
        catch (error) {
            input.notify('error', message(error));
        }
        return true;
    }
    remove(sessionId, occurrence) {
        const record = this.records.get(occurrence.ref);
        if (record?.batch.inflight !== undefined)
            return;
        const input = this.inputFor(sessionId);
        const snapshot = input.state.getSnapshot();
        if (snapshot.phase !== 'plain')
            return;
        const current = snapshot.occurrences.find(candidate => candidate.source === SOURCE
            && candidate.occurrenceId === occurrence.occurrenceId
            && candidate.ref === occurrence.ref);
        if (current === undefined)
            return;
        const accepted = input.insertText('', {
            start: current.offset,
            end: current.offset + 1,
            draftRev: snapshot.draftRev,
        });
        if (!accepted)
            return;
        this.records.delete(occurrence.ref);
        this.changed();
    }
    async upload(batch, signal) {
        if (batch.inflight !== undefined)
            return batch.inflight;
        const active = batch.records.filter(record => this.records.get(record.ref) === record);
        if (active.length === 0)
            throw new Error('Pasted images were removed before sending');
        const pending = active.filter(record => record.absolutePath === undefined);
        if (pending.length === 0)
            return;
        const task = (async () => {
            for (const record of pending) {
                record.status = 'copying';
                record.error = undefined;
            }
            this.changed();
            try {
                const failures = await Promise.all(pending.map(async (record) => {
                    try {
                        if (signal.aborted)
                            throw signal.reason ?? new DOMException('Aborted', 'AbortError');
                        const query = new URLSearchParams({
                            sessionId: batch.sessionId,
                            name: record.file.name || 'clipboard-image',
                            size: String(record.file.size),
                        });
                        const body = await responseJson(await fetch(`${exports.PASTE_IMAGES_ROUTE}?${query.toString()}`, {
                            method: 'POST',
                            headers: { 'Content-Type': record.file.type },
                            body: record.file,
                            signal,
                        }));
                        const absolutePath = body.value?.absolutePath;
                        if (typeof absolutePath !== 'string' || absolutePath === '') {
                            throw new Error('Image copy response contained an invalid path');
                        }
                        record.absolutePath = absolutePath;
                        record.status = 'copied';
                        record.error = undefined;
                        return undefined;
                    }
                    catch (error) {
                        const failure = error instanceof Error ? error : new Error(message(error));
                        record.status = 'error';
                        record.error = failure.message;
                        return failure;
                    }
                }));
                this.changed();
                const failure = failures.find((error) => error !== undefined);
                if (failure !== undefined)
                    throw failure;
            }
            finally {
                batch.inflight = undefined;
                this.changed();
            }
        })();
        batch.inflight = task;
        return task;
    }
    async serialize(ref, signal) {
        const record = this.records.get(ref);
        if (record === undefined)
            throw new Error('Pasted image is no longer available in this browser tab');
        await this.upload(record.batch, signal);
        if (record.absolutePath === undefined)
            throw new Error('Pasted image was not copied into the workspace');
        return `[Pasted image available at absolute path: ${JSON.stringify(record.absolutePath)}]`;
    }
}
exports.PasteImageController = PasteImageController;
/** Minimal per-image progress, failure, and removal feedback above the composer. */
function PasteImageDock(props) {
    (0, react_1.useSyncExternalStore)(props.controller.subscribe, props.controller.snapshot);
    const occurrences = props.input.occurrences.filter(occurrence => occurrence.source === SOURCE);
    const records = props.controller.recordsFor(occurrences);
    if (records.length === 0)
        return null;
    return (0, jsx_runtime_1.jsx)("div", { className: "dvt-paste-dock", role: "status", "aria-label": "Pasted images", children: occurrences.map((occurrence) => {
            const record = props.controller.recordsFor([occurrence])[0];
            if (record === undefined)
                return null;
            const detail = record.status === 'copying' ? 'copying…'
                : record.status === 'copied' ? 'copied'
                    : record.status === 'error' ? record.error ?? 'copy failed'
                        : humanBytes(record.file.size);
            return (0, jsx_runtime_1.jsxs)("div", { className: "dvt-paste-chip", "data-status": record.status, children: [(0, jsx_runtime_1.jsx)("span", { className: "dvt-paste-name", title: record.file.name, children: record.file.name || 'clipboard image' }), (0, jsx_runtime_1.jsx)("span", { className: "dvt-paste-detail", title: record.error, children: detail }), (0, jsx_runtime_1.jsx)("button", { type: "button", "aria-label": `Remove ${record.file.name || 'clipboard image'}`, disabled: props.input.phase !== 'plain' || record.status === 'copying', onClick: () => { props.remove(occurrence); }, children: "\u00D7" })] }, occurrence.occurrenceId);
        }) });
}
/** Install capture interception, the text-reference codec, and composer feedback. */
function installPasteImages(ctx) {
    const controller = new PasteImageController(ctx);
    const registered = new WeakMap();
    const register = (scope, registry) => {
        scope.effect(() => {
            const identity = registryIdentity(registry);
            let registration = registered.get(identity);
            if (registration === undefined) {
                registration = { dispose: registry.registerSource(controller.source()), owners: 0 };
                registered.set(identity, registration);
            }
            registration.owners += 1;
            return () => {
                if (registered.get(identity) !== registration)
                    return;
                registration.owners -= 1;
                if (registration.owners > 0)
                    return;
                registered.delete(identity);
                registration.dispose();
            };
        }, 'dsh-vision-toolkit: pasted image reference codec');
    };
    ctx.inject(['slash'], (scope) => {
        register(scope, scope.slash);
    });
    ctx.inject(['inputTriggers'], (scope) => {
        register(scope, scope.inputTriggers);
    });
    ctx.effect(() => {
        const listener = (event) => { controller.handlePaste(event); };
        document.addEventListener('paste', listener, true);
        return () => { document.removeEventListener('paste', listener, true); };
    }, 'dsh-vision-toolkit: clipboard image capture');
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'vision-toolkit-pasted-images',
        order: 6,
        inject: sessionId => ({
            controller,
            remove: (occurrence) => { controller.remove(String(sessionId), occurrence); },
        }),
    }, PasteImageDock));
}
};
function __resolve(from, request) {
  if (!request.startsWith(".")) return request;
  var parts = from.slice(2).split("/"); parts.pop();
  for (var part of request.split("/")) { if (part === "." || part === "") continue; if (part === "..") parts.pop(); else parts.push(part); }
  return "./" + parts.join("/");
}
function __load(id) {
  if (__modules[id] === undefined) return require(id);
  if (__cache[id] !== undefined) return __cache[id].exports;
  var module = __cache[id] = { exports: {} };
  __modules[id](module, module.exports, require, function(request) { var resolved = __resolve(id, request); return __modules[resolved] === undefined ? require(request) : __load(resolved); });
  return module.exports;
}
return __load("./index.js"); } });
//# sourceMappingURL=client.js.map
