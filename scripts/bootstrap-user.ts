/**
 * Creates the single owner through Supabase Auth's admin API without enabling
 * public signups. This script is intentionally interactive so the password is
 * neither stored in an env file nor exposed in the process list.
 *
 *   pnpm bootstrap:user
 *   pnpm bootstrap:user --reset-mfa
 */
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";

interface AuthUser {
  id: string;
  email?: string;
}

interface AuthFactor {
  id: string;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. Copy .env.example to .env.local first.",
  );
}

const adminHeaders = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  "content-type": "application/json",
};

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: { ...adminHeaders, ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const detail =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : `HTTP ${response.status}`;
    throw new Error(`Supabase admin request failed: ${detail}`);
  }
  return body as T;
}

async function listUsers(): Promise<AuthUser[]> {
  const result = await requestJson<{ users: AuthUser[] }>("/auth/v1/admin/users?page=1&per_page=100");
  return result.users ?? [];
}

async function askLine(prompt: string): Promise<string> {
  const lines = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await lines.question(prompt)).trim();
  } finally {
    lines.close();
  }
}

async function askSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error("Password entry requires an interactive terminal.");
  }

  emitKeypressEvents(process.stdin);
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") return finish(new Error("Cancelled."));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " ") value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

function validatePassword(password: string): void {
  const valid =
    password.length >= 12 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password);
  if (!valid) {
    throw new Error("Password must be at least 12 characters and include lower-case, upper-case, number, and symbol.");
  }
}

async function resetMfa(): Promise<void> {
  const users = await listUsers();
  if (users.length !== 1) {
    throw new Error(`Expected exactly one owner account; found ${users.length}. Resolve this in Supabase Auth first.`);
  }
  const user = users[0];
  const result = await requestJson<AuthFactor[] | { factors: AuthFactor[] }>(
    `/auth/v1/admin/users/${encodeURIComponent(user.id)}/factors`,
  );
  const factors = Array.isArray(result) ? result : result.factors;
  for (const factor of factors) {
    await requestJson(`/auth/v1/admin/users/${encodeURIComponent(user.id)}/factors/${encodeURIComponent(factor.id)}`, {
      method: "DELETE",
    });
  }
  console.log(`Removed ${factors.length} MFA factor(s). All verified-factor sessions were downgraded to AAL1.`);
}

async function createOwner(): Promise<void> {
  const users = await listUsers();
  if (users.length > 0) {
    throw new Error(
      `Refusing to create a second account: Supabase Auth already contains ${users.length} user(s). Public signups must remain disabled.`,
    );
  }

  const email = await askLine("Owner email: ");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  const password = await askSecret("Password: ");
  validatePassword(password);
  const confirmation = await askSecret("Confirm password: ");
  if (password !== confirmation) throw new Error("Passwords do not match.");

  const createdResult = await requestJson<AuthUser | { user: AuthUser }>("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const created = "user" in createdResult ? createdResult.user : createdResult;

  try {
    await requestJson("/rest/v1/user_settings?on_conflict=user_id", {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: created.id }),
    });
  } catch (error) {
    // Do not leave a half-bootstrapped account if its settings row cannot be made.
    await requestJson(`/auth/v1/admin/users/${encodeURIComponent(created.id)}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }

  console.log("Owner created. Public signups remain disabled; no password was stored by this script.");
}

const resetRequested = process.argv.slice(2).includes("--reset-mfa");
await (resetRequested ? resetMfa() : createOwner());
