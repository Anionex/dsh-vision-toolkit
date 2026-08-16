/**
 * DSH-native adapter for the upstream vision-tools Skill and playbooks.
 * @module dsh-vision-toolkit/skill
 */
import type { SkillRegistration } from '@deepseek-ai/dsh-skill';
/** Stable catalog/invocation name shared with progressive tool exposure. */
export declare const VISION_TOOLS_SKILL_NAME = "vision-tools";
/** Packaged resource root for the adapted upstream playbooks. */
export declare const VISION_TOOLS_SKILL_RESOURCE_BASE: string;
/** Exact bundled instructions used as the progressive-exposure evidence marker. */
export declare const VISION_TOOLS_SKILL_CONTENT: string;
/** Runtime skill registration mounted only after every native tool is ready. */
export declare const VISION_TOOLS_SKILL: SkillRegistration;
//# sourceMappingURL=skill.d.ts.map