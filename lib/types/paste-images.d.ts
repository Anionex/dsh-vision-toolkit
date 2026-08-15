/** Workspace-local storage for images pasted into the DSH Web composer. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
/** Exact route used by the browser paste integration. */
export declare const PASTE_IMAGES_ROUTE = "/_dsh/vision-toolkit/paste-images";
/**
 * Exact route the browser paste integration asks before taking a paste over:
 * `GET ?sessionId=` answers `{ takeOver }` from the live Session's model route.
 */
export declare const PASTE_POLICY_ROUTE = "/_dsh/vision-toolkit/paste-policy";
/** Convert an untrusted browser label into one portable leaf filename. */
export declare function safePastedImageName(raw: string, mediaType: string): string;
/** Reject a resolved path that is not rooted below the expected directory. */
export declare function ensurePathInside(root: string, target: string): void;
/** Runtime limit face kept separate for focused backend tests. */
export interface PasteImageRuntime {
    maxImageBytes(): number;
}
/** Same-origin, live-Session-bound image upload endpoint. */
export declare class PastedImageBackend {
    private readonly ctx;
    private readonly runtime;
    constructor(ctx: Context, runtime: PasteImageRuntime);
    handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}
//# sourceMappingURL=paste-images.d.ts.map