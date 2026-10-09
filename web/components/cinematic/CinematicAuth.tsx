'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setSession } from '@/lib/api';
import Intro from './Intro';
import Suitcase from './Suitcase';
import AuthPanel, { type AuthKind, type AuthView } from './AuthPanel';

type Phase =
  | 'intro'
  | 'enter'
  | 'place'
  | 'cross'
  | 'open'
  | 'auth'
  | 'snap'
  | 'launch'
  | 'flood';

/** Beats after the intro ends. */
const T_ENTER = 1500; // the case glides in from off-screen and settles on the mark
const T_PLACE = 1100; // it drops the last stretch, lands and rings the floor
const T_CROSS = 900; // clasps pop, light leaks along the seam — anticipation
const T_OPEN = 1000; // the lid tips open, the light pours out, the form rises
/** Beats after a successful login/register — snap-and-launch, ~2.6s total. */
const T_SNAP = 800; // the form drops back in, the lid shuts, the case winds up
const T_LAUNCH = 900; // it lifts, tilts and rockets off with a light contrail
const T_FLOOD = 900; // the contrail flattens into a wash, the flash takes over

const MOTES = Array.from({ length: 16 }, (_, i) => ({
  px: `${(i * 61 + 5) % 97}%`,
  py: `${(i * 43 + 21) % 74 + 18}%`,
  ps: `${6 + ((i * 11) % 12)}px`,
  pd: `${5 + ((i * 19) % 60) / 10}s`,
  pdl: `${((i * 23) % 50) / 10}s`,
  px2: `${((i % 2 === 0 ? 1 : -1) * (14 + ((i * 7) % 30)))}px`,
}));

const ORBS = [
  { w: 150, top: '12%', left: '8%', dx: '34px', dy: '-46px', dur: '15s', op: 0.65 },
  { w: 96, top: '22%', left: '72%', dx: '-30px', dy: '38px', dur: '18s', op: 0.6 },
  { w: 64, top: '62%', left: '86%', dx: '26px', dy: '-30px', dur: '13s', op: 0.5 },
  { w: 44, top: '74%', left: '16%', dx: '-22px', dy: '-34px', dur: '16s', op: 0.55 },
];

interface Props {
  initialMode?: 'register' | 'login';
  initialReferralCode?: string;
}

export default function CinematicAuth({ initialMode = 'register', initialReferralCode = '' }: Props) {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('intro');
  const [introLifted, setIntroLifted] = useState(false);
  const [introGone, setIntroGone] = useState(false);

  const [view, setView] = useState<AuthView>(initialMode === 'login' ? 'login' : 'register');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [otpEmail, setOtpEmail] = useState('');
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const after = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  // ── opening timeline ────────────────────────────────────────────
  useEffect(() => clearTimers, []);

  /** Fired by the intro when its animation finishes naturally. */
  const finishIntro = useCallback(() => {
    setIntroLifted(true);
    setPhase('enter');
    after(700, () => setIntroGone(true));
    after(T_ENTER, () => setPhase('place'));
    after(T_ENTER + T_PLACE, () => setPhase('cross'));
    after(T_ENTER + T_PLACE + T_CROSS, () => setPhase('open'));
    after(T_ENTER + T_PLACE + T_CROSS + T_OPEN, () => setPhase('auth'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setIntroGone(true);
      setPhase('auth');
    }
  }, []);

  const skipIntro = useCallback(() => {
    clearTimers();
    setIntroLifted(true);
    setIntroGone(true);
    setPhase('auth');
  }, []);

  // ── exit timeline (same for register AND login) ─────────────────
  const startExit = useCallback(
    (message: string) => {
      clearTimers();
      setBusy(false);
      setError('');
      setNotice('');
      setStatus(message);
      // reduced motion: no choreography — flash straight through the handoff
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        document.getElementById('auth-transition')?.classList.add('is-on');
        after(950, () => router.replace('/dashboard'));
        return;
      }
      setPhase('snap');
      after(T_SNAP, () => setPhase('launch'));
      after(T_SNAP + T_LAUNCH, () => {
        setPhase('flood');
        document.getElementById('auth-transition')?.classList.add('is-on');
      });
      after(T_SNAP + T_LAUNCH + T_FLOOD, () => router.replace('/dashboard'));
    },
    [router],
  );

  // ── navigation between form views ───────────────────────────────
  function goView(next: AuthView) {
    setError('');
    if (next !== 'otp') setNotice('');
    if (next !== 'reset') setResetToken(null);
    setView(next);
  }

  // ── submissions ─────────────────────────────────────────────────
  async function submit(kind: AuthKind, payload: Record<string, string>) {
    setBusy(true);
    setError('');
    try {
      if (kind === 'register') {
        const r = await api<{ tokens: { accessToken: string; refreshToken: string } }>('/auth/register', {
          method: 'POST',
          body: {
            email: payload.email,
            password: payload.password,
            phone: payload.phone || undefined,
            referralCode: payload.referralCode || undefined,
            termsConsent: payload.termsConsent === 'true', // must be true — enforced client & server side
          },
          auth: false,
        });
        setSession(r.tokens.accessToken, r.tokens.refreshToken);
        startExit('Account created — entering Earnora…');
        return;
      }

      if (kind === 'login') {
        const r = await api<{ tokens: { accessToken: string; refreshToken: string } }>('/auth/login', {
          method: 'POST',
          body: { email: payload.email, password: payload.password },
          auth: false,
        });
        setSession(r.tokens.accessToken, r.tokens.refreshToken);
        startExit('Welcome back — entering Earnora…');
        return;
      }

      if (kind === 'forgot') {
        await api<{ sent: true }>('/auth/forgot', {
          method: 'POST',
          body: { email: payload.email },
          auth: false,
        });
        setOtpEmail(payload.email);
        // The OTP header already names the address and the 10-minute expiry, so
        // a status note here would only duplicate it (and lengthen the panel).
        setNotice('');
        setView('otp');
        return;
      }

      if (kind === 'otp') {
        const r = await api<{ resetToken: string }>('/auth/verify-otp', {
          method: 'POST',
          body: { email: payload.email, code: payload.code },
          auth: false,
        });
        setResetToken(r.resetToken);
        setNotice('');
        setView('reset');
        return;
      }

      if (kind === 'reset') {
        if (!resetToken) throw new Error('Reset session expired — request a new code');
        await api('/auth/reset', {
          method: 'POST',
          body: { resetToken, password: payload.password },
          auth: false,
        });
        setResetToken(null);
        setNotice('Password updated. Log in with your new password.');
        setView('login');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cine" data-phase={phase}>
      <div className="cine__bg" aria-hidden="true">
        <div className="cine__rays" />
        {ORBS.map((o, i) => (
          <span
            key={i}
            className="cine__orb"
            style={
              {
                width: o.w,
                height: o.w,
                top: o.top,
                left: o.left,
                '--dx': o.dx,
                '--dy': o.dy,
                '--dur': o.dur,
                opacity: o.op,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <div className="cine__cam">
        <div className="cine__stage">
          <div className="cine__floor" aria-hidden="true" />
          <div className="cine__horizon" aria-hidden="true" />

          {/* the one main animated element — the case */}
          <div className="case--floor">
            <div className="case__box">
              <Suitcase />
            </div>
          </div>
          <div className="cine__streak" aria-hidden="true" />
          <div className="case-impact" aria-hidden="true" />
          <div className="cine__burst" aria-hidden="true" />
          <div className="cine__beam" aria-hidden="true" />

          {/* the form, rising out of the suitcase */}
          <section className="cine__panel" aria-label="Earnora authentication">
            <div className="cine__panel-glass">
              <div className="cine__panel-inner">
                <AuthPanel
                  view={view}
                  busy={busy}
                  error={error}
                  notice={notice}
                  otpEmail={otpEmail}
                  initialReferralCode={initialReferralCode}
                  onView={goView}
                  onSubmit={submit}
                />
              </div>
            </div>
          </section>
        </div>
      </div>

      <div className="cine__particles" aria-hidden="true">
        {MOTES.map((m, i) => (
          <i
            key={i}
            style={
              {
                '--px': m.px,
                '--py': m.py,
                '--ps': m.ps,
                '--pd': m.pd,
                '--pdl': m.pdl,
                '--px2': m.px2,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {(phase === 'snap' || phase === 'launch') && status && (
        <div className="cine__status" role="status">
          <span
            className="p-spinner"
            style={{ borderColor: 'rgba(47,111,239,.3)', borderTopColor: '#2f6fef' }}
          />
          {status}
        </div>
      )}

      {!introGone && <Intro onFinish={finishIntro} onSkip={skipIntro} lifted={introLifted} />}
    </div>
  );
}
