// Re-export the pure Dataview codec from core. Kept as a thin shim for existing
// `import ... from "./dataview"` call sites; canonical home is
// src/core/metadata-codec.ts.
export * from "./core/metadata-codec";
