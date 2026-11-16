/**
 * AdSense code snippet for ONE page — render it only from server components
 * that carry real publisher content (today: `/` and `/terms`).
 *
 * React 19 hoists an `async` <script src> into <head> during SSR and
 * deduplicates it if it is rendered more than once, so this ends up in the
 * server-rendered HTML of exactly those routes — never on /login, /dashboard,
 * /tasks, /wallet, /referrals, /admin or the 404 screen.
 *
 * That is AdSense' own instruction ("paste the code into the head of every
 * page you want ads shown on") and it is what keeps Auto Ads off screens
 * without publisher content — the policy this site was flagged for.
 *
 * If you add another content-bearing route, render <AdSenseSnippet /> there
 * too, and add its path to AD_PATHS in components/AdSenseGuard.tsx.
 */
const ADSENSE_CLIENT = 'ca-pub-4649059465113958';

export default function AdSenseSnippet() {
  return (
    <script
      async
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
      crossOrigin="anonymous"
      data-adsense-loader=""
    />
  );
}
