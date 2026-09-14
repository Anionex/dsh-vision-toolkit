/** Safe per-session routing headers for vision-provider requests. */
/** Bounds keep the internal JSON environment value small and predictable. */
export declare const MAX_SESSION_HEADER_COUNT = 8;
export declare const MAX_SESSION_HEADER_NAME_LENGTH = 128;
export declare const MAX_SESSION_HEADERS_JSON_BYTES = 1024;
/** Normalize and validate user-configured session-routing header names. */
export declare function normalizeSessionHeaderNames(input: readonly string[]): string[];
export type SessionHeaderRouter = (names: readonly string[], operationKey: string) => Record<string, string>;
/** Create one stable router; production uses one random secret for the process lifetime. */
export declare function createSessionHeaderRouter(secret?: Uint8Array): SessionHeaderRouter;
/** Build the opaque routing headers for one operation. */
export declare function sessionHeadersForOperation(names: readonly string[], operationKey: string): Record<string, string>;
//# sourceMappingURL=session-headers.d.ts.map