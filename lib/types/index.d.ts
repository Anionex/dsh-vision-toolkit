/**
 * @anionex/dsh-vision-toolkit — DSH Vision Toolkit profile bundle.
 *
 * Verify bundled assets and publish the Skill/bootstrap before preparing the
 * runtime in the background. Skill-scoped calls wait for readiness and report
 * preparation failures; disposal cancels preparation and removes contributions.
 * @module @anionex/dsh-vision-toolkit
 */
import type { Context } from '@deepseek-ai/cordis';
import { type VisionToolkitConfig } from './config.ts';
export declare const name = "@anionex/dsh-vision-toolkit";
export { Config } from './config.ts';
export declare const inject: string[];
/** Plugin entry: validate configuration synchronously, then mount asynchronously. */
export declare function apply(ctx: Context, config?: VisionToolkitConfig): Promise<() => void>;
//# sourceMappingURL=index.d.ts.map