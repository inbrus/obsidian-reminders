// Re-export the pure core data model. Kept as a thin shim so existing
// `import ... from "./types"` call sites keep working; the canonical home is
// src/core/models.ts.
export * from "./core/models";
