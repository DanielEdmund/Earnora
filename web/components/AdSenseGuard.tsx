'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Screens that carry publisher content — must stay in sync with the routes
 * that render <AdSenseSnippet /> (server side). Everything else — auth, app,
 * admin, 404 — must never show a Google-served ad.
 */
const AD_PATHS = ['/', '/terms', '/plans', '/payouts', '/referral-program', '/help'];

const AD_SCRIPT_SRC =
  'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4649059465113958';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

function adsAllowed(pathname: string | null): boolean {
  const path = pathname ?? '/';
  const clean = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return AD_PATHS.includes(clean);
}

/**
 * Keeps Auto Ads in step with client-side navigation, where the server-rendered
 * <head> of the *landing* page cannot change:
 *
 *  - landing on an ad-enabled screen without the loader (e.g. `/login` → `/`)
 *    injects it;
 *  - navigating between ad-enabled screens nudges Auto Ads to re-scan the new
 *    route (they do not always follow pushState);
 *  - navigating to ANY other screen strips ad nodes left over from the previous
 *    route, so a SPA transition can never park an ad on a login form, a
 *    dashboard, a 404 or any other screen without publisher content.
 */
export default function AdSenseGuard() {
  const pathname = usePathname();
  const allowed = adsAllowed(pathname);
  const mounted = useRef(false);

  useEffect(() => {
    const firstMount = !mounted.current;
    mounted.current = true;

    if (allowed) {
      const loader = document.querySelector('script[data-adsense-loader]');
      if (!loader) {
        // Arrived here by client navigation — the HTML we landed on never
        // carried the snippet, so load it now (it places ads by itself).
        const script = document.createElement('script');
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.src = AD_SCRIPT_SRC;
        script.setAttribute('data-adsense-loader', '');
        document.head.appendChild(script);
        return;
      }
      if (firstMount) return; // server-rendered loader already owns this page

      const nudge = window.setTimeout(() => {
        try {
          window.adsbygoogle = window.adsbygoogle || [];
          window.adsbygoogle.push({});
        } catch {
          /* loader not ready / blocked — Auto Ads will handle the first pass */
        }
      }, 250);
      return () => window.clearTimeout(nudge);
    }

    const sweep = () => {
      document
        .querySelectorAll('ins.adsbygoogle, iframe[id^="google_ads_iframe_"]')
        .forEach((node) => node.remove());
    };
    sweep();

    // The loader tag cannot be unloaded after a client-side navigation, so
    // Auto Ads could in principle re-place an ad here later. Watch the DOM and
    // strip any ad node that appears on this screen — a login form, dashboard,
    // admin panel or 404 must never carry a Google-served ad.
    const observer = new MutationObserver(sweep);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Auto Ads can also re-place a beat after the navigation — sweep once more.
    const late = window.setTimeout(sweep, 700);
    return () => {
      observer.disconnect();
      window.clearTimeout(late);
    };
  }, [allowed, pathname]);

  return null;
}
