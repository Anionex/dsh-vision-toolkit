/**
 * DSH-native adapter for the upstream vision-tools Skill and playbooks.
 * @module dsh-vision-toolkit/skill
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
/** Stable catalog/invocation name shared with progressive tool exposure. */
export const VISION_TOOLS_SKILL_NAME = 'vision-tools';
/** Packaged resource root for the adapted upstream playbooks. */
export const VISION_TOOLS_SKILL_RESOURCE_BASE = fileURLToPath(new URL('../assets/skill/', import.meta.url));
/** Exact bundled instructions used as the progressive-exposure evidence marker. */
export const VISION_TOOLS_SKILL_CONTENT = readFileSync(new URL('../assets/skill/SKILL.md', import.meta.url), 'utf8');
/** Runtime skill registration mounted only after every native tool is ready. */
export const VISION_TOOLS_SKILL = {
    name: VISION_TOOLS_SKILL_NAME,
    description: 'Native DSH visual engineering tools adapted from agent-vision-toolkit: vision_glance, vision_ground, vision_detect, vision_trace, vision_crop, vision_pixel_diff, vision_long_screenshot_ocr, vision_extract_foreground, vision_dominant_colors, vision_html_screenshot, and upstream playbooks.',
    whenToUse: 'Use whenever a task depends on image text/content, pixel coordinates, screenshot-to-UI reconstruction, visual regression, reusable image/SVG assets, diagram reconstruction, GUI operation from screenshots, or tall screenshot OCR.',
    source: 'runtime',
    resourceBase: {
        kind: 'directory',
        path: VISION_TOOLS_SKILL_RESOURCE_BASE,
    },
    content: VISION_TOOLS_SKILL_CONTENT,
};
//# sourceMappingURL=skill.js.map