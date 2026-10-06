/**
 * Where the site before React lives: `/` while the React pages are at /next/ (PORTAL-MIGRATION.md
 * step 4 moves it to /old). A page not moved yet links there, at the same #address.
 */
export const OLD_SITE = '/';
export const oldHref = (tab: string): string => `${OLD_SITE}#${tab}`;
