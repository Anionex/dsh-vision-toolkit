/**
 * @anionex/dsh-vision-toolkit — DSH Vision Toolkit profile bundle.
 *
 * Plugin lifecycle follows the documented readiness chain: verify the pinned
 * upstream checkout, publish the vision-skills Skill and its one-shot bootstrap,
 * then mount the execution tools only in Agents that load that Skill or invoke
 * the bootstrap. Any
 * failure leaves no model capability behind, and disposal unregisters every
 * global and Agent-scoped contribution the plugin mounted.
 * @module @anionex/dsh-vision-toolkit
 */
import type { Context } from '@deepseek-ai/cordis';
import { Config, type VisionToolkitConfig } from './config.ts';
export declare const name = "@anionex/dsh-vision-toolkit";
export { Config };
export declare const inject: string[];
/** Plugin entry: validate configuration synchronously, then mount asynchronously. */
export declare function apply(ctx: Context, config?: VisionToolkitConfig): Promise<() => void>;
//# sourceMappingURL=index.d.ts.map