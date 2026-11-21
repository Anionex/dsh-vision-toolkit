/** Recognize the reserved workspace layout for path-level revalidation. */
export declare function isWindowsFallbackStorageRoot(root: string): boolean;
/** Resolve the private per-workspace root, or only look it up for historical inputs. */
export declare function findWindowsFallbackStorage(workspaceId: string, create: boolean): Promise<string | undefined>;
/** Revalidate already written fallback files before allowing tool or browser access. */
export declare function assertWindowsFallbackFile(root: string, file: string): Promise<void>;
/** Revalidate a reused directory below the Windows fallback root before use. */
export declare function assertWindowsFallbackDirectory(root: string, directory: string): Promise<void>;
//# sourceMappingURL=windows-fallback-storage.d.ts.map