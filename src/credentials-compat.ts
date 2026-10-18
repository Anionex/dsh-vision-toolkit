/** Credential reads across interactive and one-shot DSH profiles. */
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'

/** Keep the interactive provider authoritative; headless uses the host launch snapshot. */
export async function resolveVisionCredential(ctx: Context, ref: CredentialRef): Promise<ResolvedCredential | undefined> {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) return credentials.resolve(ref)
  const launch = (ctx as unknown as { get(name: string): unknown }).get('launchEnvironment') as {
    get(name: string): { value: string; source: string } | undefined
  } | undefined
  const entry = launch === undefined
    ? (process.env[ref] ? { value: process.env[ref]!, source: 'process' } : undefined)
    : launch.get(ref)
  return entry?.value ? { value: entry.value, source: entry.source } : undefined
}
