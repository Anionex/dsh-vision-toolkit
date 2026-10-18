/** Credential reads across interactive and one-shot DSH profiles. */
import type { Context } from '@deepseek-ai/cordis';
import type { CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials';
/** Keep the interactive provider authoritative; headless uses the host launch snapshot. */
export declare function resolveVisionCredential(ctx: Context, ref: CredentialRef): Promise<ResolvedCredential | undefined>;
//# sourceMappingURL=credentials-compat.d.ts.map