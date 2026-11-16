/**
 * Canonical origin of the deployed site — used by <link rel="canonical"> style
 * metadata consumers (robots.txt, sitemap.xml, metadataBase).
 *
 * Order of preference:
 *   1. NEXT_PUBLIC_SITE_URL   — set this to your real domain (e.g.
 *      https://earnora.com) in Vercel for exact absolute URLs;
 *   2. Vercel's deployment URL — automatic on Vercel;
 *   3. localhost              — local `npm run dev` (web runs on :3001).
 */
export const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3001')
).replace(/\/+$/, '');
