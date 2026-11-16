import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

/**
 * Crawl rules.
 *
 * The public, content-bearing pages are crawlable; the app screens behind a
 * login are not — they render no publisher content to an anonymous crawler
 * (they redirect to /login), so keeping them out of the crawl removes
 * content-less "pages" from the index entirely.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin', '/dashboard', '/tasks', '/wallet', '/referrals', '/login'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
