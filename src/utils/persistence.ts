
// URL params take precedence over localStorage; per-burn readings are URL-only.

export function _urlParams(key: string) {
  try {
    return new URLSearchParams(window.location.search).get(key);
  } catch {
    return null;
  }
}
export function _localStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function _save_localStorage(key: string, value: string | null | undefined) {
  try {
    if (value !== null && value !== undefined) localStorage.setItem(key, String(value));
    else localStorage.removeItem(key);
  } catch {}
}
/** Read from URL, then localStorage, then fall back to default. */
export function _urlParams_localStorage(urlKey: string, lsKey: string, fallback: string) {
  const v = _urlParams(urlKey);
  return v !== null ? v : (_localStorage(lsKey) ?? fallback);
}