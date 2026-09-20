import { PACKS } from "@/packs";

/**
 * Placeholder home. The ten real screens are specified in SPEC.md §9 and
 * arrive in Milestone 5. This page only proves the pack registry resolves at
 * build time.
 */
export default function Home() {
  return (
    <main style={{ fontFamily: "var(--font-geist-sans)", padding: "2rem", maxWidth: 720 }}>
      <h1>Finance Finder</h1>
      <p>Kernel scaffold. Registered market packs:</p>
      <ul>
        {PACKS.map((p) => (
          <li key={p.id}>
            <strong>{p.id}</strong> — {p.name} · {p.currency} · {p.instruments.length} instrument kinds ·{" "}
            {p.series.length} series · {p.sources.length} sources · <em>{p.status}</em>
          </li>
        ))}
      </ul>
    </main>
  );
}
