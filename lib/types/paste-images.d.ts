/** Workspace-local storage for images pasted into the DSH Web composer. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
/** Exact route used by the browser paste integration. */
export declare const PASTE_IMAGES_ROUTE = "/_dsh/vision-toolkit/paste-images";
/**
 * Exact route the browser paste integration asks before taking a paste over:
 * `GET ?sessionId=&model=&provider=&modelId=` answers the verdict from the
 * live Session's model route.
 */
export declare const PASTE_POLICY_ROUTE = "/_dsh/vision-toolkit/paste-policy";
/**
 * One exact model route the browser should switch the Session to before the
 * native attachment flow: the image-input variant of the current text-only
 * model. The variant declares image input, so the paste keeps the composer
 * thumbnail and the durable session image.
 */
export interface PasteSwitchRoute {
    /** The variant provider route (`vision-toolkit-` + upstream provider id). */
    provider: string;
    /** The model id, identical to the upstream text-only model's id. */
    model: string;
    /** The variant's selector display name (upstream name + variant suffix). */
    label: string;
    /** The upstream reasoning effort, when the selection carries one. */
    reasoningEffort?: string;
}
/** The exact model route the browser read from the live model catalog. */
export interface PasteSelectionQuery {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
/** The paste-policy answer for one Session and model route. */
export interface PasteVerdict {
    /** Whether the browser should turn the paste into workspace paths instead of attachments. */
    takeOver: boolean;
    /** When present, the browser switches to this route first, then lets the paste flow natively. */
    autoSwitch?: PasteSwitchRoute;
}
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