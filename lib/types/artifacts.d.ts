/**
 * Stable file-delivery descriptors owned by the plugin. DSH Core currently
 * has no reusable Artifact service, so every file-producing tool returns this
 * lossless contract and keeps the file inside the plugin-managed artifact
 * directory for Web, Headless, and later tool calls alike.
 * @module dsh-vision-toolkit/artifacts
 */
import { type PathPolicy } from './paths.ts';
/** Artifact payload family used by clients to select a safe renderer. */
export type ArtifactKind = 'image' | 'svg' | 'markdown' | 'json';
/** Intended default client action for one artifact. */
export type ArtifactPreviewIntent = 'image' | 'svg' | 'text' | 'download';
/** Stable descriptor returned by every file-producing Vision Toolkit tool. */
export interface ArtifactDescriptor {
    path: string;
    filename: string;
    mimeType: string;
    kind: ArtifactKind;
    description: string;
    sourceTool: string;
    previewIntent: ArtifactPreviewIntent;
    bytes: number;
}
/** Metadata needed to describe an already committed managed artifact. */
export interface ArtifactDescription {
    mimeType: string;
    kind: ArtifactKind;
    description: string;
    sourceTool: string;
    previewIntent: ArtifactPreviewIntent;
}
/**
 * Validate and describe one committed regular file under the active artifact
 * root. Symbolic links are rejected even when their targets remain in-bounds,
 * so a later preview/download can never be redirected after delivery.
 * @param path - final managed artifact path.
 * @param policy - active workspace path policy.
 * @param description - stable type and presentation facts.
 * @returns a complete descriptor with the committed byte size.
 */
export declare function describeArtifact(path: string, policy: PathPolicy, description: ArtifactDescription): Promise<ArtifactDescriptor>;
//# sourceMappingURL=artifacts.d.ts.map