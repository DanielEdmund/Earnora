import AdSenseSnippet from '@/components/AdSenseSnippet';
import LandingPage from '@/components/LandingPage';

/**
 * `/` is the marketing page: hero, how-it-works, features, stats, FAQ.
 *
 * It used to open straight into the cinematic auth screen, which meant the
 * very first screen Google (and every AdSense reviewer) landed on was an
 * animated login form — a screen without publisher content. That is exactly
 * what "Google-served ads on screens without publisher-content" flags.
 *
 * The cinematic intro still plays at `/login` (deep links with ?ref= / ?mode=
 * are forwarded there by LandingPage), so the auth experience is unchanged.
 * The AdSense snippet renders here (and on /terms) — nowhere else.
 */
export default function RootPage() {
  return (
    <>
      <AdSenseSnippet />
      <LandingPage />
    </>
  );
}
