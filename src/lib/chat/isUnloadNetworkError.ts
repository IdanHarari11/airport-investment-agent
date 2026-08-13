/**
 * Browsers often reject in-flight `fetch` with a TypeError ("Failed to fetch" /
 * "network error" / "Load failed") on refresh or navigation **before**
 * `AbortController.signal.aborted` flips to true. Treating those as real
 * assistant failures clears `pending` and blocks hydrate retry.
 */

export type UnloadNetworkErrorOptions = {
  /** Set from pagehide / beforeunload while the document is tearing down. */
  unloading: boolean;
  /** True when the request AbortSignal has already aborted. */
  aborted: boolean;
};

/** Browser-shaped fetch failures commonly seen on tab close / hard refresh. */
export function isLikelyNetworkFetchFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("network error") ||
    message.includes("networkerror") ||
    message.includes("load failed") ||
    message.includes("fetch failed")
  );
}

function isDocumentHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

/**
 * Returns true when a sendMessage catch should leave the user turn pending
 * (no error assistant write) so hydrate can retry after reload.
 *
 * Real offline failures while the tab stays visible must still surface.
 */
export function isUnloadNetworkError(
  err: unknown,
  options: UnloadNetworkErrorOptions,
): boolean {
  if (options.aborted) return true;
  if (options.unloading) return true;
  // Race: fetch can reject before pagehide/beforeunload sets unloading.
  // Hidden + classic network TypeError is the unload/refresh signature.
  if (isLikelyNetworkFetchFailure(err) && isDocumentHidden()) return true;
  return false;
}
