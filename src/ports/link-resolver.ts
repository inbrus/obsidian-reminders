// Port: wikilink resolution. The core context tree / context resolver need to
// turn a wikilink target into a vault path; this is backed by Obsidian's
// metadataCache in production (infra/obsidian-vault-adapter.ts), but stays an
// interface so the pure logic can be tested without the cache.

export interface ILinkResolver {
  /** Resolve a wikilink target to a vault path, or undefined if not found. */
  resolve(link: string, fromPath: string): string | undefined;
}
