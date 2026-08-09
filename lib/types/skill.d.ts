/**
 * The DSH-adapted vision-tools skill. It keeps the upstream methodology but
 * names only the native tools this plugin registers, so the skill can never
 * advertise a CLI or capability that is absent. Mounted after the runtime is
 * ready and disposed with the plugin.
 * @module dsh-vision-toolkit/skill
 */
import type { SkillRegistration } from '@deepseek-ai/dsh-skill';
/** Runtime skill registration for the DSH-adapted vision-tools skill. */
export declare const VISION_TOOLS_SKILL: SkillRegistration;
//# sourceMappingURL=skill.d.ts.map