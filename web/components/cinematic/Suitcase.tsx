'use client';

import { useId } from 'react';

/**
 * The Earnora case — the one main animated element of the login scene.
 *
 * It is drawn as two stacked 180×122 SVGs that share the same box:
 *
 *   .case__art--base   the shell from the seam down (y 52 → 116) plus the
 *                      light living inside it (`.case__seam`, `.case__glow`,
 *                      both faded in per phase by cinematic.css)
 *   .case__art--lid    the handle and the shell above the seam (y 30 → 52),
 *                      tipped open by CSS about the seam line
 *
 * Because both layers are full-size overlays of one another, cinematic.css
 * hinges the lid with `transform-origin: 50% 42.62%` — that is 52/122, the
 * seam itself. Change the split line and that percentage has to move with it.
 *
 * The white identity band and the clasps are cut in half at the seam so the
 * two layers line up seamlessly while the case is shut.
 */
export default function Suitcase() {
  const uid = useId().replace(/:/g, '');
  const bBody = `csBBody-${uid}`;
  const bSheen = `csBSheen-${uid}`;
  const bSeam = `csBSeam-${uid}`;
  const bGlow = `csBGlow-${uid}`;
  const lBody = `csLBody-${uid}`;
  const lSheen = `csLSheen-${uid}`;

  const shellDown = 'M8 52 H172 V101 A15 15 0 0 1 157 116 H23 A15 15 0 0 1 8 101 Z';
  const shellUp = 'M8 45 A15 15 0 0 1 23 30 H157 A15 15 0 0 1 172 45 V52 H8 Z';

  return (
    <>
      {/* ── base: everything from the seam down ─────────────────── */}
      <svg className="case__art case__art--base" viewBox="0 0 180 122" aria-hidden="true">
        <defs>
          <linearGradient id={bBody} x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0%" stopColor="#4f8bfb" />
            <stop offset="55%" stopColor="#2f6fef" />
            <stop offset="100%" stopColor="#1b39b4" />
          </linearGradient>
          <linearGradient id={bSheen} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
            <stop offset="42%" stopColor="#ffffff" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.38" />
          </linearGradient>
          <radialGradient id={bSeam}>
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.98" />
            <stop offset="45%" stopColor="#a8e0ff" stopOpacity="0.82" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={bGlow}>
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="36%" stopColor="#d3f1ff" stopOpacity="0.94" />
            <stop offset="70%" stopColor="#5cc8ff" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
          </radialGradient>
        </defs>

        <path d={shellDown} fill={`url(#${bBody})`} />
        <path d={shellDown} fill={`url(#${bSheen})`} />
        <path d={shellDown} fill="none" stroke="#bcd9ff" strokeWidth="3" />

        {/* white identity band, lower half */}
        <rect x="74" y="52" width="32" height="64" fill="rgba(255,255,255,0.92)" />
        <rect
          x="74"
          y="52"
          width="32"
          height="64"
          fill="none"
          stroke="rgba(191,219,255,0.9)"
          strokeWidth="2"
        />

        {/* the seam the lid lifts away from */}
        <rect x="8" y="52" width="164" height="4" fill="rgba(255,255,255,0.55)" />

        {/* hardware */}
        <rect x="18" y="76" width="46" height="7" rx="3.5" fill="rgba(255,255,255,0.6)" />
        <rect x="116" y="76" width="46" height="7" rx="3.5" fill="rgba(255,255,255,0.42)" />
        <circle cx="90" cy="96" r="7" fill="#7ee0ff" opacity="0.95" />
        <circle cx="90" cy="96" r="3" fill="#ffffff" />

        {/* the light inside — leaked along the seam while it is shut,
            flooding out once the lid is up */}
        <ellipse className="case__glow" cx="90" cy="56" rx="88" ry="58" fill={`url(#${bGlow})`} />
        <ellipse className="case__seam" cx="90" cy="54" rx="98" ry="13" fill={`url(#${bSeam})`} />
      </svg>

      {/* ── lid: the handle and everything above the seam ───────── */}
      <svg className="case__art case__art--lid" viewBox="0 0 180 122" aria-hidden="true">
        <defs>
          <linearGradient id={lBody} x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0%" stopColor="#5b95ff" />
            <stop offset="55%" stopColor="#3573f1" />
            <stop offset="100%" stopColor="#2143bd" />
          </linearGradient>
          <linearGradient id={lSheen} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="42%" stopColor="#ffffff" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.42" />
          </linearGradient>
        </defs>

        {/* handle */}
        <path
          d="M64 32 C64 13 77 5 90 5 C103 5 116 13 116 32"
          fill="none"
          stroke="#dbe9ff"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <path
          d="M64 32 C64 13 77 5 90 5 C103 5 116 13 116 32"
          fill="none"
          stroke="#38bdf8"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.85"
        />

        <path d={shellUp} fill={`url(#${lBody})`} />
        <path d={shellUp} fill={`url(#${lSheen})`} />
        <path d={shellUp} fill="none" stroke="#bcd9ff" strokeWidth="3" />

        {/* white identity band, upper half */}
        <rect x="74" y="30" width="32" height="22" fill="rgba(255,255,255,0.92)" />
        <rect
          x="74"
          y="30"
          width="32"
          height="22"
          fill="none"
          stroke="rgba(191,219,255,0.9)"
          strokeWidth="2"
        />

        {/* clasps straddle the seam, so they travel with the lid */}
        <rect x="42" y="44" width="20" height="15" rx="5" fill="#eaf4ff" stroke="#9cc6ff" strokeWidth="2" />
        <rect x="118" y="44" width="20" height="15" rx="5" fill="#eaf4ff" stroke="#9cc6ff" strokeWidth="2" />
      </svg>
    </>
  );
}
