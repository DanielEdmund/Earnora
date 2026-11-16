import Link from 'next/link';

/**
 * 404 — a "dead end / error page", one of the screens Google explicitly lists
 * as having no publisher content. It therefore carries real copy and navigation
 * (so a visitor can recover) and NO AdSense snippet: ads must never render here.
 */
export default function NotFound() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 20px',
        background: 'linear-gradient(160deg, #f2f6ff 0%, #e7efff 55%, #dce8ff 100%)',
        fontFamily: "'Work Sans', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 560,
          width: '100%',
          background: '#fff',
          borderRadius: 22,
          padding: '34px 30px 30px',
          boxShadow: '0 24px 60px rgba(29,63,214,0.14)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #1d3fd6, #4a7bff)',
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: 18,
            }}
          >
            E
          </span>
          <span style={{ fontWeight: 800, fontSize: 17, color: '#0f1b3d' }}>Earnora</span>
        </div>

        <p style={{ margin: '0 0 6px', fontSize: 13, letterSpacing: '0.08em', fontWeight: 700, color: '#4a7bff' }}>
          ERROR 404
        </p>
        <h1 style={{ margin: '0 0 10px', fontSize: 26, lineHeight: 1.2, color: '#0f1b3d' }}>
          We couldn&apos;t find that page
        </h1>
        <p style={{ margin: '0 0 22px', fontSize: 15, lineHeight: 1.7, color: '#475569' }}>
          The link may be outdated, or the page may have moved. Nothing is wrong with your account — pick a route
          below and carry on.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <Link
            href="/"
            style={{
              background: 'linear-gradient(135deg, #1d3fd6, #4a7bff)',
              color: '#fff',
              textDecoration: 'none',
              fontWeight: 700,
              fontSize: 14,
              padding: '11px 18px',
              borderRadius: 999,
            }}
          >
            Back to home
          </Link>
          <Link
            href="/login?mode=register"
            style={{
              background: '#eef3ff',
              color: '#1d3fd6',
              textDecoration: 'none',
              fontWeight: 700,
              fontSize: 14,
              padding: '11px 18px',
              borderRadius: 999,
            }}
          >
            Create an account
          </Link>
          <Link
            href="/terms"
            style={{
              background: '#f1f5f9',
              color: '#334155',
              textDecoration: 'none',
              fontWeight: 700,
              fontSize: 14,
              padding: '11px 18px',
              borderRadius: 999,
            }}
          >
            Terms &amp; Policy
          </Link>
        </div>

        <p style={{ margin: '22px 0 0', fontSize: 13, color: '#94a3b8' }}>
          Already earning? Log in from the home page and open your dashboard.
        </p>
      </div>
    </div>
  );
}
