/**
 * Browser-side display-mode flags for transparent variant routing. The model
 * selector integrator and the paste integration share one short-lived cache
 * so they do not hammer the same-origin route on every DOM mutation or paste.
 * @module dsh-vision-toolkit/display-config
 */
export declare const DISPLAY_CONFIG_ROUTE = "/_dsh/vision-toolkit/display-config";
/**
 * Resolve the current transparent-routing flag, failing closed to non-hidden
 * (explicit sibling entries) when the route is unreachable or the payload is
 * malformed.
 * @returns the display-mode flags observed from the host.
 */
export declare function readDisplayConfig(): Promise<{
    hidden: boolean;
}>;
/** Drop the cached flag (test seams and connection-reset handling). */
export declare function resetDisplayConfigCache(): void;
//# sourceMappingURL=display-config.d.ts.map