/**
 * DSH-native adapter for the upstream vision-tools Skill and playbooks.
 * @module dsh-vision-toolkit/skill
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
/** Stable catalog/invocation name shared with progressive tool exposure. */
export const VISION_SKILLS_NAME = 'vision-skills';
/** Packaged resource root for the adapted upstream playbooks. */
export const VISION_SKILLS_RESOURCE_BASE = fileURLToPath(new URL('../assets/skill/', import.meta.url));
/** Exact bundled instructions used as the progressive-exposure evidence marker. */
export const VISION_SKILLS_CONTENT = readFileSync(new URL('../assets/skill/SKILL.md', import.meta.url), 'utf8');
/** Runtime skill registration mounted only after every native tool is ready. */
export const VISION_SKILLS_SKILL = {
    name: VISION_SKILLS_NAME,
    description: '把截图或设计图还原为 UI（网页、应用界面或组件），生成 HTML/CSS 或项目现有前端代码；也支持图片问答、长截图/聊天记录 OCR、元素定位与盘点、裁剪、前景提取、像素对比、取色、SVG 描摹和 HTML 转截图。当任务涉及图片理解、UI 还原/重建（rebuild or restore a UI from a screenshot）、视觉回归、像素坐标、基于截图的 GUI 操作、可复用图片/SVG 素材、图表还原或长截图 OCR 时使用。',
    whenToUse: '任务依赖图片文字/内容、像素坐标、截图转 UI 重建、视觉回归、可复用图片/SVG 素材、图表还原、基于截图的 GUI 操作或长截图 OCR 时使用。',
    source: 'runtime',
    resourceBase: {
        kind: 'directory',
        path: VISION_SKILLS_RESOURCE_BASE,
    },
    content: VISION_SKILLS_CONTENT,
};
//# sourceMappingURL=skill.js.map