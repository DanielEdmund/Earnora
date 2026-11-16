import Link from 'next/link';
import AdSenseSnippet from '@/components/AdSenseSnippet';

/**
 * Shared chrome for the public, content-bearing pages (/plans, /help,
 * /payouts, /referral-program — plus anything added later).
 *
 * It renders <AdSenseSnippet /> itself, so a content route can never ship
 * without the AdSense loader, and it carries the footer navigation that
 * links every public page together for crawlers.
 *
 * Remember to add the route to AD_PATHS in components/AdSenseGuard.tsx and
 * to app/sitemap.ts.
 */
const FOOT_NAV = [
  { href: '/', label: 'Home' },
  { href: '/plans', label: 'Plans & pricing' },
  { href: '/payouts', label: 'Payouts' },
  { href: '/referral-program', label: 'Referral programme' },
  { href: '/help', label: 'Help centre' },
  { href: '/terms', label: 'Terms & policy' },
];

export default function ContentShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdSenseSnippet />
      <div className="landing">
        <header>
          <Link href="/" className="brand">
            <span className="brand-mark">E</span>
            Earnora
          </Link>
          <div className="actions">
            <Link href="/" className="btn secondary sm">
              Home
            </Link>
            <Link href="/login?mode=register" className="btn sm">
              Sign up
            </Link>
          </div>
        </header>

        {children}

        <footer>
          <nav className="foot-nav" aria-label="Site">
            {FOOT_NAV.map((l) => (
              <Link href={l.href} key={l.href}>
                {l.label}
              </Link>
            ))}
          </nav>
          <div>© 2026 Earnora. All rights reserved.</div>
        </footer>
      </div>
    </>
  );
}
