import type { Metadata } from 'next';
import './globals.css';
import './cinematic.css';
import TransitionFlash from '@/components/TransitionFlash';
import AdSenseGuard from '@/components/AdSenseGuard';
import { siteUrl } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Earnora — Earn from tasks, referrals and campaigns',
  description:
    'Earn every day from micro-tasks, flat referral bonuses and paid campaigns. Free sign up — a small one-time activation fee unlocks tasks and withdrawals.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /* suppressHydrationWarning: extensions inject attributes onto <html>/<body>
       before React hydrates (e.g. `data-bybit-channel-name`), which would
       otherwise abort hydration and blank the tree. Only affects these two tags. */
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Work+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css"
        />
        {/* Google AdSense is intentionally NOT loaded here: the snippet is
            server-rendered by <AdSenseSnippet /> on content pages only, and
            <AdSenseGuard /> keeps Auto Ads off every other screen. Loading it
            globally put ads on the login/app screens and triggered
            "Google-served ads on screens without publisher-content". */}
      </head>
      <body suppressHydrationWarning>
        {children}
        <AdSenseGuard />
        <TransitionFlash />
      </body>
    </html>
  );
}
