/** @param {string} name */
export function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/**
 * @param {string} path - e.g. "group.html"
 * @param {Record<string, string>} [params]
 */
export function navigate(path, params) {
  const u = new URL(path, window.location.href);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      u.searchParams.set(k, v);
    }
  }
  window.location.assign(u.pathname + u.search + u.hash);
}
