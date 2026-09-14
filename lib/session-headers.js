/** Safe per-session routing headers for vision-provider requests. */
import { createHmac, randomBytes } from 'node:crypto';
/** Bounds keep the internal JSON environment value small and predictable. */
export const MAX_SESSION_HEADER_COUNT = 8;
export const MAX_SESSION_HEADER_NAME_LENGTH = 128;
export const MAX_SESSION_HEADERS_JSON_BYTES = 1024;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const RESERVED_SESSION_HEADERS = new Set([
    'accept',
    'authorization',
    'connection',
    'content-length',
    'content-type',
    'cookie',
    'expect',
    'forwarded',
    'host',
    'keep-alive',
    'origin',
    'proxy-authorization',
    'proxy-connection',
    'referer',
    'set-cookie',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'user-agent',
    'via',
    'x-api-key',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'anthropic-version',
]);
/** Normalize and validate user-configured session-routing header names. */
export function normalizeSessionHeaderNames(input) {
    if (input.length > MAX_SESSION_HEADER_COUNT) {
        throw new TypeError(`provider.sessionHeaders may contain at most ${MAX_SESSION_HEADER_COUNT} names`);
    }
    const names = [];
    const seen = new Set();
    for (const raw of input) {
        const name = raw.trim().toLowerCase();
        if (name.length === 0)
            throw new TypeError('provider.sessionHeaders must not contain an empty name');
        if (name.length > MAX_SESSION_HEADER_NAME_LENGTH) {
            throw new TypeError(`provider.sessionHeaders names must be at most ${MAX_SESSION_HEADER_NAME_LENGTH} characters`);
        }
        if (!HEADER_NAME_PATTERN.test(name)) {
            throw new TypeError(`provider.sessionHeaders contains an invalid HTTP header name: ${JSON.stringify(raw)}`);
        }
        if (RESERVED_SESSION_HEADERS.has(name)) {
            throw new TypeError(`provider.sessionHeaders cannot control reserved header ${JSON.stringify(name)}`);
        }
        if (seen.has(name)) {
            throw new TypeError(`provider.sessionHeaders contains a duplicate header name: ${JSON.stringify(name)}`);
        }
        seen.add(name);
        names.push(name);
    }
    names.sort();
    const serialized = JSON.stringify(Object.fromEntries(names.map(name => [name, '0'.repeat(32)])));
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SESSION_HEADERS_JSON_BYTES) {
        throw new TypeError(`provider.sessionHeaders exceeds the ${MAX_SESSION_HEADERS_JSON_BYTES}-byte serialized limit`);
    }
    return names;
}
/** Create one stable router; production uses one random secret for the process lifetime. */
export function createSessionHeaderRouter(secret = randomBytes(32)) {
    const key = Buffer.from(secret);
    return (names, operationKey) => {
        if (names.length === 0)
            return {};
        const value = createHmac('sha256', key)
            .update('dsh-vision-toolkit/session-header/v1')
            .update('\0')
            .update(operationKey)
            .digest('hex')
            .slice(0, 32);
        return Object.fromEntries(names.map(name => [name, value]));
    };
}
const routeSessionHeaders = createSessionHeaderRouter();
/** Build the opaque routing headers for one operation. */
export function sessionHeadersForOperation(names, operationKey) {
    return routeSessionHeaders(names, operationKey);
}
//# sourceMappingURL=session-headers.js.map