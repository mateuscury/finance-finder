/**
 * The access decision, kept free of Next and Supabase imports so it can be
 * tested with a fake client (docs/milestone-3-plan.md "Identity and
 * sessions").
 *
 * Identity is established with `getUser()` — verified against Auth on every
 * call, never read from the cookie — then the session's assurance level is
 * compared with the level the user's factors allow. An owner who enrolled a
 * TOTP factor must reach AAL2 before any data page or action runs.
 */

export type AssuranceLevel = "aal1" | "aal2";

export interface Identity {
  userId: string;
  email: string | null;
  currentLevel: AssuranceLevel;
  nextLevel: AssuranceLevel;
}

export type Access = { kind: "unauthenticated" } | { kind: "mfa_required"; identity: Identity } | { kind: "ok"; identity: Identity };

/** The slice of a Supabase client `resolveAccess` reads; a test passes a fake. */
export interface AuthReader {
  getUser(): Promise<{ data: { user: { id: string; email?: string | null } | null }; error: unknown }>;
  mfa: {
    getAuthenticatorAssuranceLevel(): Promise<{
      data: { currentLevel: string | null; nextLevel: string | null } | null;
      error: unknown;
    }>;
  };
}

function level(value: string | null | undefined): AssuranceLevel {
  return value === "aal2" ? "aal2" : "aal1";
}

export async function resolveAccess(auth: AuthReader): Promise<Access> {
  const { data, error } = await auth.getUser();
  if (error || !data.user) return { kind: "unauthenticated" };
  const aal = await auth.mfa.getAuthenticatorAssuranceLevel();
  const identity: Identity = {
    userId: data.user.id,
    email: data.user.email ?? null,
    currentLevel: level(aal.data?.currentLevel),
    nextLevel: level(aal.data?.nextLevel),
  };
  if (identity.nextLevel === "aal2" && identity.currentLevel !== "aal2") return { kind: "mfa_required", identity };
  return { kind: "ok", identity };
}

export const LOGIN_PATH = "/login";
export const MFA_PATH = "/login/mfa";

/** Routes reachable without a data-level session: the login family and the auth callback. */
export function isPublicPath(pathname: string): boolean {
  return pathname === LOGIN_PATH || pathname.startsWith(`${LOGIN_PATH}/`) || pathname.startsWith("/auth/");
}

/**
 * Where a request for `pathname` should go given its access, or null to let it
 * through. Used optimistically by the proxy and authoritatively by the DAL.
 */
export function redirectFor(pathname: string, access: Access): string | null {
  const publicPath = isPublicPath(pathname);
  switch (access.kind) {
    case "unauthenticated":
      return publicPath ? null : LOGIN_PATH;
    case "mfa_required":
      return publicPath ? null : MFA_PATH;
    case "ok":
      // A signed-in user has no business on the login or challenge page.
      return pathname === LOGIN_PATH || pathname === MFA_PATH ? "/" : null;
  }
}
