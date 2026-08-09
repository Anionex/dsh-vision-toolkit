/**
 * The DSH-adapted vision-tools skill. It keeps the upstream methodology but
 * names only the native tools this plugin registers, so the skill can never
 * advertise a CLI or capability that is absent. Mounted after the runtime is
 * ready and disposed with the plugin.
 * @module dsh-vision-toolkit/skill
 */
const CONTENT = `# vision-tools (DSH edition)

Five native tools give the text-only agent eyes. They share one vision
configuration managed by the DSH Vision Toolkit plugin — no shell commands,
no environment files, no CLI parsing.

Pick the tool by the question you are answering:

| Question | Tool |
|---|---|
| "What does this image show / say?" | vision_glance |
| "Where is X?" — one particular thing | vision_ground |
| "Where are all the Xs?" — every instance of a kind | vision_detect |
| "What is its exact shape, size, offset?" | vision_trace |
| "Cut this box out as its own image file" | vision_crop |
| "Which version/runtime is this?" | vision_toolkit_version |

vision_glance answers *what* something is; vision_ground and vision_detect
answer *where*. Give vision_ground a description of one particular thing;
give vision_detect a kind and it enumerates the instances.

Both tools return real coordinates in the original image, but they are not
pixel-exact: the box arrives on a 0-1000 grid and is scaled to the image, so
the last pixel or few are not reliable. That is accurate enough to crop with
and to compare positions. When a number must be exact, vision_trace derives
it from the actual pixels.

## Use the provided tools before hand-rolled pixels

- cut a box out of an image → vision_crop, not Pillow code
- locate / inventory elements → vision_ground / vision_detect
- describe / OCR an image → vision_glance
- vectorize to SVG → vision_trace

Hand-written pixel code is only for what none of them return: a relation
between two things you already located (a gap, a distance), or drawing.

## vision_glance — ask about an image

Pass several image paths to ONE vision_glance call when you need to compare
them; separate calls cannot see both images, so two descriptions compared
afterwards are two hallucination surfaces, not a comparison.

Use region (X1,Y1,X2,Y2) to upload only a crop, so small text and icons
become readable. But "what changed between these two?" is not a glance
question; a one-word badge or small shift is a rounding error to a vision
model. Prefer local pixel comparison, then glance the changed region.

For a tall scrolling screenshot, do not send the whole image through one OCR
call and accept the model's downscaling loss. Crop the low-content bands
away with vision_crop, OCR each chunk with vision_glance, and merge only
non-duplicated text.

## vision_ground — locate a named target

\`\`\`
vision_ground image="screenshot.png" target="the send button"
vision_ground image="screenshot.png" target="the send button" region="0,0,640,360"
\`\`\`

Returns x1/y1/x2/y2 in original-image pixels — with region too (crop hits are
mapped back). If several boxes come back, the description matched more than
one element; narrow it with what distinguishes the one you mean — its text,
its position, the block it sits in — and ask again.

The box is a handle, not just an answer. Feed it to the next call:

\`\`\`
vision_ground image="screenshot.png" target="the send button"
# → matches: [{ label: "send button", box: { x1: 1067, y1: 841, x2: 1108, y2: 881 } }]
vision_glance images=["screenshot.png"] region="1067,841,1108,881" query="is it enabled or greyed out?"
\`\`\`

## vision_detect — find every instance of a kind

\`\`\`
vision_detect image="screenshot.png"                          # every UI element
vision_detect image="screenshot.png" category="buttons"       # one kind only
vision_detect image="screenshot.png" region="0,0,640,360"     # inside one box
\`\`\`

Output is a numbered list with each item's visible text and box. A full-screen
pass is a fast first draft — counts vary run to run on dense screens. For
completeness, detect the layout blocks first, then detect each block.

## vision_crop — cut a pixel box to a file

\`\`\`
vision_crop image="screenshot.png" region="1067,841,1108,881"
vision_crop image="icon.png" region="0,0,64,64" scale=4
\`\`\`

The same boxes vision_ground/vision_detect print, clamped to the image
bounds. Once a box is worth keeping — the same crop is about to feed
vision_trace or another tool — cut it to a file once and reuse it. Use
scale=2-4 for icons too small to see clearly; coordinates returned by later
tools on the upscaled file are in the upscaled grid — divide by the scale to
map back.

## vision_trace — recover SVG geometry

\`\`\`
vision_trace image="icon.png"
vision_trace image="icon.png" region="0,0,64,64" color=true
vision_trace image="icon.png" mode="perceive"   # concept label (needs vision model)
vision_trace image="icon.png" mode="synthesize" # model-assisted repair (needs vision model + renderer)
\`\`\`

Coordinates come from actual pixels, not a model's estimate. The default
pipeline recovers circles, lines, polygons, and shared edges into an editable
SVG. Complex inferred geometry reports status "approximation" until a
render-aware review confirms it; requireProduction=true refuses to write
unverified fallback geometry. Text is geometry to this tool — pair with
vision_glance ocr when the text matters. Use on flat, high-contrast graphics
only.

## Boundaries

- Image paths are resolved against the session workspace and must stay inside
  it (or a configured allowedDirs entry). Do not fabricate absolute paths.
- Coordinates returned by vision_ground/vision_detect are pixel boxes in the
  original image and feed vision_crop unchanged.
- The vision model never receives image bytes through the main model channel;
  tool results are text, numbers, coordinates, and file paths.
`;
/** Runtime skill registration for the DSH-adapted vision-tools skill. */
export const VISION_TOOLS_SKILL = {
    name: 'vision-tools',
    description: 'Native DSH vision tools: vision_glance (describe/ask/OCR/compare), vision_ground (locate a target, pixel box), vision_detect (element inventory), vision_trace (image to SVG geometry), vision_crop (cut a pixel box to a file). Use for any image task — questions, text, locating elements, comparing, rebuilding as HTML/SVG, digitizing a sketch or diagram, reading chart values, operating a GUI from screenshots.',
    whenToUse: 'When a task involves an image: reading text, locating an element, inventorying UI elements, vectorizing a graphic, cutting a region, or checking a detail a previous description lacked.',
    source: 'runtime',
    content: CONTENT,
};
//# sourceMappingURL=skill.js.map