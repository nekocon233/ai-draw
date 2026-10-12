const PARAM = 'session';
const SESSION_ID = /^[A-Za-z0-9_-]{1,50}$/;

/** The session named by `?session=` in a link, if it looks like a session id. */
export function readSessionLink(href: string): string | null {
  try {
    const value = new URL(href).searchParams.get(PARAM);
    return value && SESSION_ID.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** Read the linked session once and drop the parameter, so a reload restores the normal session. */
export function consumeSessionLink(): string | null {
  if (typeof window === 'undefined' || !window.location?.href) return null;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(PARAM)) return null;
    const linked = readSessionLink(url.href);
    url.searchParams.delete(PARAM);
    window.history?.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    return linked;
  } catch {
    return null;
  }
}
