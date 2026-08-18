/**
 * Browser-side display-mode flags for transparent variant routing. The paste
 * integration uses a short-lived cache so it does not hammer the same-origin
 * route on every paste. The model selector itself decides purely from DOM
 * display names and does not read this route.
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
/**
 * Drop the cached flag and invalidate in-flight responses (test seams,
 * Settings saves, and connection-reset handling). An older request that
 * resolves afterwards must not repopulate the cache with a stale flag.
 */
export declare function resetDisplayConfigCache(): void;
//# sourceMappingURL=display-config.d.ts.map