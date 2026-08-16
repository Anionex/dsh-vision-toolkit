import type { IncomingMessage } from 'node:http';
/**
 * Accept a request only from the DSH Web application's origin. Method-agnostic:
 * the same fence guards state-changing POSTs and policy GETs.
 * @param req - the incoming request whose headers carry the origin evidence.
 * @returns whether the request may be answered.
 */
export declare function sameOriginRequest(req: IncomingMessage): boolean;
/** Accept state-changing requests only from the DSH Web application's origin. */
export declare function sameOriginPost(req: IncomingMessage): boolean;
//# sourceMappingURL=web-request.d.ts.map