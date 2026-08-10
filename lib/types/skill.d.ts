/**
 * DSH-adapted vision-tools methodology. The skill names only native tools in
 * this release, explains which calls send images to the configured external
 * vision API, and treats every returned Artifact descriptor as reusable input
 * rather than an opaque terminal path.
 * @module dsh-vision-toolkit/skill
 */
import type { SkillRegistration } from '@deepseek-ai/dsh-skill';
/** Runtime skill registration mounted only after every native tool is ready. */
export declare const VISION_TOOLS_SKILL: SkillRegistration;
//# sourceMappingURL=skill.d.ts.map