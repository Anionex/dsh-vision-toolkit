/**
 * @dsh-external/dsh-vision-toolkit — DSH Vision Toolkit profile bundle.
 *
 * Plugin lifecycle follows the documented readiness chain: verify the pinned
 * upstream checkout (runtime dependencies) → register the six native tools →
 * mount the vision-tools skill. Any failure leaves no tools and no skill
 * behind, and disposal unregisters everything the plugin mounted.
 * @module @dsh-external/dsh-vision-toolkit
 */
import type { Context } from 'cordis';
import { type VisionToolkitConfig } from './config.ts';
export declare const name = "@dsh-external/dsh-vision-toolkit";
export declare const inject: string[];
/** Plugin entry: validate configuration synchronously, then mount asynchronously. */
export declare function apply(ctx: Context, config?: VisionToolkitConfig): Promise<() => void>;
//# sourceMappingURL=index.d.ts.map