// Shared with mobile/CarabaoMobile/src/lib/webPages.ts. Keep both copies the same (sharedCopies.test.ts).
// CF-0132: the web pages that the Profile screen opens. Only these keys exist, so a
// screen cannot open a path it builds itself. The paths are the web routes in
// frontend/carabao-app/app/(help)/help (page.tsx, terms/, privacy/).
export const WEB_PAGES = {
  help: '/help',
  terms: '/help/terms',
  privacy: '/help/privacy',
} as const;

export type WebPage = keyof typeof WEB_PAGES;

/** Full URL of a known web page on `base` (the checked WEB_BASE). Trailing slashes on base are dropped. */
export function webPageUrl(base: string, page: WebPage): string {
  if (!Object.prototype.hasOwnProperty.call(WEB_PAGES, page)) throw new Error(`Unknown web page: ${String(page)}`);
  return `${base.replace(/\/+$/, '')}${WEB_PAGES[page]}`;
}
