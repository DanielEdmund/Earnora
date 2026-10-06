'use client';

import { useEffect, useRef, useState } from 'react';

export type AuthView = 'register' | 'login' | 'forgot' | 'otp' | 'reset';

export type AuthKind = 'register' | 'login' | 'forgot' | 'otp' | 'reset';

/** Used to decide which way the panel morphs. */
const ORDER: AuthView[] = ['register', 'login', 'forgot', 'otp', 'reset'];

interface Props {
  view: AuthView;
  busy: boolean;
  error: string;
  notice: string;
  /** Email the OTP was sent to (display only). */
  otpEmail: string;
  initialReferralCode?: string;
  onView: (v: AuthView) => void;
  onSubmit: (kind: AuthKind, payload: Record<string, string>) => void;
}

const at = (i: number) => ({ '--i': i }) as React.CSSProperties;

export default function AuthPanel({
  view,
  busy,
  error,
  notice,
  otpEmail,
  initialReferralCode = '',
  onView,
  onSubmit,
}: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [phone, setPhone] = useState('');
  const [refCode, setRefCode] = useState(initialReferralCode);
  const [showPw, setShowPw] = useState(false);
  const [localError, setLocalError] = useState('');

  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', '']);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  // ── morph bookkeeping ───────────────────────────────────────────
  // The active view is a single element that is re-keyed per view; it mounts
  // WITHOUT .is-active and gains it two frames later so the CSS transitions
  // (and the per-field stagger) actually run instead of snapping.
  const prevView = useRef<AuthView>(view);
  const seq = useRef(0);
  const mountedId = useRef(0);
  const [mounted, setMounted] = useState<{ view: AuthView; id: number; active: boolean }>({
    view,
    id: 0,
    active: false,
  });
  const [leaving, setLeaving] = useState<{ view: AuthView; id: number } | null>(null);
  const [dir, setDir] = useState(1);

  useEffect(() => {
    // first paint: bring the fields in as the panel is still rising
    const boot = requestAnimationFrame(() =>
      requestAnimationFrame(() => setMounted((m) => (m.active ? m : { ...m, active: true }))),
    );
    return () => cancelAnimationFrame(boot);
  }, []);

  useEffect(() => {
    const from = prevView.current;
    prevView.current = view;
    if (from === view) return;

    setDir(ORDER.indexOf(view) > ORDER.indexOf(from) ? 1 : -1);
    const prevId = mountedId.current;
    setLeaving({ view: from, id: prevId });

    const id = ++seq.current;
    mountedId.current = id;
    setMounted({ view, id, active: false });

    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => setMounted((m) => (m.id === id ? { ...m, active: true } : m))),
    );
    const clear = setTimeout(() => setLeaving((l) => (l && l.id === prevId ? null : l)), 700);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(clear);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => setLocalError(''), [view]);

  function fail(message: string) {
    setLocalError(message);
  }

  function handle(kind: AuthKind) {
    setLocalError('');
    if (kind === 'register') {
      if (password.length < 8) return fail('Password must be at least 8 characters');
      // no confirm field on sign-up (the API takes one password) — the reset
      // view below keeps its own "Confirm new password" check
      onSubmit('register', { email, password, phone, referralCode: refCode });
      return;
    }
    if (kind === 'login') {
      onSubmit('login', { email, password });
      return;
    }
    if (kind === 'forgot') {
      onSubmit('forgot', { email });
      return;
    }
    if (kind === 'otp') {
      const code = otp.join('');
      if (code.length !== 6) return fail('Enter the full 6-digit code');
      onSubmit('otp', { email, code });
      return;
    }
    if (kind === 'reset') {
      if (password.length < 8) return fail('Password must be at least 8 characters');
      if (password !== confirm) return fail('Passwords do not match');
      onSubmit('reset', { password });
    }
  }

  // ── OTP box helpers ─────────────────────────────────────────────
  function setOtpAt(i: number, value: string) {
    setOtp((prev) => {
      const next = [...prev];
      next[i] = value;
      return next;
    });
  }

  function onOtpChange(i: number, raw: string) {
    const digits = raw.replace(/\D/g, '');
    if (!digits) {
      setOtpAt(i, '');
      return;
    }
    setOtpAt(i, digits.slice(-1));
    if (digits.length > 1) spreadOtp(digits, i);
    else if (i < 5) otpRefs.current[i + 1]?.focus();
  }

  function spreadOtp(digits: string, from: number) {
    const chars = digits.replace(/\D/g, '').split('').slice(0, 6 - from);
    setOtp((prev) => {
      const next = [...prev];
      chars.forEach((c, k) => (next[from + k] = c));
      return next;
    });
    const target = Math.min(from + chars.length, 5);
    otpRefs.current[target]?.focus();
  }

  function onOtpKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !otp[i] && i > 0) {
      e.preventDefault();
      otpRefs.current[i - 1]?.focus();
      setOtpAt(i - 1, '');
    }
    if (e.key === 'ArrowLeft' && i > 0) otpRefs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < 5) otpRefs.current[i + 1]?.focus();
  }

  function onOtpPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '');
    if (!text) return;
    e.preventDefault();
    spreadOtp(text, 0);
  }

  const shownError = error || localError;

  // ── shared field markup ─────────────────────────────────────────
  function emailField(i: number, label = 'Email address') {
    return (
      <label className="pfield" style={at(i)}>
        <span>{label}</span>
        <span className="slot">
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
          />
          <i className="fa-regular fa-envelope lead" />
        </span>
      </label>
    );
  }

  function passwordField(i: number, labelText: string, value: string, set: (v: string) => void, autocomplete: string) {
    return (
      <label className="pfield" style={at(i)}>
        <span>{labelText}</span>
        <span className="slot">
          <input
            type={showPw ? 'text' : 'password'}
            required
            minLength={8}
            autoComplete={autocomplete}
            value={value}
            onChange={(e) => set(e.target.value)}
            placeholder="••••••••"
          />
          <i className="fa-solid fa-lock lead" />
          <button
            type="button"
            className="reveal"
            onClick={() => setShowPw((s) => !s)}
            aria-label={showPw ? 'Hide password' : 'Show password'}
          >
            <i className={showPw ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye'} />
          </button>
        </span>
      </label>
    );
  }

  function alertBox() {
    if (!shownError) return null;
    return (
      <div className="p-alert" role="alert">
        <i className="fa-solid fa-circle-exclamation" />
        <span>{shownError}</span>
      </div>
    );
  }

  function noteBox() {
    if (!notice) return null;
    return (
      <div className="p-note" role="status">
        <i className="fa-regular fa-paper-plane" />
        <span>{notice}</span>
      </div>
    );
  }

  // ── the actual views ────────────────────────────────────────────
  const heads: Record<AuthView, { eyebrow: string; icon: string; title: string; sub: string }> = {
    register: {
      eyebrow: 'Create account',
      icon: 'fa-solid fa-sparkles',
      title: 'Create your Earnora account',
      sub: 'Free sign up — no KYC required. Takes less than a minute.',
    },
    login: {
      eyebrow: 'Welcome back',
      icon: 'fa-solid fa-bolt',
      title: 'Welcome back',
      sub: 'Log in to pick up your tasks, referrals and earnings.',
    },
    forgot: {
      eyebrow: 'Account recovery',
      icon: 'fa-solid fa-key',
      title: 'Reset your password',
      sub: 'Enter your email address and we will send you a verification code.',
    },
    otp: {
      eyebrow: 'Verification',
      icon: 'fa-solid fa-shield-halved',
      title: 'Enter verification code',
      sub: `We sent a 6-digit code to ${otpEmail || 'your email'}. It expires in 10 minutes.`,
    },
    reset: {
      eyebrow: 'New password',
      icon: 'fa-solid fa-lock',
      title: 'Choose a new password',
      sub: 'Almost there — pick a strong password for your Earnora account.',
    },
  };

  function renderView(v: AuthView) {
    const head = heads[v];

    if (v === 'otp') {
      return (
        <>
          <header className="p-head pfield" style={at(0)}>
            <span className="p-eyebrow">
              <i className={head.icon} /> {head.eyebrow}
            </span>
            <h2>{head.title}</h2>
            <p>{head.sub}</p>
          </header>

          <form onSubmit={(e) => { e.preventDefault(); handle('otp'); }}>
            {alertBox()}
            {noteBox()}
            {/* delivery hint: where to look when the mail is slow or filtered */}
            <div className="p-hint pfield" style={at(1)}>
              <i className="fa-regular fa-envelope" />
              <span>
                Can&apos;t find it? Check <strong>Spam</strong> or <strong>Promotions</strong> —
                it can take a minute.
              </span>
            </div>
            <div className="p-otp pfield" style={at(2)} onPaste={onOtpPaste}>
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    otpRefs.current[i] = el;
                  }}
                  inputMode="numeric"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  maxLength={6}
                  value={digit}
                  className={digit ? 'filled' : ''}
                  aria-label={`Digit ${i + 1}`}
                  onChange={(e) => onOtpChange(i, e.target.value)}
                  onKeyDown={(e) => onOtpKeyDown(i, e)}
                />
              ))}
            </div>

            <div className="pfield" style={at(3)}>
              <button className="p-btn" type="submit" disabled={busy}>
                {busy ? <span className="p-spinner" /> : <i className="fa-solid fa-check" />}
                <span>{busy ? 'Verifying…' : 'Verify OTP'}</span>
              </button>
            </div>
          </form>

          <p className="p-link p-link--quiet pfield" style={at(4)}>
            Didn&apos;t get it?{' '}
            <button type="button" disabled={busy} onClick={() => handle('forgot')}>
              Resend code
            </button>
          </p>
          <p className="p-link pfield" style={at(5)}>
            <button type="button" onClick={() => onView('login')}>
              Back to login
            </button>
          </p>
        </>
      );
    }

    if (v === 'forgot') {
      return (
        <>
          <header className="p-head pfield" style={at(0)}>
            <span className="p-eyebrow">
              <i className={head.icon} /> {head.eyebrow}
            </span>
            <h2>{head.title}</h2>
            <p>{head.sub}</p>
          </header>

          <form onSubmit={(e) => { e.preventDefault(); handle('forgot'); }}>
            {alertBox()}
            {noteBox()}
            {emailField(1)}
            <div className="pfield" style={at(2)}>
              <button className="p-btn" type="submit" disabled={busy}>
                {busy ? <span className="p-spinner" /> : <i className="fa-regular fa-paper-plane" />}
                <span>{busy ? 'Sending…' : 'Send OTP'}</span>
              </button>
            </div>
          </form>

          <p className="p-link pfield" style={at(3)}>
            <button type="button" onClick={() => onView('login')}>
              Back to login
            </button>
          </p>
        </>
      );
    }

    if (v === 'reset') {
      return (
        <>
          <header className="p-head pfield" style={at(0)}>
            <span className="p-eyebrow">
              <i className={head.icon} /> {head.eyebrow}
            </span>
            <h2>{head.title}</h2>
            <p>{head.sub}</p>
          </header>

          <form onSubmit={(e) => { e.preventDefault(); handle('reset'); }}>
            {alertBox()}
            <div className="p-row pfield" style={at(1)}>
              {passwordField(1, 'New password', password, setPassword, 'new-password')}
              {passwordField(2, 'Confirm new password', confirm, setConfirm, 'new-password')}
            </div>
            <div className="pfield" style={at(3)}>
              <button className="p-btn" type="submit" disabled={busy}>
                {busy ? <span className="p-spinner" /> : <i className="fa-solid fa-shield-halved" />}
                <span>{busy ? 'Saving…' : 'Reset password'}</span>
              </button>
            </div>
          </form>

          <p className="p-link pfield" style={at(4)}>
            <button type="button" onClick={() => onView('login')}>
              Back to login
            </button>
          </p>
        </>
      );
    }

    if (v === 'login') {
      return (
        <>
          <header className="p-head pfield" style={at(0)}>
            <span className="p-eyebrow">
              <i className={head.icon} /> {head.eyebrow}
            </span>
            <h2>{head.title}</h2>
            <p>{head.sub}</p>
          </header>

          <form onSubmit={(e) => { e.preventDefault(); handle('login'); }}>
            {alertBox()}
            {noteBox()}
            <div className="p-row pfield" style={at(1)}>
              {emailField(1)}
              {passwordField(2, 'Password', password, setPassword, 'current-password')}
            </div>
            <div className="pfield" style={at(4)}>
              <button className="p-btn" type="submit" disabled={busy}>
                {busy ? <span className="p-spinner" /> : <i className="fa-solid fa-arrow-right-to-bracket" />}
                <span>{busy ? 'Logging in…' : 'Login'}</span>
              </button>
            </div>
          </form>

          <p className="p-link p-link--quiet pfield" style={at(5)}>
            <button type="button" onClick={() => onView('forgot')}>
              Forgot password?
            </button>
          </p>
          <p className="p-link pfield" style={at(6)}>
            Don&apos;t have an account? <button type="button" onClick={() => onView('register')}>Create account</button>
          </p>
        </>
      );
    }

    // register
    return (
      <>
        <header className="p-head pfield" style={at(0)}>
          <span className="p-eyebrow">
            <i className={head.icon} /> {head.eyebrow}
          </span>
          <h2>{head.title}</h2>
          <p>{head.sub}</p>
        </header>

        <form onSubmit={(e) => { e.preventDefault(); handle('register'); }}>
          {alertBox()}
          <div className="p-row pfield" style={at(1)}>
            {emailField(1)}
            {passwordField(2, 'Password', password, setPassword, 'new-password')}
          </div>

          <div className="p-row pfield" style={at(3)}>
            <label className="pfield" style={{ marginBottom: 0 }}>
              <span>Phone number</span>
              <span className="slot">
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="08123456789"
                  autoComplete="tel"
                />
                <i className="fa-solid fa-phone lead" />
              </span>
            </label>
            <label className="pfield" style={{ marginBottom: 0 }}>
              <span>
                Referral code <em>(optional)</em>
              </span>
              <span className="slot">
                <input
                  value={refCode}
                  onChange={(e) => setRefCode(e.target.value.toUpperCase())}
                  placeholder="Inviter code"
                />
                <i className="fa-solid fa-ticket lead" />
              </span>
            </label>
          </div>

          <div className="pfield" style={at(4)}>
            <button className="p-btn" type="submit" disabled={busy}>
              {busy ? <span className="p-spinner" /> : <i className="fa-solid fa-user-plus" />}
              <span>{busy ? 'Creating account…' : 'Create Account'}</span>
            </button>
          </div>
        </form>

        <p className="p-link pfield" style={at(5)}>
          Already have an account? <button type="button" onClick={() => onView('login')}>Login</button>
        </p>
      </>
    );
  }

  return (
    <div className="p-views" style={{ '--dir': dir } as React.CSSProperties}>
      {leaving && (
        <div className="pview is-leaving" key={`leaving-${leaving.id}`} inert>
          {renderView(leaving.view)}
        </div>
      )}
      <div className={`pview${mounted.active ? ' is-active' : ''}`} key={`active-${mounted.id}`}>
        {renderView(mounted.view)}
      </div>
    </div>
  );
}
