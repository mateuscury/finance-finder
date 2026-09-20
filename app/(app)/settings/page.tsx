import { PACKS } from "@/packs";
import { requireUser } from "@/lib/auth/session";

/** Settings. The actions arrive in Milestone 3 Phase 6; the registry listing is the scaffold's build-time proof, kept here. */
export default async function SettingsPage() {
  await requireUser();
  return (
    <main>
      <h1>Settings</h1>
      <h2>Registered market packs</h2>
      <ul>
        {PACKS.map((p) => (
          <li key={p.id}>
            <strong>{p.id}</strong> — {p.name} · {p.currency} · {p.instruments.length} instrument kinds · {p.series.length} series · {p.sources.length}{" "}
            sources · <em>{p.status}</em>
          </li>
        ))}
      </ul>
    </main>
  );
}
