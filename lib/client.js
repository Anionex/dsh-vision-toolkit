window.__ModuleLoader__.load({ id: "@anionex/dsh-vision-toolkit", factory: (require) => {
var __modules = Object.create(null); var __cache = Object.create(null);
__modules["./display-config.js"] = function(module, exports, require, __load_) {
"use strict";
/**
 * Browser-side display-mode flags for transparent variant routing. The paste
 * integration uses a short-lived cache so it does not hammer the same-origin
 * route on every paste. The model selector itself decides purely from DOM
 * display names and does not read this route.
 * @module dsh-vision-toolkit/display-config
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DISPLAY_CONFIG_ROUTE = void 0;
exports.readDisplayConfig = readDisplayConfig;
exports.resetDisplayConfigCache = resetDisplayConfigCache;
exports.DISPLAY_CONFIG_ROUTE = '/_dsh/vision-toolkit/display-config';
const CONFIG_TTL_MS = 10_000;
let cached;
let cacheEpoch = 0;
/**
 * Resolve the current transparent-routing flag, failing closed to non-hidden
 * (explicit sibling entries) when the route is unreachable or the payload is
 * malformed.
 * @returns the display-mode flags observed from the host.
 */
async function readDisplayConfig() {
    for (;;) {
        const now = Date.now();
        if (cached !== undefined && now - cached.at < CONFIG_TTL_MS) {
            return { hidden: cached.hidden };
        }
        const epoch = cacheEpoch;
        try {
            const response = await fetch(exports.DISPLAY_CONFIG_ROUTE, { cache: 'no-store' });
            if (epoch !== cacheEpoch)
                continue;
            const body = await response.json();
            if (epoch !== cacheEpoch)
                continue;
            if (body.ok !== true || typeof body.value?.hidden !== 'boolean') {
                throw new Error('malformed display-config payload');
            }
            cached = { hidden: body.value.hidden, at: now };
            return { hidden: body.value.hidden };
        }
        catch {
            if (epoch !== cacheEpoch)
                continue;
            // Transparent routing is an enhancement: an unreachable config must never
            // hide anything or change paste behavior.
            cached = { hidden: false, at: now };
            return { hidden: false };
        }
    }
}
/**
 * Drop the cached flag and invalidate in-flight responses (test seams,
 * Settings saves, and connection-reset handling). An older request that
 * resolves afterwards must not repopulate the cache with a stale flag.
 */
function resetDisplayConfigCache() {
    cached = undefined;
    cacheEpoch += 1;
}
};
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
const model_variants_hider_ts_1 = __load_("./model-variants-hider.js");
const display_config_ts_1 = __load_("./display-config.js");
const NS = 'vision-toolkit';
const SETTINGS_ROUTE = '/_dsh/vision-toolkit/settings';
const PRESENTATION_META_KEY = '$dshVisionToolkit';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
// Keep these browser defaults aligned with src/defaults.ts without importing server-side config.
const BUILT_IN_FREE_VISION_BASE_URL = 'https://vision.anionex.me/v1';
const BUILT_IN_FREE_VISION_CREDENTIAL = 'ANIONEX_FREE_VISION';
const BUILT_IN_FREE_VISION_MODEL = 'gemini-3.7-flash';
const GROQ_TUTORIAL_URL_EN = 'https://github.com/Anionex/dsh-vision-toolkit/blob/main/docs/groq-qwen3.6-vision.md';
const GROQ_TUTORIAL_URL_ZH = 'https://github.com/Anionex/dsh-vision-toolkit/blob/main/docs/groq-qwen3.6-vision.zh.md';
const en = {
    nav: 'Vision',
    settingsTitle: 'Vision Toolkit',
    settingsIntro: 'Configure the pinned visual engineering runtime, its external vision endpoint, and local safety limits.',
    externalNotice: 'Remote tools send the selected image bytes to the configured external vision API. Local crop, trace, pixel diff, palette, foreground extraction, and HTML rendering do not upload images.',
    provider: 'Vision service',
    providerHint: 'Choose the API protocol, then provide the service address, model, and API key used by online vision features.',
    groqTutorial: 'Want a free Groq key for Qwen3.6-27B vision? Follow the step-by-step tutorial →',
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
    imageInput: 'Image input',
    hiddenVariants: 'Transparent variant routing',
    hiddenVariantsLabel: 'Keep the original model names and enable images automatically',
    hiddenVariantsHint: 'Text-only models keep one model-selector entry with the original name while the session runs on the image-capable variant. Pasted images, image history, and the built-in read_image tool keep working; disable to restore the explicit (Vision Toolkit) entries.',
    pluginVersion: 'Plugin',
    upstreamVersion: 'Upstream',
    activeGeneration: 'Runtime generation',
    activeGenerationValue: 'Generation {generation}',
    updates: 'Plugin updates',
    updatesHint: 'Check npm for a newer release, install it into this DSH profile, and restart DSH Web automatically.',
    manualUpdate: 'Manual update',
    manualUpdateHint: 'Run this command in your terminal to install the latest release into this DSH profile.',
    copy: 'Copy',
    copied: 'Copied',
    checkUpdate: 'Check for updates',
    checkingUpdate: 'Checking for updates…',
    updateAvailable: 'Update available',
    updateAvailableDetail: 'Version {version} is available. It will restart DSH Web automatically when safe; otherwise you will be asked to restart it manually.',
    upToDate: 'Up to date',
    upToDateDetail: 'Version {version} is the latest release.',
    updateNow: 'Install update',
    updatingPlugin: 'Installing update…',
    updateConfirm: 'Install Vision Toolkit {version} now? DSH Web will restart automatically when supported; otherwise a manual restart will be required.',
    restarting: 'Version {version} was installed. Waiting for DSH Web to restart…',
    manualRestartRequired: 'Version {version} was installed. Restart DSH Web through your usual command or process manager to activate it.',
    updateProfile: 'Profile',
    updateInstalled: 'Installed',
    updateLatest: 'Latest',
    updateUnsupported: 'In-app updates are unavailable for this installation.',
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
    healthServiceForbidden: 'Service is reachable, but GET /models is restricted (HTTP {status}). This is often an account or model-list permission limit, not an invalid key; you can ignore this warning when the vision-model test reports success.',
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
};
const zh = {
    nav: '视觉工具',
    settingsTitle: '视觉工具箱',
    settingsIntro: '在这里设置视觉模型服务、工具运行环境，以及图片和文件的本地访问范围。',
    externalNotice: '使用图像理解、目标定位、界面检测或文字识别等在线功能时，所选图片会发送到下方配置的视觉服务。图片裁剪、轮廓描摹、像素对比、主色提取、前景提取和网页截图均在本机完成，不会上传图片。',
    provider: '在线视觉服务',
    providerHint: '选择接口协议后，填写在线视觉功能使用的 API 地址、模型名称和 API 密钥。',
    groqTutorial: '想免费申请 Groq Key 并用 Qwen3.6-27B 识图？看这篇图文教程 →',
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
    imageInput: '图片输入',
    hiddenVariants: '透明变体路由',
    hiddenVariantsLabel: '保留原模型名并自动启用图片能力',
    hiddenVariantsHint: '文本模型在模型列表中只显示原名称，会话实际运行在支持图片的变体路由上：粘贴图片、历史图片和内置 read_image 工具均可正常使用。关闭后恢复显示显式的（Vision Toolkit）条目。',
    pluginVersion: '插件版本',
    upstreamVersion: '工具包版本',
    activeGeneration: '本次运行已应用',
    activeGenerationValue: '{generation} 次',
    updates: '插件更新',
    updatesHint: '检查 npm 新版本，自动更新当前 DSH Profile 中的插件，然后重启 DSH Web。',
    manualUpdate: '手动更新',
    manualUpdateHint: '在终端运行以下命令，将当前 DSH Profile 更新到最新版本。',
    copy: '复制',
    copied: '已复制',
    checkUpdate: '检查更新',
    checkingUpdate: '正在检查更新…',
    updateAvailable: '发现新版本',
    updateAvailableDetail: '可更新到 {version}。能安全自重启时会自动重启，否则安装完成后会提示你手动重启。',
    upToDate: '已是最新版',
    upToDateDetail: '当前 {version} 已是最新正式版本。',
    updateNow: '安装更新',
    updatingPlugin: '正在安装更新…',
    updateConfirm: '现在安装 Vision Toolkit {version} 吗？支持安全自重启时会自动重启，否则需要你手动重启 DSH Web。',
    restarting: '已安装 {version}，正在等待 DSH Web 重启…',
    manualRestartRequired: '已安装 {version}。请按你平时的方式手动重启 DSH Web，重启后新版本生效。',
    updateProfile: 'Profile',
    updateInstalled: '当前版本',
    updateLatest: '最新版本',
    updateUnsupported: '当前安装方式不支持页面内更新。',
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
    healthServiceForbidden: '服务可以访问，但对 GET /models 的访问被限制（HTTP {status}）。这通常是账号或模型列表权限限制，不代表密钥无效；若“视觉模型已实测正常”，此警告可忽略。',
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
    const description = artifactDescription(artifact.description, t);
    return ((0, jsx_runtime_1.jsxs)("article", { className: "dvt-artifact", children: [canPreview
                ? artifact.kind === 'svg'
                    ? (0, jsx_runtime_1.jsx)("iframe", { className: "dvt-preview dvt-svg", sandbox: "", src: grant.previewUrl, title: description })
                    : (0, jsx_runtime_1.jsx)("img", { className: "dvt-preview", src: grant.previewUrl, alt: description, loading: "lazy" })
                : null, (0, jsx_runtime_1.jsxs)("div", { className: "dvt-artifact-meta", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("strong", { children: artifact.filename }), (0, jsx_runtime_1.jsx)("span", { children: description }), (0, jsx_runtime_1.jsxs)("small", { children: [artifact.mimeType, " \u00B7 ", formatBytes(artifact.bytes)] })] }), (0, jsx_runtime_1.jsx)(ArtifactActions, { artifact: artifact, grant: grant, openFile: openFile, t: t })] }), !canPreview && grant === undefined ? (0, jsx_runtime_1.jsx)("p", { className: "dvt-muted", children: t('previewUnavailable') }) : null] }));
}
const ARTIFACT_DESCRIPTION_KEYS = {
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
};
function artifactDescription(description, t) {
    const key = ARTIFACT_DESCRIPTION_KEYS[description];
    if (key !== undefined) {
        const translated = t(key);
        return translated === key ? description : translated;
    }
    let match = /^Long-screenshot OCR chunk (\d+)$/u.exec(description);
    if (match !== null) {
        const translated = t('artifactLongChunk', { index: match[1] });
        return translated === 'artifactLongChunk' ? description : translated;
    }
    match = /^OCR sidecar for chunk (\d+)$/u.exec(description);
    if (match !== null) {
        const translated = t('artifactOcrSidecar', { index: match[1] });
        return translated === 'artifactOcrSidecar' ? description : translated;
    }
    return description;
}
function GroundView({ block, openFile, t = key => en[key] }) {
    const value = decodeVisionResult(block);
    const matches = Array.isArray(value?.matches) ? value.matches.filter(isRecord) : [];
    const target = stringOf(value?.target) ?? t('groundTitle');
    const width = numberOf(value?.imageWidth);
    const height = numberOf(value?.imageHeight);
    const preview = artifactFrom(value?.preview);
    const grants = accessMap(value);
    return ((0, jsx_runtime_1.jsx)(ToolShell, { block: block, title: t('groundTitle'), summary: matches.length > 0 ? `${target} · ${matches.length} ${t('matches')}` : target, icon: (0, jsx_runtime_1.jsx)(VisionIcon, { kind: "target" }), t: t, children: value === undefined ? (0, jsx_runtime_1.jsx)("p", { className: "dvt-muted", children: t('noResult') }) : ((0, jsx_runtime_1.jsxs)("div", { className: "dvt-stack", children: [(0, jsx_runtime_1.jsxs)("div", { className: "dvt-metrics", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { children: t('dimensions') }), (0, jsx_runtime_1.jsxs)("strong", { children: [width ?? '—', " \u00D7 ", height ?? '—'] })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { children: t('coordinates') }), (0, jsx_runtime_1.jsx)("strong", { children: matches[0] === undefined ? '—' : boxText(matches[0].box) })] })] }), matches.length > 1 ? ((0, jsx_runtime_1.jsx)("ol", { className: "dvt-list", children: matches.map((match, index) => (0, jsx_runtime_1.jsxs)("li", { children: [(0, jsx_runtime_1.jsx)("span", { children: stringOf(match.label) ?? `#${index + 1}` }), (0, jsx_runtime_1.jsx)("code", { children: boxText(match.box) })] }, index)) })) : null, preview === undefined ? null : (0, jsx_runtime_1.jsx)(ArtifactPreview, { artifact: preview, grant: grants.get(preview.path), openFile: openFile, t: t })] })) }));
}
function DetectView({ block, openFile, t = key => en[key] }) {
    const value = decodeVisionResult(block);
    const elements = Array.isArray(value?.elements) ? value.elements.filter(isRecord) : [];
    const width = numberOf(value?.imageWidth);
    const height = numberOf(value?.imageHeight);
    const preview = artifactFrom(value?.preview);
    const grants = accessMap(value);
    return ((0, jsx_runtime_1.jsx)(ToolShell, { block: block, title: t('detectTitle'), summary: `${elements.length} ${t('elements')}`, icon: (0, jsx_runtime_1.jsx)(VisionIcon, { kind: "layers" }), t: t, children: value === undefined ? (0, jsx_runtime_1.jsx)("p", { className: "dvt-muted", children: t('noResult') }) : ((0, jsx_runtime_1.jsxs)("div", { className: "dvt-stack", children: [(0, jsx_runtime_1.jsxs)("div", { className: "dvt-metrics", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { children: t('dimensions') }), (0, jsx_runtime_1.jsxs)("strong", { children: [width ?? '—', " \u00D7 ", height ?? '—'] })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { children: t('elements') }), (0, jsx_runtime_1.jsx)("strong", { children: elements.length })] })] }), (0, jsx_runtime_1.jsx)("div", { className: "dvt-table-wrap", children: (0, jsx_runtime_1.jsxs)("table", { className: "dvt-table", children: [(0, jsx_runtime_1.jsx)("thead", { children: (0, jsx_runtime_1.jsxs)("tr", { children: [(0, jsx_runtime_1.jsx)("th", { children: "#" }), (0, jsx_runtime_1.jsx)("th", { children: t('label') }), (0, jsx_runtime_1.jsx)("th", { children: t('coordinates') })] }) }), (0, jsx_runtime_1.jsx)("tbody", { children: elements.map((element, index) => (0, jsx_runtime_1.jsxs)("tr", { children: [(0, jsx_runtime_1.jsx)("td", { children: numberOf(element.index) ?? index + 1 }), (0, jsx_runtime_1.jsx)("td", { children: stringOf(element.label) ?? '—' }), (0, jsx_runtime_1.jsx)("td", { children: (0, jsx_runtime_1.jsx)("code", { children: boxText(element.box) }) })] }, index)) })] }) }), preview === undefined ? null : (0, jsx_runtime_1.jsx)(ArtifactPreview, { artifact: preview, grant: grants.get(preview.path), openFile: openFile, t: t })] })) }));
}
function TraceView({ block, openFile, t = key => en[key] }) {
    const value = decodeVisionResult(block);
    const artifact = artifactFrom(value?.artifact);
    const geometry = isRecord(value?.geometry) ? value.geometry : undefined;
    const summary = geometry === undefined ? undefined : `${numberOf(geometry.pathCount) ?? 0} ${t('paths')} · ${formatBytes(numberOf(geometry.bytes) ?? 0)}`;
    const grants = accessMap(value);
    return ((0, jsx_runtime_1.jsx)(ToolShell, { block: block, title: t('traceTitle'), summary: summary, icon: (0, jsx_runtime_1.jsx)(VisionIcon, { kind: "shape" }), t: t, children: artifact === undefined ? (0, jsx_runtime_1.jsx)("p", { className: "dvt-muted", children: t('noResult') }) : (0, jsx_runtime_1.jsx)(ArtifactPreview, { artifact: artifact, grant: grants.get(artifact.path), openFile: openFile, t: t }) }));
}
function PixelDiffView({ block, openFile, t = key => en[key] }) {
    const value = decodeVisionResult(block);
    const pct = numberOf(value?.overallDifferencePct);
    const regions = Array.isArray(value?.worstRegions) ? value.worstRegions.filter(isRecord) : [];
    const heatmap = artifactFrom(value?.heatmap);
    const report = artifactFrom(value?.report);
    const grants = accessMap(value);
    return ((0, jsx_runtime_1.jsx)(ToolShell, { block: block, title: t('pixelDiffTitle'), summary: pct === undefined ? undefined : `${pct.toFixed(3)}%`, icon: (0, jsx_runtime_1.jsx)(VisionIcon, { kind: "diff" }), t: t, children: value === undefined ? (0, jsx_runtime_1.jsx)("p", { className: "dvt-muted", children: t('noResult') }) : ((0, jsx_runtime_1.jsxs)("div", { className: "dvt-stack", children: [(0, jsx_runtime_1.jsxs)("div", { className: "dvt-diff-score", children: [(0, jsx_runtime_1.jsx)("span", { children: t('difference') }), (0, jsx_runtime_1.jsxs)("strong", { children: [pct?.toFixed(4) ?? '—', "%"] }), (0, jsx_runtime_1.jsx)("div", { children: (0, jsx_runtime_1.jsx)("i", { style: { width: `${Math.min(100, Math.max(0, pct ?? 0))}%` } }) })] }), regions.length === 0 ? null : (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h4", { children: t('worstRegions') }), (0, jsx_runtime_1.jsx)("ol", { className: "dvt-list", children: regions.map((region, index) => (0, jsx_runtime_1.jsxs)("li", { children: [(0, jsx_runtime_1.jsxs)("span", { children: [(numberOf(region.differencePct) ?? 0).toFixed(3), "%"] }), (0, jsx_runtime_1.jsx)("code", { children: boxText(region.box) })] }, index)) })] }), heatmap === undefined ? null : (0, jsx_runtime_1.jsx)(ArtifactPreview, { artifact: heatmap, grant: grants.get(heatmap.path), openFile: openFile, t: t }), report === undefined ? null : (0, jsx_runtime_1.jsx)(ArtifactPreview, { artifact: report, grant: grants.get(report.path), openFile: openFile, t: t })] })) }));
}
function ArtifactView({ block, openFile, toolName, t = key => en[key] }) {
    const value = decodeVisionResult(block);
    const artifacts = collectArtifacts(value);
    const grants = accessMap(value);
    const title = toolName === 'vision_crop' ? t('cropTitle')
        : toolName === 'vision_long_screenshot_ocr' ? t('longOcrTitle')
            : toolName === 'vision_extract_foreground' ? t('extractForegroundTitle')
                : toolName === 'vision_html_screenshot' ? t('htmlScreenshotTitle')
                    : t('artifactTitle');
    return ((0, jsx_runtime_1.jsx)(ToolShell, { block: block, title: title, summary: artifacts.length > 0 ? `${artifacts.length} ${t('artifacts')}` : undefined, icon: (0, jsx_runtime_1.jsx)(VisionIcon, {}), t: t, children: artifacts.length === 0 ? (0, jsx_runtime_1.jsx)("p", { className: "dvt-muted", children: t('noResult') }) : (0, jsx_runtime_1.jsx)("div", { className: "dvt-stack", children: artifacts.map(artifact => (0, jsx_runtime_1.jsx)(ArtifactPreview, { artifact: artifact, grant: grants.get(artifact.path), openFile: openFile, t: t }, artifact.path)) }) }));
}
function PaletteView({ block, t = key => en[key] }) {
    const value = decodeVisionResult(block);
    const analysis = isRecord(value?.analysis) ? value.analysis : undefined;
    const colors = Array.isArray(analysis?.colors) ? analysis.colors.filter(isRecord) : [];
    return ((0, jsx_runtime_1.jsx)(ToolShell, { block: block, title: t('dominantColorsTitle'), summary: `${colors.length} ${t('colors')}`, icon: (0, jsx_runtime_1.jsx)(VisionIcon, { kind: "palette" }), t: t, children: colors.length === 0 ? (0, jsx_runtime_1.jsx)("p", { className: "dvt-muted", children: t('noResult') }) : (0, jsx_runtime_1.jsx)("div", { className: "dvt-palette", children: colors.map((color, index) => {
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
            this.set({
                status: 'ready',
                snapshot,
                health: this.state.health,
                update: this.state.update,
                restart: this.state.restart,
            });
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
    async save(value, expectedRevision, credentialValue, writeSettings) {
        this.set({ ...this.state, action: 'save', error: undefined, message: undefined });
        let snapshot = this.state.snapshot;
        try {
            if (writeSettings) {
                snapshot = await apiRequest({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'save', expectedRevision, value }),
                });
            }
            if (snapshot === undefined)
                throw new Error('Vision Toolkit Settings are unavailable');
            if (credentialValue !== undefined) {
                try {
                    snapshot = await apiRequest({
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: 'credential',
                            expectedRevision: snapshot.settings.revision,
                            ref: snapshot.credential.ref,
                            value: credentialValue,
                        }),
                    });
                }
                catch (error) {
                    this.set({
                        status: 'ready',
                        snapshot,
                        health: this.state.health,
                        update: this.state.update,
                        restart: this.state.restart,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    return false;
                }
            }
            this.set({
                status: 'ready',
                snapshot,
                health: this.state.health,
                update: this.state.update,
                restart: this.state.restart,
                message: 'saved',
            });
            return true;
        }
        catch (error) {
            this.set({ ...this.state, action: undefined, error: error instanceof Error ? error.message : String(error) });
            return false;
        }
        finally {
            // The backend commits the generation before the response is readable, so
            // the browser cache must not keep serving the previous hidden flag.
            (0, display_config_ts_1.resetDisplayConfigCache)();
        }
    }
    async runHealth(mode) {
        const testConnection = mode !== 'health';
        const testModel = mode === 'model';
        this.set({ ...this.state, action: mode, error: undefined, message: undefined });
        try {
            const health = await apiRequest({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'health', testConnection, testModel }),
            });
            this.set({ ...this.state, action: undefined, health });
        }
        catch (error) {
            this.set({ ...this.state, action: undefined, error: error instanceof Error ? error.message : String(error) });
        }
    }
    async checkUpdate() {
        this.set({ ...this.state, action: 'check-update', error: undefined, message: undefined });
        try {
            const update = await apiRequest({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'check-update' }),
            });
            this.set({ ...this.state, action: undefined, update });
        }
        catch (error) {
            this.set({ ...this.state, action: undefined, error: error instanceof Error ? error.message : String(error) });
        }
    }
    async applyUpdate(expectedVersion) {
        this.set({ ...this.state, action: 'apply-update', error: undefined, message: undefined });
        try {
            const result = await apiRequest({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'apply-update', expectedVersion }),
            });
            this.set({
                ...this.state,
                action: undefined,
                restart: result,
                message: result.restarting ? 'restarting' : 'manual-restart-required',
            });
        }
        catch (error) {
            this.set({ ...this.state, action: undefined, error: error instanceof Error ? error.message : String(error) });
        }
    }
    reportRestartTimeout(message) {
        this.set({ ...this.state, restart: undefined, message: undefined, error: message });
    }
}
exports.VisionSettingsController = VisionSettingsController;
function draftOf(value) {
    return {
        baseUrl: value.provider?.baseUrl ?? BUILT_IN_FREE_VISION_BASE_URL,
        credential: value.provider?.credential ?? BUILT_IN_FREE_VISION_CREDENTIAL,
        model: value.provider?.model ?? BUILT_IN_FREE_VISION_MODEL,
        protocol: value.provider?.protocol ?? 'openai',
        anthropicThinking: value.provider?.anthropicThinking ?? 'omit',
        userAgent: value.provider?.userAgent ?? DEFAULT_USER_AGENT,
        language: value.language ?? 'zh',
        timeoutMs: String(value.timeoutMs ?? 30000),
        maxImageBytes: String(value.maxImageBytes ?? 4194304),
        maxImagePixels: String(value.maxImagePixels ?? 20000000),
        concurrency: String(value.concurrency ?? 4),
        runtimeMode: value.runtime?.mode ?? 'managed',
        toolkitPath: value.runtime?.agentVisionToolkitPath ?? '',
        python: value.runtime?.python ?? '',
        allowedDirs: (value.allowedDirs ?? []).join('\n'),
        hiddenVariants: value.imageInputVariants?.hidden ?? true,
        variantEnabled: value.imageInputVariants?.enabled ?? true,
        variantProviders: (value.imageInputVariants?.providers ?? []).join('\n'),
        variantAutoSwitch: value.imageInputVariants?.autoSwitch ?? true,
    };
}
function positiveInteger(raw, label, t) {
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0)
        throw new Error(t('positiveInteger', { field: label }));
    return value;
}
function apiKeyFailure(value, t) {
    if (value.length === 0)
        return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0)
        return t('apiKeyBlank');
    const quoted = trimmed.length > 1 && ['"', '\'', '`'].includes(trimmed[0] ?? '') && trimmed.endsWith(trimmed[0] ?? '');
    const environmentLine = /^[A-Z][A-Z0-9_]*=[^=]/u.test(trimmed);
    if (quoted || environmentLine || !/^[\x21-\x7E]+$/u.test(trimmed))
        return t('apiKeyInvalid');
    return undefined;
}
function valueOf(draft, t) {
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
        imageInputVariants: {
            ...(draft.variantEnabled ? {} : { enabled: false }),
            ...(draft.variantProviders.trim().length === 0 ? {} : {
                providers: draft.variantProviders.split(/\r?\n/).map(entry => entry.trim()).filter(Boolean),
            }),
            ...(draft.variantAutoSwitch ? {} : { autoSwitch: false }),
            hidden: draft.hiddenVariants,
        },
    };
}
function settingsDraftChanged(draft, saved, t) {
    try {
        return JSON.stringify(valueOf(draft, t)) !== JSON.stringify(valueOf(draftOf(saved), t));
    }
    catch {
        return true;
    }
}
function isBuiltInFreeVisionDraft(draft) {
    return draft.baseUrl.trim().replace(/\/+$/, '') === BUILT_IN_FREE_VISION_BASE_URL
        && draft.credential.trim() === BUILT_IN_FREE_VISION_CREDENTIAL
        && draft.model.trim() === BUILT_IN_FREE_VISION_MODEL
        && draft.protocol === 'openai';
}
function Field({ label, children, hint }) {
    return (0, jsx_runtime_1.jsxs)("label", { className: "dvt-field", children: [(0, jsx_runtime_1.jsx)("span", { children: label }), children, hint === undefined ? null : (0, jsx_runtime_1.jsx)("small", { children: hint })] });
}
function SettingsSection({ controller, t }) {
    if (controller === undefined || t === undefined)
        return null;
    return (0, jsx_runtime_1.jsx)(LoadedSettings, { controller: controller, t: t });
}
const HEALTH_NAME_KEYS = {
    python: 'healthPython',
    dependencies: 'healthDependencies',
    chrome: 'healthChrome',
    credential: 'healthCredential',
    artifactDirectory: 'healthArtifactDirectory',
    tempDirectory: 'healthTempDirectory',
    service: 'healthService',
    model: 'healthModel',
};
const HEALTH_STATUS_KEYS = {
    ok: 'statusOk',
    warning: 'statusWarning',
    error: 'statusError',
    not_tested: 'statusNotTested',
};
function healthDetail(name, detail, t) {
    if (name === 'python') {
        const match = /^(.+) via (.+)$/u.exec(detail);
        if (match !== null)
            return t('healthPythonDetail', { version: match[1], path: match[2] });
    }
    if (detail === 'Chrome/Chromium/Edge was not found; vision_html_screenshot is unavailable')
        return t('healthChromeMissing');
    if (detail === 'Chrome availability probe failed')
        return t('healthChromeProbeFailed');
    let match = /^credential (.+) is not configured$/u.exec(detail);
    if (match !== null)
        return t('healthCredentialMissing', { credential: match[1] });
    match = /^credential (.+) is resolvable$/u.exec(detail);
    if (match !== null)
        return t('healthCredentialReady', { credential: match[1] });
    match = /^credential (.+) could not be resolved$/u.exec(detail);
    if (match !== null)
        return t('healthCredentialFailed', { credential: match[1] });
    match = /^(Artifact directory|Runtime temp directory) is writable: (.+)$/u.exec(detail);
    if (match !== null)
        return t('healthDirectoryWritable', {
            directory: match[1] === 'Artifact directory' ? t('healthArtifactDirectory') : t('healthTempDirectory'),
            path: match[2],
        });
    match = /^(Artifact directory|Runtime temp directory) is not writable: (.+)$/u.exec(detail);
    if (match !== null)
        return t('healthDirectoryNotWritable', {
            directory: match[1] === 'Artifact directory' ? t('healthArtifactDirectory') : t('healthTempDirectory'),
            path: match[2],
        });
    if (detail === 'Artifact directory could not be prepared')
        return t('healthArtifactDirectoryFailed');
    if (detail === 'Connection was not tested; pass testConnection=true to query the configured /models endpoint')
        return t('healthConnectionNotTested');
    if (detail === 'Connection test skipped because the configured credential is unavailable')
        return t('healthConnectionCredentialMissing');
    match = /^Service responded at (.+) \(HTTP (\d+)\)$/u.exec(detail);
    if (match !== null)
        return t('healthServiceResponded', { endpoint: match[1], status: match[2] });
    match = /^Service rejected the configured credential \(HTTP (\d+)\)$/u.exec(detail);
    if (match !== null)
        return t('healthServiceRejectedCredential', { status: match[1] });
    match = /^Service is reachable but restricted GET \/models \(HTTP (\d+)\); the credential may still be valid for real vision requests$/u.exec(detail);
    if (match !== null)
        return t('healthServiceForbidden', { status: match[1] });
    match = /^Service is reachable but does not expose GET \/models \(HTTP (\d+)\)$/u.exec(detail);
    if (match !== null)
        return t('healthServiceNoModels', { status: match[1] });
    if (detail === 'Service is reachable but rate-limited the connection test (HTTP 429)')
        return t('healthServiceRateLimited');
    match = /^Service connection test failed with HTTP (\d+)$/u.exec(detail);
    if (match !== null)
        return t('healthServiceHttpFailed', { status: match[1] });
    match = /^Service could not be reached at (.+)$/u.exec(detail);
    if (match !== null)
        return t('healthServiceUnreachable', { endpoint: match[1] });
    if (detail === 'Vision model was not tested; run an explicit model test to send the bundled diagnostic image')
        return t('healthModelNotTested');
    if (detail === 'Vision model test skipped because the configured credential is unavailable')
        return t('healthModelCredentialMissing');
    match = /^Vision model (.+) completed a multimodal request$/u.exec(detail);
    if (match !== null)
        return t('healthModelReady', { model: match[1] });
    match = /^Vision model test failed: (.+)$/u.exec(detail);
    if (match !== null)
        return t('healthModelFailed', { detail: match[1] });
    return detail;
}
function modelTestTag(health, check) {
    if (!health.modelTested)
        return { status: 'warning', label: 'modelTestNotRunTag' };
    if (check.status === 'ok')
        return { status: 'ok', label: 'modelTestVerifiedTag' };
    return { status: 'error', label: 'modelTestFailedTag' };
}
function credentialSource(source, t) {
    if (source === 'env')
        return t('sourceEnv');
    if (source === 'file')
        return t('sourceFile');
    return source;
}
const UPDATE_REASON_KEYS = {
    'profile-not-found': 'updateReasonProfileNotFound',
    'not-direct-dependency': 'updateReasonNotDependency',
    'unsupported-install-source': 'updateReasonLocalSource',
    'profile-read-only': 'updateReasonReadOnly',
    'pnpm-unavailable': 'updateReasonPnpm',
    'unsupported-platform': 'updateReasonPlatform',
    'restart-unmanaged': 'updateReasonRestartUnmanaged',
    'restart-address-unavailable': 'updateReasonRestartAddress',
};
function wait(delayMs) {
    return new Promise(resolve => { setTimeout(resolve, delayMs); });
}
function LoadedSettings({ controller, t }) {
    const state = (0, react_1.useSyncExternalStore)(controller.subscribe, controller.snapshot, controller.snapshot);
    const snapshot = state.snapshot;
    const [draft, setDraft] = (0, react_1.useState)(undefined);
    const [apiKey, setApiKey] = (0, react_1.useState)('');
    const [draftError, setDraftError] = (0, react_1.useState)(undefined);
    const [copiedCommand, setCopiedCommand] = (0, react_1.useState)(false);
    (0, react_1.useEffect)(() => { if (state.status === 'idle')
        void controller.load(); }, [controller, state.status]);
    (0, react_1.useEffect)(() => {
        if (snapshot !== undefined)
            setDraft(draftOf(snapshot.settings.value));
    }, [snapshot]);
    (0, react_1.useEffect)(() => {
        const restart = state.restart;
        if (restart === undefined || !restart.restarting)
            return;
        let cancelled = false;
        void (async () => {
            await wait(restart.retryAfterMs);
            const deadline = Date.now() + 390_000;
            let outageSeen = false;
            while (!cancelled && Date.now() < deadline) {
                try {
                    const current = await apiRequest();
                    if (current.release.pluginVersion === restart.toVersion) {
                        window.location.reload();
                        return;
                    }
                    if (outageSeen && current.release.pluginVersion === restart.fromVersion) {
                        controller.reportRestartTimeout(t('restartRolledBack'));
                        return;
                    }
                }
                catch {
                    // The expected outage while the replacement process starts.
                    outageSeen = true;
                }
                await wait(1_000);
            }
            if (!cancelled)
                controller.reportRestartTimeout(t('restartTimedOut'));
        })();
        return () => { cancelled = true; };
    }, [controller, state.restart, t]);
    if (state.status === 'idle' || (state.status === 'loading' && snapshot === undefined)) {
        return (0, jsx_runtime_1.jsx)("div", { className: "dvt-settings", children: (0, jsx_runtime_1.jsx)("div", { className: "dvt-loading", children: t('testing') }) });
    }
    if (snapshot === undefined || draft === undefined) {
        return (0, jsx_runtime_1.jsxs)("div", { className: "dvt-settings", children: [(0, jsx_runtime_1.jsx)("div", { className: "dvt-alert error", children: state.error ?? t('runtimeUnavailable') }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { variant: "outline", onClick: () => { void controller.load(); }, children: t('retry') })] });
    }
    const update = (key, value) => setDraft(current => current === undefined ? current : { ...current, [key]: value });
    const save = () => {
        try {
            const keyFailure = apiKeyFailure(apiKey, t);
            if (keyFailure !== undefined) {
                setDraftError(keyFailure);
                return;
            }
            const credentialValue = apiKey.length === 0 ? undefined : apiKey.trim();
            setDraftError(undefined);
            void controller.save(valueOf(draft, t), snapshot.settings.revision, credentialValue, snapshot.writable).then(saved => { if (saved)
                setApiKey(''); });
        }
        catch (error) {
            setDraftError(error instanceof Error ? error.message : String(error));
        }
    };
    const busy = state.action !== undefined;
    const credentialMatchesSnapshot = draft.credential.trim() === snapshot.credential.ref;
    const builtInCredentialChangedProvider = snapshot.credential.source === 'built-in-free'
        && !isBuiltInFreeVisionDraft(draft);
    const keyLocked = credentialMatchesSnapshot
        && !snapshot.credential.writable
        && !builtInCredentialChangedProvider;
    const canSave = snapshot.writable || (apiKey.length > 0 && !keyLocked);
    const runtimeErrorTitle = snapshot.runtime.ready ? t('runtimeCandidateRejected') : t('runtimeUnavailable');
    const pluginUpdate = state.update;
    const updateCapability = pluginUpdate ?? snapshot.release.update;
    const latestVersion = pluginUpdate?.latestVersion;
    const updateReason = updateCapability.reason === undefined ? undefined : t(UPDATE_REASON_KEYS[updateCapability.reason]);
    const updateCheckSupported = updateCapability.checkSupported ?? updateCapability.supported;
    const updateHasUnsavedChanges = apiKey.length > 0 || settingsDraftChanged(draft, snapshot.settings.value, t);
    const manualUpdateProfile = updateCapability.profile ?? 'web';
    const manualUpdateCommand = `dsh plugin --profile ${manualUpdateProfile} add @anionex/dsh-vision-toolkit@latest --registry=https://registry.npmjs.org/`;
    const tutorialUrl = draft?.language === 'en' ? GROQ_TUTORIAL_URL_EN : GROQ_TUTORIAL_URL_ZH;
    const copyManualUpdate = () => {
        void navigator.clipboard?.writeText(manualUpdateCommand)
            .then(() => {
            setCopiedCommand(true);
            window.setTimeout(() => setCopiedCommand(false), 2_000);
        })
            .catch(() => { });
    };
    const applyUpdate = () => {
        if (latestVersion === undefined)
            return;
        if (!window.confirm(t('updateConfirm', { version: latestVersion })))
            return;
        void controller.applyUpdate(latestVersion);
    };
    return ((0, jsx_runtime_1.jsxs)("div", { className: "dvt-settings", children: [(0, jsx_runtime_1.jsx)("div", { className: "dvt-alert notice", children: t('externalNotice') }), !snapshot.writable ? (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert warning", children: t('readOnly') }) : null, draftError === undefined ? null : (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert error", children: draftError }), state.error === undefined ? null : (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert error", children: state.error }), state.message === 'saved' ? (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert success", children: t('saved') }) : null, state.message === 'restarting' && state.restart !== undefined ? (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert success", children: t('restarting', { version: state.restart.toVersion }) }) : null, state.message === 'manual-restart-required' && state.restart !== undefined ? (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert success", children: t('manualRestartRequired', { version: state.restart.toVersion }) }) : null, snapshot.runtime.lastError === undefined ? null : (0, jsx_runtime_1.jsxs)("div", { className: "dvt-alert error", children: [(0, jsx_runtime_1.jsx)("strong", { children: runtimeErrorTitle }), (0, jsx_runtime_1.jsx)("span", { children: snapshot.runtime.lastError })] }), (0, jsx_runtime_1.jsxs)("section", { className: "dvt-panel dvt-essential", children: [(0, jsx_runtime_1.jsxs)("div", { className: "dvt-panel-title", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h3", { children: t('provider') }), (0, jsx_runtime_1.jsx)("p", { children: t('providerHint') })] }), (0, jsx_runtime_1.jsx)("span", { className: `dvt-badge ${snapshot.credential.configured ? 'ok' : 'error'}`, children: snapshot.credential.configured ? t('configured') : t('missing') })] }), (0, jsx_runtime_1.jsx)("p", { className: "dvt-tutorial-link", children: (0, jsx_runtime_1.jsx)("a", { href: tutorialUrl, target: "_blank", rel: "noreferrer", children: t('groqTutorial') }) }), (0, jsx_runtime_1.jsxs)("div", { className: "dvt-form-grid", children: [(0, jsx_runtime_1.jsx)(Field, { label: t('protocol'), children: (0, jsx_runtime_1.jsxs)("select", { disabled: !snapshot.writable || busy, value: draft.protocol, onChange: (event) => { update('protocol', event.target.value); }, children: [(0, jsx_runtime_1.jsx)("option", { value: "openai", children: "OpenAI Chat Completions" }), (0, jsx_runtime_1.jsx)("option", { value: "anthropic", children: "Anthropic Messages" })] }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('baseUrl'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { disabled: !snapshot.writable || busy, value: draft.baseUrl, onChange: (event) => { update('baseUrl', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('model'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { disabled: !snapshot.writable || busy, value: draft.model, onChange: (event) => { update('model', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('apiKey'), hint: keyLocked ? t('apiKeyLocked') : snapshot.credential.source === undefined ? t('apiKeyHint') : `${t('apiKeyHint')} ${t('sourceHint', { source: t('source'), value: credentialSource(snapshot.credential.source, t) })}`, children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { "aria-label": t('apiKey'), type: "password", autoComplete: "new-password", disabled: busy || keyLocked, placeholder: snapshot.credential.configured ? t('apiKeyPlaceholderConfigured') : t('apiKeyPlaceholderMissing'), value: apiKey, onChange: (event) => { setApiKey(event.target.value); setDraftError(undefined); } }) })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "dvt-save-row", children: [(0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { variant: "primary", disabled: !canSave || busy, onClick: save, children: state.action === 'save' ? t('saving') : t('save') }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { variant: "outline", disabled: busy, onClick: () => { void controller.load(); }, children: t('reload') })] }), (0, jsx_runtime_1.jsxs)("section", { className: "dvt-panel", children: [(0, jsx_runtime_1.jsxs)("div", { className: "dvt-panel-title", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h3", { children: t('health') }), (0, jsx_runtime_1.jsx)("p", { children: t('connectionHint') })] }), (0, jsx_runtime_1.jsxs)("div", { className: "dvt-actions", children: [(0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { size: "sm", variant: "outline", disabled: busy || !snapshot.runtime.ready, onClick: () => { void controller.runHealth('health'); }, children: state.action === 'health' ? t('testing') : t('runHealth') }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { size: "sm", variant: "outline", disabled: busy || !snapshot.runtime.ready, onClick: () => { void controller.runHealth('connection'); }, children: state.action === 'connection' ? t('testing') : t('testConnection') }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { size: "sm", variant: "primary", disabled: busy || !snapshot.runtime.ready, onClick: () => { void controller.runHealth('model'); }, children: state.action === 'model' ? t('testingModel') : t('testModel') })] })] }), (0, jsx_runtime_1.jsx)("p", { className: "dvt-muted", children: t('saveBeforeTesting') }), state.health === undefined ? (0, jsx_runtime_1.jsx)("p", { className: "dvt-muted", children: t('notTested') }) : (0, jsx_runtime_1.jsx)("div", { className: "dvt-health-grid", children: Object.entries(state.health.checks).map(([name, check]) => {
                            const testTag = name === 'model' ? modelTestTag(state.health, check) : undefined;
                            return (0, jsx_runtime_1.jsxs)("div", { "data-status": check.status, children: [(0, jsx_runtime_1.jsx)("span", { children: t(HEALTH_NAME_KEYS[name] ?? 'health') }), testTag === undefined ? null : (0, jsx_runtime_1.jsx)("em", { className: "dvt-health-test-tag", "data-status": testTag.status, children: t(testTag.label) }), (0, jsx_runtime_1.jsx)("strong", { children: t(HEALTH_STATUS_KEYS[check.status]) }), (0, jsx_runtime_1.jsx)("p", { children: healthDetail(name, check.detail, t) })] }, name);
                        }) })] }), (0, jsx_runtime_1.jsxs)("section", { className: "dvt-panel dvt-update-panel", children: [(0, jsx_runtime_1.jsxs)("div", { className: "dvt-panel-title", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h3", { children: t('updates') }), (0, jsx_runtime_1.jsx)("p", { children: t('updatesHint') })] }), (0, jsx_runtime_1.jsx)("span", { className: `dvt-badge ${pluginUpdate?.updateAvailable ? 'warning' : pluginUpdate !== undefined && pluginUpdate.supported ? 'ok' : ''}`, children: pluginUpdate?.updateAvailable ? t('updateAvailable') : pluginUpdate !== undefined && pluginUpdate.supported ? t('upToDate') : t('pluginVersion') })] }), (0, jsx_runtime_1.jsxs)("div", { className: "dvt-update-grid", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { children: t('updateInstalled') }), (0, jsx_runtime_1.jsx)("strong", { children: snapshot.release.pluginVersion })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { children: t('updateLatest') }), (0, jsx_runtime_1.jsx)("strong", { children: latestVersion ?? '—' })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { children: t('updateProfile') }), (0, jsx_runtime_1.jsx)("strong", { children: updateCapability.profile ?? '—' })] })] }), !updateCapability.supported ? (0, jsx_runtime_1.jsxs)("div", { className: "dvt-alert warning", children: [(0, jsx_runtime_1.jsx)("strong", { children: t('updateUnsupported') }), (0, jsx_runtime_1.jsx)("span", { children: updateReason })] }) : null, updateCapability.supported && updateHasUnsavedChanges ? (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert warning", children: t('updateSaveFirst') }) : null, pluginUpdate?.supported && pluginUpdate.updateAvailable && latestVersion !== undefined ? (0, jsx_runtime_1.jsx)("p", { className: "dvt-muted", children: t('updateAvailableDetail', { version: latestVersion }) }) : null, pluginUpdate?.supported && !pluginUpdate.updateAvailable && latestVersion !== undefined ? (0, jsx_runtime_1.jsx)("p", { className: "dvt-muted", children: t('upToDateDetail', { version: latestVersion }) }) : null, (0, jsx_runtime_1.jsx)("p", { className: "dvt-muted", children: t('manualUpdateHint') }), (0, jsx_runtime_1.jsxs)("div", { className: "dvt-manual-update", children: [(0, jsx_runtime_1.jsx)("code", { children: manualUpdateCommand }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { size: "sm", variant: "outline", onClick: copyManualUpdate, children: copiedCommand ? t('copied') : t('copy') })] }), (0, jsx_runtime_1.jsxs)("div", { className: "dvt-actions", children: [(0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { variant: "outline", disabled: busy || !updateCheckSupported || state.restart !== undefined, onClick: () => { void controller.checkUpdate(); }, children: state.action === 'check-update' ? t('checkingUpdate') : t('checkUpdate') }), pluginUpdate?.supported && pluginUpdate.updateAvailable && latestVersion !== undefined ? (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { variant: "primary", disabled: busy || state.restart !== undefined || updateHasUnsavedChanges, onClick: applyUpdate, children: state.action === 'apply-update' ? t('updatingPlugin') : t('updateNow') }) : null] })] }), (0, jsx_runtime_1.jsxs)("details", { className: "dvt-advanced", children: [(0, jsx_runtime_1.jsxs)("summary", { children: [(0, jsx_runtime_1.jsxs)("span", { children: [(0, jsx_runtime_1.jsx)("strong", { children: t('advanced') }), (0, jsx_runtime_1.jsx)("small", { children: t('advancedHint') })] }), (0, jsx_runtime_1.jsx)("span", { className: "dvt-details-chevron", "aria-hidden": "true", children: "\u2304" })] }), (0, jsx_runtime_1.jsxs)("div", { className: "dvt-advanced-body", children: [(0, jsx_runtime_1.jsxs)("section", { className: "dvt-panel", children: [(0, jsx_runtime_1.jsx)("div", { className: "dvt-panel-title", children: (0, jsx_runtime_1.jsx)("h3", { children: t('provider') }) }), (0, jsx_runtime_1.jsxs)("div", { className: "dvt-form-grid", children: [(0, jsx_runtime_1.jsx)(Field, { label: t('credential'), hint: t('credentialHint'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { "aria-label": t('credential'), disabled: !snapshot.writable || busy, value: draft.credential, onChange: (event) => { update('credential', event.target.value); } }) }), draft.protocol === 'anthropic' ? (0, jsx_runtime_1.jsx)(Field, { label: t('anthropicThinking'), hint: t('anthropicThinkingHint'), children: (0, jsx_runtime_1.jsxs)("select", { "aria-label": t('anthropicThinking'), value: draft.anthropicThinking, onChange: (event) => { update('anthropicThinking', event.target.value); }, children: [(0, jsx_runtime_1.jsx)("option", { value: "omit", children: "omit (widest compatibility)" }), (0, jsx_runtime_1.jsx)("option", { value: "disabled", children: "disabled (model support required)" }), (0, jsx_runtime_1.jsx)("option", { value: "adaptive", children: "adaptive (model support required)" })] }) }) : null, (0, jsx_runtime_1.jsx)(Field, { label: t('userAgent'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { value: draft.userAgent, onChange: (event) => { update('userAgent', event.target.value); } }) })] })] }), (0, jsx_runtime_1.jsxs)("section", { className: "dvt-panel", children: [(0, jsx_runtime_1.jsx)("div", { className: "dvt-panel-title", children: (0, jsx_runtime_1.jsx)("h3", { children: t('limits') }) }), (0, jsx_runtime_1.jsxs)("div", { className: "dvt-form-grid", children: [(0, jsx_runtime_1.jsx)(Field, { label: t('language'), children: (0, jsx_runtime_1.jsxs)("select", { value: draft.language, onChange: (event) => { update('language', event.target.value); }, children: [(0, jsx_runtime_1.jsx)("option", { value: "zh", children: "\u4E2D\u6587" }), (0, jsx_runtime_1.jsx)("option", { value: "en", children: "English" })] }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('timeout'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { inputMode: "numeric", value: draft.timeoutMs, onChange: (event) => { update('timeoutMs', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('maxBytes'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { inputMode: "numeric", value: draft.maxImageBytes, onChange: (event) => { update('maxImageBytes', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('maxPixels'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { inputMode: "numeric", value: draft.maxImagePixels, onChange: (event) => { update('maxImagePixels', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('concurrency'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { inputMode: "numeric", value: draft.concurrency, onChange: (event) => { update('concurrency', event.target.value); } }) })] })] }), (0, jsx_runtime_1.jsxs)("section", { className: "dvt-panel", children: [(0, jsx_runtime_1.jsx)("div", { className: "dvt-panel-title", children: (0, jsx_runtime_1.jsx)("h3", { children: t('imageInput') }) }), (0, jsx_runtime_1.jsxs)("label", { className: "dvt-check", children: [(0, jsx_runtime_1.jsx)("input", { type: "checkbox", checked: draft.hiddenVariants, disabled: !snapshot.writable || busy, onChange: (event) => { update('hiddenVariants', event.target.checked); } }), (0, jsx_runtime_1.jsx)("span", { children: t('hiddenVariantsLabel') }), (0, jsx_runtime_1.jsx)("small", { children: t('hiddenVariantsHint') })] })] }), (0, jsx_runtime_1.jsxs)("section", { className: "dvt-panel", children: [(0, jsx_runtime_1.jsxs)("div", { className: "dvt-panel-title", children: [(0, jsx_runtime_1.jsx)("h3", { children: t('runtime') }), (0, jsx_runtime_1.jsx)("span", { className: `dvt-badge ${snapshot.runtime.ready ? 'ok' : 'error'}`, children: snapshot.runtime.ready ? snapshot.runtime.upstream?.source === 'managed' ? t('runtimeManaged') : snapshot.runtime.upstream?.source === 'external' ? t('runtimeExternal') : t('runtimeReady') : t('runtimeUnavailable') })] }), (0, jsx_runtime_1.jsxs)("div", { className: "dvt-form-grid", children: [(0, jsx_runtime_1.jsx)(Field, { label: t('runtimeMode'), children: (0, jsx_runtime_1.jsxs)("select", { value: draft.runtimeMode, onChange: (event) => { update('runtimeMode', event.target.value); }, children: [(0, jsx_runtime_1.jsx)("option", { value: "managed", children: t('runtimeManaged') }), (0, jsx_runtime_1.jsx)("option", { value: "external", children: t('runtimeExternal') })] }) }), draft.runtimeMode === 'external' ? (0, jsx_runtime_1.jsx)(Field, { label: t('toolkitPath'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { value: draft.toolkitPath, onChange: (event) => { update('toolkitPath', event.target.value); } }) }) : null, (0, jsx_runtime_1.jsx)(Field, { label: t('python'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { placeholder: "python3", value: draft.python, onChange: (event) => { update('python', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('allowedDirs'), hint: t('allowedDirsHint'), children: (0, jsx_runtime_1.jsx)("textarea", { rows: 3, value: draft.allowedDirs, onChange: (event) => { update('allowedDirs', event.target.value); } }) })] }), snapshot.runtime.upstream === undefined ? null : (0, jsx_runtime_1.jsxs)("div", { className: "dvt-runtime-facts", children: [(0, jsx_runtime_1.jsx)("code", { children: snapshot.runtime.upstream.path }), (0, jsx_runtime_1.jsxs)("code", { children: [snapshot.runtime.upstream.python, " \u00B7 ", snapshot.runtime.upstream.pythonVersion] }), (0, jsx_runtime_1.jsx)("code", { children: snapshot.runtime.upstream.runtimeHome })] })] })] })] }), (0, jsx_runtime_1.jsxs)("footer", { className: "dvt-settings-footer", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { className: "dvt-kicker", children: t('pluginKind') }), (0, jsx_runtime_1.jsx)("h2", { children: t('settingsTitle') }), (0, jsx_runtime_1.jsx)("p", { children: t('settingsIntro') })] }), (0, jsx_runtime_1.jsxs)("div", { className: "dvt-release", children: [(0, jsx_runtime_1.jsxs)("span", { children: [t('pluginVersion'), " ", (0, jsx_runtime_1.jsx)("strong", { children: snapshot.release.pluginVersion })] }), (0, jsx_runtime_1.jsxs)("span", { children: [t('upstreamVersion'), " ", (0, jsx_runtime_1.jsx)("strong", { children: snapshot.release.upstreamVersion })] }), (0, jsx_runtime_1.jsxs)("span", { children: [t('activeGeneration'), " ", (0, jsx_runtime_1.jsx)("strong", { children: t('activeGenerationValue', { generation: snapshot.runtime.generation }) })] })] })] })] }));
}
const CSS = `
.dvt-tool{margin:4px 0;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;box-shadow:var(--dsw-shadow-lv1)}
.dvt-tool-head{width:100%;min-height:38px;display:flex;align-items:center;gap:7px;padding:8px 10px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}.dvt-tool-head:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dvt-tool-icon{width:20px;height:20px;display:grid;place-items:center;border-radius:6px;color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);flex:none}.dvt-tool-title{font-size:12px;font-weight:650;white-space:nowrap}.dvt-tool-sep{opacity:.35}.dvt-tool-summary{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-secondary)}.dvt-tool-status{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvt-tool[data-state=error] .dvt-tool-status{color:var(--dsw-alias-state-error-primary)}.dvt-chevron{margin-left:auto;transition:transform .16s ease;opacity:.55}.dvt-chevron[data-open=true]{transform:rotate(180deg)}.dvt-tool-body{padding:0 10px 10px}.dvt-stack{display:grid;gap:10px}.dvt-muted{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
.dvt-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.dvt-metrics>div,.dvt-diff-score{padding:10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);display:grid;gap:4px}.dvt-metrics span,.dvt-diff-score span{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--dsw-alias-label-secondary)}.dvt-metrics strong,.dvt-diff-score strong{font-size:13px}.dvt-list{list-style:none;margin:0;padding:0;display:grid;gap:4px;max-height:160px;overflow:auto}.dvt-list li{display:flex;justify-content:space-between;gap:12px;padding:6px 8px;border-radius:7px;background:var(--dsw-alias-bg-layer-2);font-size:11px}.dvt-list code{color:var(--dsw-alias-state-business-primary)}.dvt-table-wrap{max-height:220px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:9px}.dvt-table{width:100%;border-collapse:collapse;font-size:11px}.dvt-table th,.dvt-table td{padding:7px 8px;text-align:left;border-bottom:1px solid var(--dsw-alias-border-l1)}.dvt-table th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-2);font-size:10px;text-transform:uppercase;letter-spacing:.05em}.dvt-table tr:last-child td{border-bottom:0}
.dvt-artifact{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}.dvt-preview{display:block;width:100%;max-height:360px;object-fit:contain;background:repeating-conic-gradient(var(--dsw-alias-bg-module-platform) 0 25%,var(--dsw-alias-bg-layer-1) 0 50%) 50%/18px 18px;border:0}.dvt-svg{height:280px}.dvt-artifact-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 10px}.dvt-artifact-meta>div:first-child{min-width:0;display:grid;gap:2px}.dvt-artifact-meta strong{font-size:12px;overflow:hidden;text-overflow:ellipsis}.dvt-artifact-meta span,.dvt-artifact-meta small{font-size:10px;color:var(--dsw-alias-label-secondary)}.dvt-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.dvt-download{display:inline-flex;align-items:center;height:28px;padding:0 12px;border-radius:999px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);text-decoration:none;font-size:12px;font-weight:600}.dvt-download:hover{background:var(--dsw-alias-button-primary-hover)}.dvt-download:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.dvt-artifact>.dvt-muted{padding:0 10px 10px}.dvt-diff-score>div{height:5px;border-radius:99px;background:var(--dsw-alias-border-l2);overflow:hidden}.dvt-diff-score i{display:block;height:100%;min-width:2px;background:linear-gradient(90deg,var(--dsw-alias-state-warn-primary),var(--dsw-alias-state-error-primary));border-radius:99px}.dvt-tool h4{font-size:11px;margin:0 0 6px}.dvt-palette{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:7px}.dvt-palette>div{display:flex;align-items:center;gap:8px;padding:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px}.dvt-palette i{width:28px;height:28px;border-radius:7px;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}.dvt-palette span{display:grid}.dvt-palette strong{font-size:11px}.dvt-palette small{font-size:10px;color:var(--dsw-alias-label-secondary)}
.dvt-tutorial-link{margin:0;font-size:12px;line-height:1.5}.dvt-tutorial-link a{color:var(--dsw-alias-state-business-primary);text-decoration:none;font-weight:600}.dvt-tutorial-link a:hover{text-decoration:underline}.dvt-manual-update{display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2)}.dvt-manual-update code{flex:1;min-width:0;overflow:auto;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-primary)}.dvt-settings{display:grid;grid-template-columns:minmax(0,1fr);width:100%;max-width:900px;min-width:0;box-sizing:border-box;gap:14px;padding:8px 2px 32px;color:var(--dsw-alias-label-primary)}.dvt-settings-footer{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding:8px 2px}.dvt-settings-footer h2{font-size:25px;letter-spacing:-.025em;margin:3px 0 6px}.dvt-settings-footer p{max-width:620px;margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.55}.dvt-kicker{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--dsw-alias-state-business-primary);font-weight:700}.dvt-release{display:grid;gap:4px;min-width:170px;padding:9px 11px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);font-size:10px;color:var(--dsw-alias-label-secondary)}.dvt-release span{display:flex;justify-content:space-between;gap:12px}.dvt-release strong{color:var(--dsw-alias-label-primary)}.dvt-alert{padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.5;display:grid;gap:3px}.dvt-alert.notice{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary)}.dvt-alert.warning{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-label)}.dvt-alert.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}.dvt-alert.success{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}.dvt-panel{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;padding:15px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv1)}.dvt-panel-title{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px}.dvt-panel-title>div:first-child{flex:1 1 320px;min-width:0}.dvt-panel-title>.dvt-actions{margin-left:auto;justify-content:flex-end}.dvt-panel-title h3{font-size:14px;margin:0}.dvt-panel-title p{font-size:11px;line-height:1.45;color:var(--dsw-alias-label-secondary);margin:4px 0 0;max-width:620px}.dvt-badge{font-size:10px;padding:3px 7px;border-radius:999px;font-weight:650}.dvt-badge.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary)}.dvt-badge.warning{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-label)}.dvt-badge.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}.dvt-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.dvt-field{display:grid;min-width:0;gap:6px;align-content:start}.dvt-field>span{font-size:11px;font-weight:600}.dvt-field>small{font-size:10px;color:var(--dsw-alias-label-secondary);line-height:1.4}.dvt-field select,.dvt-field textarea{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:8px 10px}.dvt-field select{height:36px}.dvt-field textarea{resize:vertical;min-height:76px}.dvt-check{display:grid;gap:6px;cursor:pointer}.dvt-check input{width:auto}.dvt-check>span{font-size:12px;font-weight:600}.dvt-check>small{font-size:10px;color:var(--dsw-alias-label-secondary);line-height:1.4}.dvt-runtime-facts{display:grid;gap:4px;padding:9px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);overflow:auto}.dvt-runtime-facts code{font-size:10px;white-space:nowrap;color:var(--dsw-alias-label-secondary)}.dvt-save-row{display:flex;gap:8px;padding:2px 0}.dvt-update-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.dvt-update-grid>div{display:grid;gap:3px;padding:9px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2)}.dvt-update-grid span{font-size:9px;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-label-caption)}.dvt-update-grid strong{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dvt-settings-footer{margin-top:8px;padding:20px 2px 4px;border-top:1px solid var(--dsw-alias-border-l1);opacity:.82}.dvt-settings-footer h2{font-size:18px;letter-spacing:-.015em;margin:3px 0 5px}.dvt-settings-footer p{font-size:11px;line-height:1.5}.dvt-release{min-width:220px}.dvt-release span{white-space:nowrap}.dvt-essential{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 30%,var(--dsw-alias-border-l1));box-shadow:var(--dsw-shadow-lv1),0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 5%,transparent)}.dvt-advanced{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}.dvt-advanced>summary{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 15px;cursor:pointer;list-style:none}.dvt-advanced>summary::-webkit-details-marker{display:none}.dvt-advanced>summary>span:first-child{display:grid;gap:3px}.dvt-advanced>summary strong{font-size:13px}.dvt-advanced>summary small{font-size:10px;line-height:1.45;color:var(--dsw-alias-label-secondary);font-weight:400}.dvt-details-chevron{font-size:15px;opacity:.55;transition:transform .16s ease}.dvt-advanced[open] .dvt-details-chevron{transform:rotate(180deg)}.dvt-advanced-body{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;padding:0 12px 12px}.dvt-advanced-body>.dvt-panel{box-shadow:none}
.dvt-health-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.dvt-health-grid>div{padding:9px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border-left:3px solid var(--dsw-alias-border-l4)}.dvt-health-grid>div[data-status=ok]{border-left-color:var(--dsw-alias-state-success-primary)}.dvt-health-grid>div[data-status=warning],.dvt-health-grid>div[data-status=not_tested]{border-left-color:var(--dsw-alias-state-warn-primary)}.dvt-health-grid>div[data-status=error]{border-left-color:var(--dsw-alias-state-error-primary)}.dvt-health-grid span{font-size:10px;text-transform:capitalize}.dvt-health-grid strong{float:right;font-size:9px;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}.dvt-health-test-tag{display:inline-flex;margin-left:6px;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);font-size:9px;font-style:normal;font-weight:600;color:var(--dsw-alias-label-secondary)}.dvt-health-test-tag[data-status=ok]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary)}.dvt-health-test-tag[data-status=warning]{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-label)}.dvt-health-test-tag[data-status=error]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}.dvt-health-grid p{clear:both;margin:5px 0 0;font-size:10px;line-height:1.4;color:var(--dsw-alias-label-secondary)}.dvt-loading{padding:24px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);font-size:12px;color:var(--dsw-alias-label-secondary)}
.dvt-paste-dock{box-sizing:border-box;width:calc(100% - 32px);max-width:var(--dsh-composer-card-max-width,960px);margin:0 auto;display:flex;flex-wrap:wrap;gap:6px;padding:0 2px 6px}.dvt-paste-chip{max-width:100%;height:32px;box-sizing:border-box;display:flex;align-items:center;gap:7px;padding:0 6px 0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-specific-tip);font-size:12px}.dvt-paste-chip[data-status=copying]{border-color:var(--dsw-alias-state-business-primary)}.dvt-paste-chip[data-status=error]{border-color:var(--dsw-alias-state-error-primary)}.dvt-paste-name{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvt-paste-detail{color:var(--dsw-alias-label-caption);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvt-paste-chip[data-status=error] .dvt-paste-detail{color:var(--dsw-alias-state-error-primary)}.dvt-paste-chip button{width:20px;height:20px;display:grid;place-items:center;border:0;border-radius:50%;padding:0;background:transparent;color:var(--dsw-alias-label-caption);font:inherit;font-size:16px;cursor:pointer}.dvt-paste-chip button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dvt-paste-chip button:disabled{opacity:.4;cursor:default}
@media(max-width:720px){.dvt-settings-footer{display:grid}.dvt-release{width:auto}.dvt-form-grid,.dvt-update-grid{grid-template-columns:1fr}.dvt-metrics{grid-template-columns:1fr}.dvt-artifact-meta{align-items:flex-start;flex-direction:column}.dvt-panel-title{flex-direction:column}}
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
    ctx.effect(model_variants_hider_ts_1.installModelVariantsHider, 'dsh-vision-toolkit: model-selector transparent routing');
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
            if (namespace === 'vision-toolkit') {
                (0, display_config_ts_1.resetDisplayConfigCache)();
                controller.refreshIfLoaded();
            }
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
__modules["./model-variants-hider.js"] = function(module, exports, require, __load_) {
"use strict";
/**
 * Transparent routing for the host model selector: when `imageInputVariants.hidden`
 * is enabled, variant routes keep the upstream provider/model display names and
 * the browser hides the upstream text-only entries that have a variant twin.
 * Users then see one entry per model — the original name — while the session
 * actually runs on the image-capable variant, so pasted images, history with
 * images, and the built-in `read_image` tool all keep working on text-only
 * models without exposing `(Vision Toolkit)` routes.
 *
 * The host selector renders one `[role=group]` per provider whose group title
 * id is `:<react-radix>:-<providerId>`, and one `[role=menuitemradio]` per
 * model. We key groups by that provider id (variant routes carry the
 * `vision-toolkit-` prefix) and hide every upstream entry whose display name
 * matches a variant twin, collapsing fully-hidden upstream groups.
 *
 * The hiding decision is purely DOM-local: transparent mode is exactly the
 * case where a variant twin keeps the upstream display name, while explicit
 * mode appends `(Vision Toolkit)` and therefore never matches. No display-config
 * round-trip is needed before the selector can be tidied, so the first paint
 * of an opened menu already shows the merged list instead of flashing the
 * duplicate upstream group.
 * @module dsh-vision-toolkit/model-variants-hider
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.tidyModelSelector = tidyModelSelector;
exports.installModelVariantsHider = installModelVariantsHider;
exports.isModelVariantsHiderActive = isModelVariantsHiderActive;
const VARIANT_PROVIDER_PREFIX = 'vision-toolkit-';
/** Elements we hid and their original inline display value, for restoration. */
const hiddenElements = new Map();
let active = false;
let observer;
let tidyQueued = false;
/** Derive the provider id from a group's `aria-labelledby` title id. */
function providerIdOf(group) {
    const labelledBy = group.getAttribute('aria-labelledby');
    if (labelledBy === null || labelledBy === '')
        return undefined;
    const titleId = document.getElementById(labelledBy)?.id ?? labelledBy;
    const reactPrefixed = /^:[^:]+:-(.+)$/u.exec(titleId);
    if (reactPrefixed !== null)
        return reactPrefixed[1];
    return titleId.replace(/^-/u, '');
}
function modelNames(group) {
    return [...group.querySelectorAll('[role="menuitemradio"]')]
        .map(button => (button.title || (button.textContent ?? '')).trim())
        .filter(Boolean);
}
function hideElement(element) {
    if (!hiddenElements.has(element))
        hiddenElements.set(element, element.style.display);
    element.style.display = 'none';
}
function restoreHidden() {
    for (const [element, display] of hiddenElements) {
        element.style.display = display;
    }
    hiddenElements.clear();
}
/**
 * Hide upstream text-only entries that have a variant twin. Group keys come
 * from `aria-labelledby` ids so provider identity is reliable even when the
 * variant provider name equals the upstream name (transparent mode).
 */
function tidyModelSelector() {
    if (document.querySelector('[role="menu"]') === null)
        return;
    // The host re-renders selectors while sessions stay open; drop bookkeeping
    // for entries that already left the DOM so the map cannot grow unboundedly.
    for (const element of [...hiddenElements.keys()]) {
        if (!element.isConnected)
            hiddenElements.delete(element);
    }
    const groups = [...document.querySelectorAll('[role="menu"] [role="group"]')];
    const byProvider = new Map();
    for (const group of groups) {
        const provider = providerIdOf(group);
        if (provider === undefined)
            continue;
        const entries = byProvider.get(provider);
        if (entries === undefined)
            byProvider.set(provider, [group]);
        else
            entries.push(group);
    }
    const shouldHide = new Set();
    for (const [provider, providerGroups] of byProvider) {
        if (!provider.startsWith(VARIANT_PROVIDER_PREFIX))
            continue;
        const upstream = provider.slice(VARIANT_PROVIDER_PREFIX.length);
        const twinNames = new Set(providerGroups.flatMap(modelNames));
        if (twinNames.size === 0)
            continue;
        for (const upstreamGroup of byProvider.get(upstream) ?? []) {
            const buttons = [...upstreamGroup.querySelectorAll('[role="menuitemradio"]')];
            const matched = [];
            for (const button of buttons) {
                const name = (button.title || (button.textContent ?? '')).trim();
                if (twinNames.has(name))
                    matched.push(button);
            }
            if (matched.length === 0)
                continue;
            for (const button of matched)
                shouldHide.add(button);
            // Collapse the whole group only when every model has a variant twin;
            // otherwise a partially matched group keeps its unmatched entries.
            if (matched.length === buttons.length)
                shouldHide.add(upstreamGroup);
        }
    }
    // Restore entries whose twin disappeared (e.g. transparent routing was
    // disabled and the wrapper rebuilt with explicit `(Vision Toolkit)` names).
    for (const [element, display] of [...hiddenElements]) {
        if (!shouldHide.has(element)) {
            element.style.display = display;
            hiddenElements.delete(element);
        }
    }
    for (const element of shouldHide)
        hideElement(element);
}
/**
 * Install the transparent-routing integrator. It watches the document for
 * model-selector renderings and re-tidies them whenever the host re-renders.
 * Tidy runs in a microtask (before the browser paints) and is coalesced across
 * the render batch, so opening the selector never shows the upstream twins.
 * @returns the disposer that stops observation and restores hidden entries.
 */
function installModelVariantsHider() {
    if (observer !== undefined) {
        // A previous install is still active; a duplicate effect must not tear
        // down the integrator while its original owner still expects it.
        return () => { };
    }
    let disposed = false;
    const tidySoon = () => {
        if (tidyQueued || disposed)
            return;
        tidyQueued = true;
        queueMicrotask(() => {
            tidyQueued = false;
            if (disposed)
                return;
            active = true;
            tidyModelSelector();
        });
    };
    observer = new MutationObserver(tidySoon);
    observer.observe(document.body, { childList: true, subtree: true });
    active = true;
    tidyModelSelector();
    return () => {
        disposed = true;
        observer?.disconnect();
        observer = undefined;
        tidyQueued = false;
        restoreHidden();
        active = false;
    };
}
/** Test seam: expose whether the integrator is currently installed. */
function isModelVariantsHiderActive() {
    return active;
}
};
__modules["./paste-images.js"] = function(module, exports, require, __load_) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PasteImageController = exports.PASTE_POLICY_ROUTE = exports.PASTE_IMAGES_ROUTE = void 0;
exports.PasteImageDock = PasteImageDock;
exports.installPasteImages = installPasteImages;
const jsx_runtime_1 = require("react/jsx-runtime");
/** Clipboard-only multi-image input for DSH Web. */
const react_1 = require("react");
const display_config_ts_1 = __load_("./display-config.js");
const SOURCE = 'vision-toolkit-pasted-image';
exports.PASTE_IMAGES_ROUTE = '/_dsh/vision-toolkit/paste-images';
exports.PASTE_POLICY_ROUTE = '/_dsh/vision-toolkit/paste-policy';
const MAX_IMAGES = 20;
/** Hard per-image paste ceiling; must match MAX_PASTE_IMAGE_BYTES on the server. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_BYTES = 80 * 1024 * 1024;
/** A confirmed paste verdict older than this is unknown again, even while a refresh is in flight. */
const VERDICT_MAX_AGE_MS = 15000;
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
/**
 * The selector label the model picker currently shows, or '' when none is
 * readable. Matches the host ModelSelect trigger aria-labels ("Select model,
 * current …" / "选择模型，当前 …"); any other label wording falls back to the
 * session-header verdict, which is stale until the next request.
 */
function currentModelLabel() {
    const buttons = document.querySelectorAll('button[aria-label]');
    for (const button of buttons) {
        const label = button.getAttribute('aria-label') ?? '';
        if (/select model|current model|选择模型/iu.test(label))
            return label;
    }
    return '';
}
/** Verdict cache key: the model label is part of the answer, so a switch invalidates it. */
function verdictKey(sessionId, modelLabel) {
    return `${sessionId}|${modelLabel}`;
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
    verdicts = new Map();
    /** Guards the synthetic replay paste from re-entering capture interception. */
    replaying = false;
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
    /**
     * The host's verdict for one Session and selector label, when fresh. The
     * last CONFIRMED answer is authoritative while a background refresh is in
     * flight (the paste acts on what the host last said; the refresh only
     * covers the next paste). A label that changed since the confirmation
     * answers undefined, so the native attachment flow stays the default.
     * @param sessionId - the live Session the paste belongs to.
     * @param modelLabel - the model-selector label currently shown.
     * @returns the fresh confirmed verdict, or undefined when unconfirmed.
     */
    verdictFor(sessionId, modelLabel) {
        const entry = this.verdicts.get(verdictKey(sessionId, modelLabel));
        if (entry === undefined || entry.at === 0)
            return undefined;
        if (Date.now() - entry.at > VERDICT_MAX_AGE_MS)
            return undefined;
        return { takeOver: entry.takeOver, ...(entry.autoSwitch === undefined ? {} : { autoSwitch: entry.autoSwitch }) };
    }
    /**
     * The exact model route the live model catalog reports for one Session.
     * Unreadable routes answer undefined, so the verdict falls back to the
     * selector label alone.
     * @param sessionId - the live Session id.
     * @returns the current provider/model selection, when readable.
     */
    async readSelection(sessionId) {
        const connection = this.ctx.get('connection');
        if (connection === undefined)
            return undefined;
        try {
            const { result } = await connection.api.sessions.models({ sessionId });
            if (!result.ok)
                return undefined;
            const current = result.value.current;
            if (current === undefined || current === null || current.provider === '' || current.model === '')
                return undefined;
            return {
                provider: current.provider,
                model: current.model,
                ...(current.reasoningEffort === undefined ? {} : { reasoningEffort: current.reasoningEffort }),
            };
        }
        catch {
            return undefined;
        }
    }
    /**
     * Ask the host what to do with a paste for the current model, and cache the
     * answer per Session and selector label. A model switch changes the label,
     * which changes the cache key, so a stale verdict never outlives the model
     * it described. The exact selection rides along when the live model catalog
     * is readable, so the host can answer with an auto-switch route; a 404
     * simply leaves the verdict unconfirmed; the next focus or paste retries.
     * @param sessionId - the live Session to ask about.
     * @param modelLabel - the model-selector label currently shown.
     */
    refreshVerdict(sessionId, modelLabel) {
        const key = verdictKey(sessionId, modelLabel);
        const cached = this.verdicts.get(key);
        // Dedupe only on an in-flight request, never on freshness: the host's
        // model route can change under an unchanged Session id.
        if (cached?.pending)
            return;
        const entry = {
            pending: true,
            takeOver: cached ? cached.takeOver : false,
            at: cached ? cached.at : 0,
            ...(cached?.autoSwitch === undefined ? {} : { autoSwitch: cached.autoSwitch }),
        };
        this.verdicts.set(key, entry);
        void (async () => {
            const selection = await this.readSelection(sessionId);
            const query = new URLSearchParams({ sessionId });
            if (modelLabel !== '')
                query.set('model', modelLabel);
            if (selection !== undefined) {
                query.set('provider', selection.provider);
                query.set('modelId', selection.model);
                if (selection.reasoningEffort !== undefined)
                    query.set('reasoningEffort', selection.reasoningEffort);
            }
            let request;
            try {
                request = fetch(`${exports.PASTE_POLICY_ROUTE}?${query.toString()}`);
            }
            catch {
                // No fetch surface (test runtime, pre-fetch bootstrap): leave the
                // verdict unconfirmed rather than letting the paste listener die.
                entry.pending = false;
                return;
            }
            request
                .then((response) => {
                if (response.status === 404) {
                    // Route not mounted yet (plugin load race, hot reload): forget every
                    // verdict and retry on the next focus or paste instead of standing
                    // down for the page lifetime.
                    this.verdicts.clear();
                    return null;
                }
                if (!response.ok)
                    throw new Error(`paste policy ${response.status}`);
                return response.json();
            })
                .then((body) => {
                entry.pending = false;
                if (body !== null) {
                    entry.takeOver = body.value.takeOver === true;
                    if (body.value.autoSwitch !== undefined)
                        entry.autoSwitch = body.value.autoSwitch;
                    else
                        delete entry.autoSwitch;
                    entry.at = Date.now();
                }
            })
                .catch(() => {
                entry.pending = false;
            });
        })();
    }
    /**
     * Switch one Session to the route the host validated, through the same
     * model-directory seat the selector uses when present (so the shared UI
     * state moves with the session), falling back to the raw RPC.
     * @param sessionId - the live Session id.
     * @param route - the validated variant route.
     */
    async switchModel(sessionId, route) {
        const directories = this.ctx.get('modelDirectories');
        if (directories !== undefined) {
            // The label is a display hint; the seat only needs the exact route.
            await directories.directoryFor(sessionId).select({
                provider: route.provider,
                model: route.model,
                ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
            });
            return;
        }
        const connection = this.ctx.get('connection');
        if (connection === undefined)
            throw new Error('No model switch channel is available in this Web application');
        const { result } = await connection.api.sessions.selectModel({
            sessionId,
            provider: route.provider,
            model: route.model,
            ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
        });
        if (!result.ok)
            throw new Error(`${result.error?.code ?? 'select-model-failed'}: ${result.error?.message ?? 'unknown error'}`);
    }
    /**
     * Replay a swallowed paste as a synthetic clipboard event so the composer's
     * own intake (limits, thumbnails, keyboard) runs with the captured files.
     * @returns false when the environment cannot construct a clipboard payload.
     */
    replayPaste(target, files, text) {
        let data;
        try {
            data = new DataTransfer();
            for (const file of files)
                data.items.add(file);
            if (text !== '')
                data.setData('text/plain', text);
        }
        catch {
            return false;
        }
        let event;
        try {
            event = new ClipboardEvent('paste', {
                clipboardData: data,
                bubbles: true,
                cancelable: true,
            });
        }
        catch {
            return false;
        }
        if (event.clipboardData === null || event.clipboardData.files.length === 0)
            return false;
        this.replaying = true;
        try {
            target.dispatchEvent(event);
        }
        finally {
            this.replaying = false;
        }
        return true;
    }
    /**
     * Auto-switch flow: switch the Session to the image-input variant, announce
     * it, then replay the paste into the composer's native intake. A failed
     * switch, or an environment that cannot replay clipboard bytes, degrades to
     * the path takeover with the same files.
     * @param sessionId - the live Session id.
     * @param target - the composer textarea the paste landed on.
     * @param files - the captured image files.
     * @param text - same-paste text, replayed alongside the files.
     * @param route - the validated variant route to switch to.
     */
    async autoSwitchPaste(sessionId, target, files, text, route) {
        const input = this.inputFor(sessionId);
        try {
            await this.switchModel(sessionId, route);
            const { hidden } = await (0, display_config_ts_1.readDisplayConfig)();
            input.notify('info', hidden
                ? 'Visual enhancement active: pasted images keep the native attachment flow'
                : `Switched to ${route.label || `${route.model} (Vision Toolkit)`}; pasted images now keep the native attachment flow`);
        }
        catch (error) {
            input.notify('error', `Model switch failed; images will be sent as workspace paths: ${message(error)}`);
            this.takeoverPaste(sessionId, target, files, text);
            return;
        }
        // Replaying lets the composer's own intake run (thumbnail, limits,
        // keyboard); if the environment cannot replay clipboard bytes, the
        // images still land as workspace paths.
        const before = input.state.getSnapshot().imageIds.length;
        const replayed = this.replayPaste(target, files, text);
        const after = input.state.getSnapshot().imageIds.length;
        if (!replayed || after <= before) {
            this.takeoverPaste(sessionId, target, files, text);
        }
    }
    /**
     * Path-takeover flow: insert the same-paste text and every image as a text
     * reference that serializes to the image's workspace path on send.
     * @param sessionId - the live Session id.
     * @param target - the composer textarea the paste landed on.
     * @param files - the captured image files.
     * @param text - same-paste text.
     */
    takeoverPaste(sessionId, target, files, text) {
        const input = this.inputFor(sessionId);
        const snapshot = input.state.getSnapshot();
        if (snapshot.phase !== 'plain')
            return;
        const start = Math.max(0, Math.min(target.selectionStart ?? snapshot.draft.length, snapshot.draft.length));
        const end = Math.max(start, Math.min(target.selectionEnd ?? start, snapshot.draft.length));
        try {
            let cursor = this.insertText(input, text, start, end);
            validateImages(files);
            cursor = this.insertRecords(sessionId, input, files, cursor);
            requestAnimationFrame(() => {
                target.focus({ preventScroll: true });
                target.setSelectionRange(cursor, cursor);
            });
        }
        catch (error) {
            input.notify('error', message(error));
        }
    }
    handlePaste(event) {
        if (this.replaying)
            return false;
        const files = imageFiles(event.clipboardData);
        if (files.length === 0)
            return false;
        const target = event.target;
        if (!(target instanceof HTMLTextAreaElement) || target.closest('[data-composer-card]') === null)
            return false;
        const sessionId = this.ctx.sessions.list.getSnapshot().current;
        if (sessionId === undefined)
            return false;
        const modelLabel = currentModelLabel();
        this.refreshVerdict(sessionId, modelLabel);
        // Only a fresh host verdict acts; the native attachment flow stays the
        // default while the host is unconfirmed.
        const verdict = this.verdictFor(sessionId, modelLabel);
        if (verdict === undefined)
            return false;
        // An image-capable model (the variant routes included) keeps its native
        // paste: no switch, no takeover.
        if (verdict.takeOver === false && verdict.autoSwitch === undefined)
            return false;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const input = this.inputFor(sessionId);
        if (input.state.getSnapshot().phase !== 'plain')
            return true;
        const text = (event.clipboardData?.getData('text/plain') ?? '').replaceAll('\uFFFC', '');
        if (verdict.autoSwitch !== undefined) {
            // The text-only model has an image-input variant: switch first, then
            // let the paste flow natively so the thumbnail and durable session
            // image are preserved.
            void this.autoSwitchPaste(sessionId, target, files, text, verdict.autoSwitch);
            return true;
        }
        this.takeoverPaste(sessionId, target, files, text);
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
        // A focus-time prefetch has the verdict ready before the first paste can land.
        const onFocusIn = () => {
            const sessionId = ctx.sessions.list.getSnapshot().current;
            if (sessionId !== undefined)
                controller.refreshVerdict(String(sessionId), currentModelLabel());
        };
        document.addEventListener('paste', listener, true);
        document.addEventListener('focusin', onFocusIn, true);
        return () => {
            document.removeEventListener('paste', listener, true);
            document.removeEventListener('focusin', onFocusIn, true);
        };
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
