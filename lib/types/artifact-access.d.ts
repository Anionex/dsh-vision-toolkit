/**
 * Capability-gated HTTP delivery for managed Vision Toolkit artifacts.
 * Signed tokens are durable across process restarts, expose no secret, and
 * are accepted only for the exact artifact facts projected into a tool result.
 * @module dsh-vision-toolkit/artifact-access
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JsonValue } from '@deepseek-ai/dsh-tools';
import type { ArtifactDescriptor, ArtifactKind } from './artifacts.ts';
/** Prefix owned by the plugin's artifact capability route. */
export declare const ARTIFACT_ROUTE_PREFIX = "/_dsh/vision-toolkit/artifacts";
/** Presentation metadata key reserved by the browser half of this package. */
export declare const PRESENTATION_META_KEY = "$dshVisionToolkit";
interface ArtifactTokenPayload {
    v: 1;
    path: string;
    filename: string;
    mimeType: string;
    kind: ArtifactKind;
    bytes: number;
}
/** Browser-only access grant paired to one model-visible artifact descriptor. */
export interface ArtifactAccessGrant {
    path: string;
    previewUrl: string;
    downloadUrl: string;
}
/**
 * Load or atomically create the per-DSH-home signing key.
 * @param root - state root override used by tests; defaults to the plugin cache.
 * @returns the 32-byte signing key.
 */
export declare function prepareArtifactAccessKey(root?: string): Promise<Buffer>;
/** Signed-capability encoder and safe Artifact route handler. */
export declare class ArtifactAccessController {
    private readonly key;
    private routeCount;
    constructor(key: Buffer);
    /** Whether at least one HTTP carrier currently owns the route. */
    get routeAvailable(): boolean;
    /** Mark one route attachment; the returned disposer removes that attachment. */
    attachRoute(): () => void;
    /**
     * Purely enrich a canonical tool-result value with browser access grants.
     * @param value - schema-validated tool result.
     * @returns the unchanged value when no route/artifact exists, otherwise a detached metadata envelope.
     */
    presentationMeta(value: JsonValue): JsonValue;
    /** Mint a deterministic, tamper-evident capability for one descriptor. */
    sign(artifact: ArtifactDescriptor): string;
    /** Verify and decode one capability without touching the filesystem. */
    verify(token: string): ArtifactTokenPayload | undefined;
    /**
     * Serve one GET/HEAD capability request with MIME, CSP, and symlink checks.
     * @param req - Node HTTP request matched under {@link ARTIFACT_ROUTE_PREFIX}.
     * @param res - response owned by this handler.
     */
    handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}
export {};
//# sourceMappingURL=artifact-access.d.ts.map