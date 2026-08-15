/**
 * Accept a request only from the DSH Web application's origin. Method-agnostic:
 * the same fence guards state-changing POSTs and policy GETs.
 * @param req - the incoming request whose headers carry the origin evidence.
 * @returns whether the request may be answered.
 */
export function sameOriginRequest(req) {
    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite === 'cross-site')
        return false;
    const origin = req.headers.origin;
    if (origin === undefined)
        return fetchSite === 'same-origin' || fetchSite === 'same-site' || fetchSite === 'none';
    const host = req.headers.host;
    if (host === undefined)
        return false;
    try {
        const parsed = new URL(origin);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host;
    }
    catch {
        return false;
    }
}
/** Accept state-changing requests only from the DSH Web application's origin. */
export function sameOriginPost(req) {
    return sameOriginRequest(req);
}
//# sourceMappingURL=web-request.js.map