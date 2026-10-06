import LoginPage from './login/page';

/**
 * The site opens on the cinematic authentication screen:
 * EARNORA intro → suitcase sequence → register (first) → login → dashboard.
 *
 * /login stays as a deep link (and still accepts ?ref= / ?mode=login);
 * this route simply renders the same screen so http://localhost:3001/ goes
 * straight into the intro instead of the marketing page (kept at /home).
 */
export default function RootPage() {
  return <LoginPage />;
}
