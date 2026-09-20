import { requireUser } from "@/lib/auth/session";

/** Overview. The designed screen and the first-run card arrive in Milestone 5 (SPEC §9, §9.3). */
export default async function OverviewPage() {
  const { identity } = await requireUser();
  return (
    <main>
      <h1>Overview</h1>
      <p>Signed in as {identity.email ?? identity.userId}.</p>
    </main>
  );
}
