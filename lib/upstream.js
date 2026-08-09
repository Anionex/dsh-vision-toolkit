/**
 * Upstream adapter: locates the pinned agent-vision-toolkit checkout, converts
 * structured requests into direct Python invocations (never shell-concatenated),
 * captures bounded stdout/stderr, and converts the upstream's stable text
 * contracts into structured results. All algorithm behavior stays upstream.
 * @module dsh-vision-toolkit/upstream
 */
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { VisionToolkitError, upstreamFailureMessage } from "./errors.js";
import { UPSTREAM_COMMIT, UPSTREAM_REPOSITORY, UPSTREAM_VERSION } from "./version.js";
/** Stable upstream output parsers, exported for direct unit testing. */
const BOX_SUFFIX = /x1:\s*(\d+),\s*y1:\s*(\d+),\s*x2:\s*(\d+),\s*y2:\s*(\d+)\s*$/;
const POSITION_WORDS = new Set([
    'top-left', 'top', 'top-right', 'left', 'center', 'right',
    'bottom-left', 'bottom', 'bottom-right',
]);
/** Parse one numbered upstream location line (`N. position label x1: ..., ...`). */
export function parseLocationLine(line) {
    const match = BOX_SUFFIX.exec(line.trim());
    if (match === null)
        return undefined;
    const box = {
        x1: Number(match[1]),
        y1: Number(match[2]),
        x2: Number(match[3]),
        y2: Number(match[4]),
    };
    const prefix = line.slice(0, match.index).trim();
    const numbered = /^\d+\.\s+/.exec(prefix);
    const withoutIndex = numbered === null ? prefix : prefix.slice(numbered[0].length).trim();
    const words = withoutIndex.split(/\s+/);
    const label = words.length > 0 && POSITION_WORDS.has(words[0] ?? '')
        ? words.slice(1).join(' ')
        : withoutIndex;
    return { ...(label.length > 0 ? { label } : {}), box };
}
/** Parse ground/detect stdout into located elements; empty output means no matches. */
export function parseLocationOutput(stdout) {
    const elements = [];
    for (const line of stdout.split(/\r?\n/)) {
        if (line.trim().length === 0 || line.trim() === 'no elements detected')
            continue;
        const parsed = parseLocationLine(line);
        if (parsed !== undefined)
            elements.push(parsed);
    }
    return elements;
}
/** Parse the crop CLI's `wrote <path> (WxH)` line and clamp note. */
export function parseCropOutput(stdout, stderr) {
    const wrote = /wrote\s+(.+?)\s+\((\d+)x(\d+)\)\s*$/.exec(stdout.trim());
    if (wrote === null) {
        throw new VisionToolkitError('output', 'crop: upstream did not report a written file');
    }
    const clampedMatch = /note:\s*region\s+.*?clamped\s+to\s+([-\d,\s]+)/.exec(stderr);
    return {
        outputPath: wrote[1] ?? '',
        width: Number(wrote[2]),
        height: Number(wrote[3]),
        clamped: clampedMatch !== null,
        ...(clampedMatch !== null ? { note: `region clamped to ${clampedMatch[1]?.trim() ?? 'unknown'}` } : {}),
    };
}
/** Parse the trace `--report` JSON into the plugin's typed view. */
export function parseTraceReport(text) {
    let payload;
    try {
        payload = JSON.parse(text);
    }
    catch (error) {
        throw new VisionToolkitError('output', 'trace: upstream report is not valid JSON', { cause: error });
    }
    if (typeof payload !== 'object' || payload === null) {
        throw new VisionToolkitError('output', 'trace: upstream report is not an object');
    }
    const record = payload;
    const geometry = record.geometry;
    if (typeof geometry !== 'object' || geometry === null) {
        throw new VisionToolkitError('output', 'trace: upstream report lacks geometry');
    }
    const geometryRecord = geometry;
    if (typeof geometryRecord.status !== 'string') {
        throw new VisionToolkitError('output', 'trace: upstream report geometry.status is missing');
    }
    const logicalSize = record.logical_size;
    const size = Array.isArray(logicalSize) && logicalSize.length >= 2
        ? [Number(logicalSize[0]), Number(logicalSize[1])]
        : [0, 0];
    const perception = record.perception;
    return {
        mode: typeof record.mode === 'string' ? record.mode : 'deterministic',
        logicalSize: size,
        ...(typeof perception === 'object' && perception !== null
            ? {
                perception: {
                    ...(typeof perception.label === 'string'
                        ? { label: perception.label }
                        : {}),
                    ...(perception.confidence !== undefined
                        ? { confidence: perception.confidence }
                        : {}),
                },
            }
            : {}),
        geometry: {
            status: geometryRecord.status,
            confidence: geometryRecord.confidence,
            ...(typeof geometryRecord.primitive_count === 'number' ? { primitiveCount: geometryRecord.primitive_count } : {}),
            ...(typeof geometryRecord.representation === 'string' ? { representation: geometryRecord.representation } : {}),
            ...(typeof geometryRecord.stroke_width === 'number' ? { strokeWidth: geometryRecord.stroke_width } : {}),
            ...(typeof geometryRecord.pixel_fit === 'number' ? { pixelFit: geometryRecord.pixel_fit } : {}),
        },
    };
}
/** Conventional upstream locations probed when no explicit path is configured. */
export function defaultUpstreamCandidates() {
    const explicit = process.env.AGENT_VISION_TOOLKIT_PATH;
    return [
        ...(explicit !== undefined && explicit.trim().length > 0 ? [explicit.trim()] : []),
        join(homedir(), '.config', 'agent-vision-toolkit'),
        join(homedir(), '.dsh', 'vision-toolkit', 'agent-vision-toolkit'),
        join(homedir(), 'agent-vision-toolkit'),
    ];
}
const TOOL_SCRIPTS = ['glance', 'ground', 'detect', 'crop', 'trace'];
/** Whether one candidate root carries every required upstream bin script. */
async function isCheckout(root) {
    for (const tool of TOOL_SCRIPTS) {
        try {
            const info = await stat(join(root, 'bin', tool));
            if (!info.isFile())
                return false;
        }
        catch {
            return false;
        }
    }
    return true;
}
/**
 * Find the first candidate that is a real upstream checkout: a directory
 * containing every required bin script. A conventional location that exists
 * but is only a config directory is skipped, not treated as the runtime.
 * @param candidates - candidate roots in priority order.
 * @returns the real path of the first valid checkout.
 */
export async function findCheckout(candidates) {
    const attempts = [];
    for (const candidate of candidates) {
        let real;
        try {
            real = await realpath(candidate);
        }
        catch {
            attempts.push(candidate);
            continue;
        }
        try {
            const info = await stat(real);
            if (!info.isDirectory()) {
                attempts.push(`${candidate} (not a directory)`);
                continue;
            }
        }
        catch {
            attempts.push(`${candidate} (not readable)`);
            continue;
        }
        if (await isCheckout(real))
            return real;
        attempts.push(`${candidate} (missing required bin scripts)`);
    }
    throw new VisionToolkitError('runtime', `agent-vision-toolkit checkout not found; tried: ${attempts.join('; ')}; clone https://github.com/Anionex/agent-vision-toolkit at commit ${UPSTREAM_COMMIT} and configure runtime.agentVisionToolkitPath`);
}
/**
 * Adapter over one pinned upstream checkout. `prepare()` runs synchronously
 * enough to be part of plugin load: stat-based verification of the checkout
 * layout; the plugin registers tools and skill only after it succeeds.
 */
export class UpstreamAdapter {
    ctx;
    config;
    version;
    secrets = [];
    constructor(ctx, config, version) {
        this.ctx = ctx;
        this.config = config;
        this.version = version ?? {
            repository: UPSTREAM_REPOSITORY,
            version: UPSTREAM_VERSION,
            commit: UPSTREAM_COMMIT,
            path: '',
        };
    }
    /** Upstream identity reported to tools and logs. */
    get versionInfo() {
        return this.version;
    }
    /** Secrets currently known to the adapter (used for redaction). */
    get secretValues() {
        return this.secrets;
    }
    /**
     * Verify the upstream checkout layout; throws a runtime error with the
     * next action when anything is missing.
     */
    async prepare() {
        const candidates = this.config.runtime.agentVisionToolkitPath !== undefined
            ? [this.config.runtime.agentVisionToolkitPath]
            : defaultUpstreamCandidates();
        const root = await findCheckout(candidates);
        this.version = { ...this.version, path: root };
    }
    /**
     * Run one upstream CLI with explicit vision env. Never goes through a
     * shell: argv is passed verbatim to the managed subprocess.
     */
    async run(tool, args, options) {
        if (this.version.path.length === 0)
            await this.prepare();
        const script = join(this.version.path, 'bin', tool);
        const handle = this.ctx.subprocess.spawn({
            argv: [this.config.runtime.python, script, ...args],
            cwd: options.workspace,
            stdio: {
                stdin: 'ignore',
                stdout: { maxBytes: 512 * 1024, spill: { maxBytes: 8 * 1024 * 1024 } },
                stderr: { maxBytes: 256 * 1024, spill: { maxBytes: 8 * 1024 * 1024 } },
            },
            graceMs: 2000,
            signal: options.signal,
            env: {
                VISION_API_KEY: options.env.VISION_API_KEY,
                VISION_BASE_URL: options.env.VISION_BASE_URL,
                VISION_MODEL: options.env.VISION_MODEL,
                LANG: options.env.LANG,
            },
        });
        this.secrets = [options.env.VISION_API_KEY];
        try {
            const outcome = await handle.done;
            const stdout = handle.collected.stdout?.readFrom(0);
            const stderr = handle.collected.stderr?.readFrom(0);
            return {
                stdout: stdout?.text ?? '',
                stderr: stderr?.text ?? '',
                stdoutTruncated: stdout?.lossy ?? false,
                stderrTruncated: stderr?.lossy ?? false,
                outcome,
            };
        }
        catch (error) {
            throw new VisionToolkitError('runtime', `${tool}: failed to start ${this.config.runtime.python}`, { cause: error });
        }
    }
    /**
     * Read an image's pixel dimensions through the upstream's own Pillow
     * dependency without inventing a second image codec.
     */
    async probeImageSize(imagePath, options) {
        const script = [
            'import sys',
            'try:',
            '    from PIL import Image',
            'except ImportError:',
            '    print("NO_PIL", file=sys.stderr); sys.exit(2)',
            'try:',
            '    with Image.open(sys.argv[1]) as im: print(f"{im.width}x{im.height}")',
            'except Exception as exc:',
            '    print(f"IMAGE_ERROR: {exc}", file=sys.stderr); sys.exit(3)',
        ].join('\n');
        const handle = this.ctx.subprocess.spawn({
            argv: [this.config.runtime.python, '-c', script, imagePath],
            cwd: options.workspace,
            stdio: {
                stdin: 'ignore',
                stdout: { maxBytes: 4096 },
                stderr: { maxBytes: 4096 },
            },
            graceMs: 2000,
            signal: options.signal,
        });
        const outcome = await this.collectProbe(handle);
        if (outcome.outcome.exitCode !== 0) {
            if (outcome.stderr.includes('NO_PIL')) {
                throw new VisionToolkitError('runtime', 'vision-toolkit requires Pillow for the upstream runtime (pip install pillow)');
            }
            throw new VisionToolkitError('output', `cannot read image dimensions: ${outcome.stderr.trim() || 'unknown error'}`);
        }
        const match = /^(\d+)x(\d+)$/.exec(outcome.stdout.trim());
        if (match === null) {
            throw new VisionToolkitError('output', `cannot read image dimensions: unexpected upstream output`);
        }
        return { width: Number(match[1]), height: Number(match[2]) };
    }
    async collectProbe(handle) {
        const outcome = await handle.done;
        const stdout = handle.collected.stdout?.readFrom(0);
        const stderr = handle.collected.stderr?.readFrom(0);
        return {
            stdout: stdout?.text ?? '',
            stderr: stderr?.text ?? '',
            stdoutTruncated: stdout?.lossy ?? false,
            stderrTruncated: stderr?.lossy ?? false,
            outcome,
        };
    }
    /**
     * Read the pinned version marker from the checkout (`VERSION` file when
     * present), falling back to the packaged pin.
     */
    async readCheckoutVersion() {
        if (this.version.path.length === 0)
            await this.prepare();
        try {
            const value = (await readFile(join(this.version.path, 'VERSION'), 'utf8')).trim();
            return value.length > 0 ? value : this.version.version;
        }
        catch {
            return this.version.version;
        }
    }
    /** Whether the upstream checkout exposes the optional `html_shot` script (P1 surface). */
    async hasScript(name) {
        if (this.version.path.length === 0)
            await this.prepare();
        try {
            const entries = await readdir(join(this.version.path, 'scripts'));
            return entries.includes(name);
        }
        catch {
            return false;
        }
    }
    /** Turn a failed run into a model-safe classified error. */
    classifyFailure(tool, result, options) {
        if (options.cancelled)
            return new VisionToolkitError('cancelled', `${tool}: cancelled`);
        if (options.timedOut)
            return new VisionToolkitError('cancelled', `${tool}: timed out`);
        if (result.stdoutTruncated || result.stderrTruncated) {
            return new VisionToolkitError('output', `${tool}: upstream output exceeded the capture limit`);
        }
        const message = upstreamFailureMessage(tool, result.stderr, this.secrets);
        if (/production gate failed/i.test(result.stderr)) {
            return new VisionToolkitError('output', message);
        }
        if (/HTTP 401|401|Unauthorized|authentication/i.test(result.stderr)) {
            return new VisionToolkitError('service', message);
        }
        if (/HTTP 429|429|rate limit|quota/i.test(result.stderr)) {
            return new VisionToolkitError('service', message);
        }
        if (/Missing config VISION_|Not found|Image not found|Only PNG/i.test(result.stderr)) {
            return new VisionToolkitError('input', message);
        }
        return new VisionToolkitError('service', message);
    }
}
//# sourceMappingURL=upstream.js.map