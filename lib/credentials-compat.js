/** Keep the interactive provider authoritative; headless uses the host launch snapshot. */
export async function resolveVisionCredential(ctx, ref) {
    const credentials = ctx.get('credentials');
    if (credentials !== undefined)
        return credentials.resolve(ref);
    const launch = ctx.get('launchEnvironment');
    const entry = launch === undefined
        ? (process.env[ref] ? { value: process.env[ref], source: 'process' } : undefined)
        : launch.get(ref);
    return entry?.value ? { value: entry.value, source: entry.source } : undefined;
}
//# sourceMappingURL=credentials-compat.js.map