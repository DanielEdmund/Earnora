'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Full-screen blue/white flood that carries the cinematic login exit across
 * the route change: the login screen turns it on just before
 * `router.replace('/dashboard')`, and this clears it once the dashboard has
 * mounted so the light fades away over the real UI.
 *
 * Lives in the root layout so it survives client-side navigation. Invisible
 * (opacity 0) on every ordinary page load.
 */
export default function TransitionFlash() {
  const pathname = usePathname();

  useEffect(() => {
    const el = document.getElementById('auth-transition');
    if (!el) return;
    const t = setTimeout(() => el.classList.remove('is-on'), 150);
    return () => clearTimeout(t);
  }, [pathname]);

  return <div id="auth-transition" aria-hidden="true" />;
}
