import { currentCopy } from "@/lib/copy/server";
import styles from "./layout.module.css";

/**
 * The login family's own shell (SPEC §9.6): brand, skip link and one centred
 * card — no nav, since nothing behind it is reachable yet. The language is
 * the instance default before sign-in and the last user's after a sign-out
 * (`currentCopy` reads the preference cookie).
 */
export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  const copy = await currentCopy();
  return (
    <div className={styles.shell}>
      <a href="#main" className="skip-link">
        {copy.nav.skipToContent}
      </a>
      <p className={styles.brand}>Finance Finder</p>
      <main id="main" className={styles.card}>
        {children}
      </main>
    </div>
  );
}
