// Re-export the pure date helpers from core. Kept as a thin shim for existing
// `import ... from "./dateFormat"` call sites; canonical home is src/core/date.ts.
export * from "./core/date";
