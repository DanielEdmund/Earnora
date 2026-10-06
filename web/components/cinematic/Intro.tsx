'use client';

import { useEffect, useRef } from 'react';

/**
 * EARNORA light-stroke intro.
 *
 * A light streak crosses the screen, then a stroke draws an elegant "E"
 * (outer curve first, so it reads as a C — then the middle bar lands and
 * it becomes an E). The stroke then hands off to the rest of the wordmark,
 * whose letters rise into place, before the whole overlay dissolves into
 * the 3D scene.
 */

const OUTER =
  'M 214 46 L 104 46 C 80 46 70 62 70 88 L 70 172 C 70 198 80 214 104 214 L 214 214';
const MIDDLE = 'M 70 130 L 178 130';

const LETTERS = ['A', 'R', 'N', 'O', 'R', 'A'];

/** Total time the intro holds before handing over to the scene. */
export const INTRO_MS = 3200;

const MOTES = Array.from({ length: 18 }, (_, i) => ({
  mx: `${(i * 53 + 7) % 96}%`,
  my: `${(i * 37 + 13) % 88}%`,
  ms: `${5 + ((i * 7) % 9)}px`,
  md: `${3.4 + ((i * 13) % 30) / 10}s`,
  mdl: `${((i * 17) % 40) / 10}s`,
}));

export default function Intro({
  onFinish,
  onSkip,
  lifted,
}: {
  onFinish: () => void;
  onSkip: () => void;
  lifted?: boolean;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timer.current = setTimeout(onFinish, INTRO_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [onFinish]);

  return (
    <div className={`intro${lifted ? ' is-out' : ''}`} role="presentation">
      <div className="intro__motes" aria-hidden="true">
        {MOTES.map((m, i) => (
          <i key={i} style={{ '--mx': m.mx, '--my': m.my, '--ms': m.ms, '--md': m.md, '--mdl': m.mdl } as React.CSSProperties} />
        ))}
      </div>

      <div className="intro__inner">
        <span className="intro__streak" aria-hidden="true" />

        <div className="intro__word" aria-label="Earnora">
          {/* the drawn E */}
          <svg className="intro__e" viewBox="0 0 250 260" aria-hidden="true">
            <defs>
              {/* userSpaceOnUse: the middle bar is a perfectly horizontal line,
                  so an objectBoundingBox gradient (zero-height box) would make
                  the SVG spec disable that path entirely — the E stayed a C */}
              <linearGradient id="introStroke" gradientUnits="userSpaceOnUse" x1="70" y1="46" x2="214" y2="214">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="45%" stopColor="#2f6fef" />
                <stop offset="100%" stopColor="#1d3fd6" />
              </linearGradient>
            </defs>

            <path
              className="stroke"
              d={OUTER}
              style={{ '--len': 780, '--dur': '1.1s', '--delay': '0.26s' } as React.CSSProperties}
            />
            <path
              className="stroke"
              d={MIDDLE}
              style={{ '--len': 320, '--dur': '0.46s', '--delay': '1.26s' } as React.CSSProperties}
            />

            <circle
              className="spark"
              r="7"
              style={{ '--dur': '1.1s', '--delay': '0.26s' } as React.CSSProperties}
            >
              <animateMotion dur="1.1s" begin="0.26s" fill="freeze" path={OUTER} />
            </circle>
            <circle
              className="spark"
              r="6"
              style={{ '--dur': '0.46s', '--delay': '1.26s' } as React.CSSProperties}
            >
              <animateMotion dur="0.46s" begin="1.26s" fill="freeze" path={MIDDLE} />
            </circle>
          </svg>

          {/* the rest of the wordmark */}
          <span className="intro__rest" aria-hidden="true">
            {LETTERS.map((l, i) => (
              <i key={i} style={{ animationDelay: `${1.47 + i * 0.062}s` }}>
                {l}
              </i>
            ))}
          </span>
        </div>

        <p className="intro__tag" style={{ animationDelay: '2.22s' }}>
          Enter Earnora
        </p>
      </div>

      <button type="button" className="intro__skip" onClick={onSkip}>
        Skip intro
      </button>
    </div>
  );
}
