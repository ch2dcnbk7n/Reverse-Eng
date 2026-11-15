// In-memory stand-in for a Netlify Blobs store, with the same conditional-write
// behavior. Used by tests and the local dev server.
export function createMemoryStore() {
  const items = new Map();
  let n = 0;
  return {
    async getWithMetadata(key) {
      const item = items.get(key);
      return item ? { data: JSON.parse(item.body), etag: item.etag, metadata: {} } : null;
    },
    async setJSON(key, value, opts = {}) {
      const item = items.get(key);
      if (opts.onlyIfNew && item) return { modified: false };
      if (opts.onlyIfMatch && (!item || item.etag !== opts.onlyIfMatch)) return { modified: false };
      const etag = `"${++n}"`;
      items.set(key, { body: JSON.stringify(value), etag });
      return { modified: true, etag };
    },
  };
}
