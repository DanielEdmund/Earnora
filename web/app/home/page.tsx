import { permanentRedirect } from 'next/navigation';

/**
 * The marketing page moved to `/`, which is now the content-bearing homepage
 * (AdSense reviews the URL it lands on first).
 *
 * Keeping a second copy of identical content at /home would give the site two
 * "homepages" — duplicate thin content, which is a poor signal for both search
 * and the AdSense site review. All previous /home links keep working through
 * this permanent (308) redirect.
 */
export default function HomePage() {
  permanentRedirect('/');
}
