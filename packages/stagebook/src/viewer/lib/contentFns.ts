/**
 * Create getTextContent and getAssetURL functions backed by HTTP fetch
 * from a base URL (e.g., raw.githubusercontent.com).
 *
 * Results are cached so repeated calls for the same path don't re-fetch.
 */
export function createUrlContentFns(rawBaseUrl: string) {
  const cache = new Map<string, Promise<string>>();

  return {
    getTextContent(path: string): Promise<string> {
      // `asset://` text is materialized by the platform, not the viewer.
      // Reject fast (rather than fetching `<base>asset://…`) so the renderer
      // falls back to the labeled placeholder for an asset:// prompt (#191).
      if (/^asset:\/\//i.test(path)) {
        return Promise.reject(
          new Error(`asset:// content is resolved by the platform: ${path}`),
        );
      }
      const cached = cache.get(path);
      if (cached) return cached;
      const promise = fetch(rawBaseUrl + path)
        .then((res) => {
          if (!res.ok) {
            throw new Error(`Failed to fetch ${path} (HTTP ${res.status})`);
          }
          return res.text();
        })
        .catch((err) => {
          cache.delete(path);
          throw err;
        });
      cache.set(path, promise);
      return promise;
    },

    getAssetURL(path: string): string {
      // `asset://` refs are materialized by the deployment platform, not the
      // viewer — return them unchanged rather than concatenating onto the base
      // (which yields a nonsensical `<base>asset://…`). The renderer detects an
      // unresolved `asset://` src and shows a labeled placeholder (#191).
      if (/^asset:\/\//i.test(path)) return path;
      return rawBaseUrl + path;
    },
  };
}

/**
 * Create getTextContent and getAssetURL functions backed by an in-memory
 * map of path → text content. Intended for tests, fixtures, and hosts that
 * already hold every file in memory (no I/O).
 *
 * `getTextContent` rejects for a path absent from the map — mirroring the
 * 404 an HTTP-backed loader would surface — while an empty string is a
 * valid, present file. `getAssetURL` returns the path unchanged, matching
 * the passthrough convention of the other content-fn providers.
 */
export function createStaticContentFns(files: Record<string, string>) {
  return {
    getTextContent(path: string): Promise<string> {
      if (!Object.prototype.hasOwnProperty.call(files, path)) {
        return Promise.reject(new Error(`No content for ${path}`));
      }
      return Promise.resolve(files[path]);
    },

    getAssetURL(path: string): string {
      return path;
    },
  };
}
