# OCR a long screenshot without losing boundary text

**Use for**: a vertically scrolling screenshot, chat history, long web page,
requirements conversation, log view, or other image that would be downscaled too
aggressively in one vision call. For a PDF or an exported document, prefer a
format-aware document parser instead of screenshot OCR.

## Run the workflow

Work from a durable copy, then choose the content mode:

```json
{"image":"work/page.png","output":"page.ocr.md","runName":"page"}
{"image":"work/chat.png","mode":"chat","output":"chat.ocr.md","runName":"chat"}
```

The tool returns the merged Markdown as the primary Artifact and stores chunks,
sidecars, the manifest, and the audit in a managed Artifact directory. Reuse a
stable `runName` when the run may be resumed.

The tool performs four operations:

1. Measure per-row content density and find low-content cut bands near the
   target height.
2. Add pixel overlap only when no safe band exists, so text crossing a risky
   cut appears in both adjacent chunks.
3. Run the configured vision service on the chunks; chat mode requests
   structured messages while general mode uses verbatim OCR.
4. Merge only confident repeated lines or messages and write `manifest.json` plus
   `ocr_audit.md` beside the chunks.

Use `resume=true` after an interrupted run. A chunk is reused only when its
image, mode, and custom prompt fingerprint still match:

```json
{"image":"work/chat.png","mode":"chat","resume":true,"output":"chat.ocr.md","runName":"chat"}
```

Use `splitOnly=true` when you need to inspect or tune the chunks before spending
vision calls:

```json
{"image":"work/page.png","splitOnly":true,"runName":"page"}
```

If the defaults produce awkward chunks, rerun with `targetHeight`, `minHeight`,
`maxHeight`, or `overlap`. Keep enough height for local
context; do not make tiny OCR tiles unless the source text is unusually small.

## Verify before delivering

1. Read the merged Markdown from top to bottom and compare its opening and
   ending lines with the source.
2. Open `ocr_audit.md`. Review every boundary marked `yes` against the two
   adjacent `chunk_*.png` files. A marked boundary used pixel overlap or fuzzy
   text matching and is not safe to accept blindly.
3. Check sender changes, timestamps, quoted messages, table row breaks, code
   indentation, and paragraphs that cross chunk boundaries.
4. For any doubtful text, run targeted OCR on the relevant chunk or crop:

   ```json
   {"images":["<chunk-artifact-path>"],"ocr":true,"query":"Re-check the final five lines carefully."}
   {"images":["<chunk-artifact-path>"],"region":"X1,Y1,X2,Y2","ocr":true}
   ```

5. Keep visible spelling and punctuation verbatim. Write `[unreadable]` for
   text that remains illegible; do not silently guess or editorially repair it.

## Output contract

- Return the merged Markdown Artifact as the primary result.
- Keep the chunk directory until verification is complete; it is the evidence
  for ordering and boundary decisions.
- Report unresolved `[unreadable]` text and every boundary that still needs
  human review.
- Do not claim a complete transcription when the first or last screenshot edge
  visibly clips content.
