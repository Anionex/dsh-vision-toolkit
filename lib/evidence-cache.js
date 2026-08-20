/** Durable, Session-scoped cache for image descriptions used by model variants. */
import { createHash } from 'node:crypto';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import { UPSTREAM_COMMIT } from "./version.js";
/** Bump only when the model-visible evidence contract changes incompatibly. */
export const EVIDENCE_CONTRACT_VERSION = 1;
/** Persistent cache bounds keep the Profile storage proportional and predictable. */
const DEFAULT_PERSISTED_ENTRY_LIMIT = 512;
const DEFAULT_PERSISTED_BYTE_LIMIT = 8 * 1024 * 1024;
const DEFAULT_PERSISTED_ENTRY_BYTE_LIMIT = 64 * 1024;
const MAX_SCHEMA_TEXT_CHARS = 256 * 1024;
const MAX_SCHEMA_RECORD_CHARS = 512 * 1024;
const hexDigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const sessionIdentitySchema = z.object({
    createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    cwd: z.string().optional(),
});
const evidenceRecordSchema = z.object({
    contractVersion: z.number().int().nonnegative(),
    sessionId: z.string().min(1),
    session: sessionIdentitySchema,
    attachmentId: z.string().min(1),
    promptHash: hexDigestSchema,
    runtimeHash: hexDigestSchema,
    text: z.string().min(1).max(MAX_SCHEMA_TEXT_CHARS),
    storedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
/** Plugin-owned sidecar domain; the host backend handles atomicity and file safety. */
export const evidenceCacheDomainSpec = defineDomain({
    name: 'vision_toolkit_evidence',
    version: 0,
    tables: {
        // Keep the durable boundary tolerant of one damaged cache payload: each
        // record is parsed and validated independently below, so corruption causes
        // a miss instead of preventing the entire optional domain from opening.
        evidence: domainTable(z.string().max(MAX_SCHEMA_RECORD_CHARS)),
    },
});
function hash(value) {
    return createHash('sha256').update(value).digest('hex');
}
/** Fingerprint every runtime setting that can change the generated description. */
export function evidenceRuntimeFingerprint(config, credentialSha256) {
    return hash(JSON.stringify({
        upstreamCommit: UPSTREAM_COMMIT,
        provider: {
            baseUrl: config.provider.baseUrl,
            credential: {
                ref: String(config.provider.credential),
                sha256: credentialSha256 ?? null,
            },
            model: config.provider.model,
            protocol: config.provider.protocol,
            anthropicThinking: config.provider.anthropicThinking,
            userAgent: config.provider.userAgent,
        },
        language: config.language,
        timeoutMs: config.timeoutMs,
        maxImageBytes: config.maxImageBytes,
        maxImagePixels: config.maxImagePixels,
        runtime: config.runtime,
    }));
}
/** Build a non-secret cache key from the Session, attachment, focus, and runtime contract. */
export function createEvidenceCacheKey(input) {
    const promptHash = hash(input.prompt);
    const digest = hash(JSON.stringify([
        EVIDENCE_CONTRACT_VERSION,
        input.sessionId ?? '',
        input.sessionIdentity?.createdAt ?? '',
        input.sessionIdentity?.cwd ?? '',
        input.attachmentId,
        promptHash,
        input.runtimeHash,
    ]));
    return Object.freeze({
        digest,
        contractVersion: EVIDENCE_CONTRACT_VERSION,
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        ...(input.sessionIdentity === undefined ? {} : { sessionCreatedAt: input.sessionIdentity.createdAt }),
        ...(input.sessionIdentity?.cwd === undefined ? {} : { sessionCwd: input.sessionIdentity.cwd }),
        attachmentId: input.attachmentId,
        promptHash,
        runtimeHash: input.runtimeHash,
    });
}
/** Bounded promise cache; concurrent readers join one load and rejected loads are evicted. */
export class EvidenceCache {
    limit;
    persistence;
    entries = new Map();
    constructor(limit, persistence) {
        this.limit = limit;
        this.persistence = persistence;
    }
    /** Read a memory/durable hit or compute and persist one model-visible result. */
    read(key, load) {
        const memoryKey = typeof key === 'string' ? key : key.digest;
        const existing = this.entries.get(memoryKey);
        if (existing !== undefined) {
            // Refresh recency: Map iteration order is insertion order.
            this.entries.delete(memoryKey);
            this.entries.set(memoryKey, existing);
            return existing;
        }
        const pending = (async () => {
            if (typeof key !== 'string' && this.persistence !== undefined) {
                try {
                    const persisted = await this.persistence.read(key);
                    if (persisted !== undefined)
                        return persisted;
                }
                catch {
                    // Persistence is an optimization; a damaged/unavailable sidecar must
                    // never block the model request from recomputing evidence.
                }
            }
            const block = await load();
            if (typeof key !== 'string' && this.persistence !== undefined) {
                try {
                    await this.persistence.write(key, block);
                }
                catch {
                    // Keep the process-local result even when durability fails.
                }
            }
            return block;
        })().then(block => block, (error) => {
            // Only evict our own entry: this promise may have been LRU-evicted and
            // the key re-populated by a newer read meanwhile.
            if (this.entries.get(memoryKey) === pending) {
                this.entries.delete(memoryKey);
            }
            throw error;
        });
        this.entries.set(memoryKey, pending);
        while (this.entries.size > this.limit) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined)
                break;
            this.entries.delete(oldest);
        }
        return pending;
    }
    /** Drop process-local descriptions; durable rows stay versioned by their runtime fingerprint. */
    clear() {
        this.entries.clear();
    }
}
function identityOf(header) {
    return Object.freeze({
        createdAt: header.createdAt,
        ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
    });
}
function sameIdentity(record, header) {
    return record.session.createdAt === header.createdAt && record.session.cwd === header.cwd;
}
function matchesKey(record, key) {
    return record.contractVersion === key.contractVersion
        && record.sessionId === key.sessionId
        && record.attachmentId === key.attachmentId
        && record.promptHash === key.promptHash
        && record.runtimeHash === key.runtimeHash;
}
function byteLength(text) {
    return Buffer.byteLength(text, 'utf8');
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
function parseRecord(value) {
    try {
        const parsed = JSON.parse(value);
        const result = evidenceRecordSchema.safeParse(parsed);
        return result.success ? result.data : undefined;
    }
    catch {
        return undefined;
    }
}
/** Official DSH storage-domain sidecar used to survive Profile restarts. */
export class SessionEvidenceStore {
    ctx;
    storage;
    storageFiber;
    storageReady;
    mutationTail = Promise.resolve();
    flushes = new Map();
    warned = false;
    maxEntries;
    maxBytes;
    maxEntryBytes;
    now;
    constructor(ctx, options = {}) {
        this.ctx = ctx;
        this.maxEntries = options.maxEntries ?? DEFAULT_PERSISTED_ENTRY_LIMIT;
        this.maxBytes = options.maxBytes ?? DEFAULT_PERSISTED_BYTE_LIMIT;
        this.maxEntryBytes = options.maxEntryBytes ?? DEFAULT_PERSISTED_ENTRY_BYTE_LIMIT;
        this.now = options.now ?? Date.now;
        if (typeof ctx.inject !== 'function')
            return;
        this.storageFiber = ctx.inject(['storageDomain'], async (storageCtx) => {
            const domain = await storageCtx.storageDomain.open(evidenceCacheDomainSpec);
            const binding = { table: domain.table('evidence') };
            try {
                await this.enqueueMutation(async () => { await this.prune(binding.table); });
                this.storage = binding;
            }
            catch (error) {
                await domain.close();
                throw error;
            }
            return async () => {
                if (this.storage === binding)
                    this.storage = undefined;
                await this.mutationTail;
                await domain.close();
            };
        });
        this.storageReady = Promise.resolve(this.storageFiber).then(() => undefined, (error) => { this.warnOnce(error); });
    }
    /** Release the optional storage binding with the owning variant lifecycle. */
    dispose() {
        const fiber = this.storageFiber;
        this.storageFiber = undefined;
        this.storageReady = undefined;
        if (fiber !== undefined)
            void fiber.dispose().catch(error => { this.warnOnce(error); });
    }
    async read(key) {
        const session = this.sessionFor(key);
        if (session === undefined)
            return undefined;
        const binding = await this.prepareStorage();
        if (binding === undefined)
            return undefined;
        const stored = binding.table.get(key.digest);
        const record = stored === undefined ? undefined : parseRecord(stored);
        if (record === undefined || !matchesKey(record, key) || !sameIdentity(record, session.header)) {
            return undefined;
        }
        if (byteLength(record.text) > this.maxEntryBytes)
            return undefined;
        return { type: 'text', text: record.text };
    }
    async write(key, block) {
        if (block.type !== 'text' || block.text.length === 0 || byteLength(block.text) > this.maxEntryBytes)
            return;
        const session = this.sessionFor(key);
        if (session === undefined)
            return;
        const binding = await this.prepareStorage();
        if (binding === undefined)
            return;
        try {
            const participated = await this.flushSession(session);
            if (!participated)
                return;
            const record = Object.freeze({
                contractVersion: key.contractVersion,
                sessionId: key.sessionId,
                session: identityOf(session.header),
                attachmentId: key.attachmentId,
                promptHash: key.promptHash,
                runtimeHash: key.runtimeHash,
                text: block.text,
                storedAt: this.now(),
            });
            await this.enqueueMutation(async () => {
                await binding.table.put(key.digest, JSON.stringify(record));
                await this.prune(binding.table);
            });
        }
        catch (error) {
            this.warnOnce(error);
        }
    }
    sessionFor(key) {
        if (key.sessionId === undefined)
            return undefined;
        const session = this.ctx.sessions.get(key.sessionId);
        if (session === undefined)
            return undefined;
        if (key.sessionCreatedAt !== undefined
            && (session.header.createdAt !== key.sessionCreatedAt || session.header.cwd !== key.sessionCwd)) {
            return undefined;
        }
        return session;
    }
    async prepareStorage() {
        if (this.storage !== undefined)
            return this.storage;
        if (this.ctx.get('storageDomain') === undefined)
            return undefined;
        await this.storageReady;
        return this.storage;
    }
    enqueueMutation(operation) {
        const result = this.mutationTail.then(operation);
        this.mutationTail = result.then(() => undefined, () => undefined);
        return result;
    }
    flushSession(session) {
        const key = `${session.id}\u0000${session.header.createdAt}\u0000${session.header.cwd ?? ''}`;
        const existing = this.flushes.get(key);
        if (existing !== undefined)
            return existing;
        const pending = this.ctx.sessions.flush(session).finally(() => {
            if (this.flushes.get(key) === pending)
                this.flushes.delete(key);
        });
        this.flushes.set(key, pending);
        return pending;
    }
    async prune(table) {
        const records = [...table.entries()].map(([key, stored]) => {
            const record = parseRecord(stored);
            return {
                key,
                bytes: byteLength(stored),
                storedAt: record?.storedAt ?? -1,
                valid: record !== undefined && byteLength(record.text) <= this.maxEntryBytes,
            };
        });
        let totalBytes = records.reduce((sum, record) => sum + record.bytes, 0);
        let totalEntries = records.length;
        records.sort((left, right) => Number(left.valid) - Number(right.valid)
            || left.storedAt - right.storedAt
            || left.key.localeCompare(right.key));
        for (const record of records) {
            if (record.valid && totalEntries <= this.maxEntries && totalBytes <= this.maxBytes)
                break;
            if (await table.delete(record.key)) {
                totalEntries -= 1;
                totalBytes -= record.bytes;
            }
        }
    }
    warnOnce(error) {
        if (this.warned)
            return;
        this.warned = true;
        this.ctx.logger?.warn('dsh-vision-toolkit: persistent image evidence cache is unavailable; using the process cache only. %s', messageOf(error).slice(0, 500));
    }
}
//# sourceMappingURL=evidence-cache.js.map