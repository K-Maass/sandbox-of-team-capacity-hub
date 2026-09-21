import {
  createClient,
  isAuthError,
  isAuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";

import type { Database } from "./types";

export class SupabaseAuthInvalidTokenError extends Error {
  constructor(message = "The Supabase access token is invalid") {
    super(message);
    this.name = "SupabaseAuthInvalidTokenError";
  }
}

export class SupabaseAuthUnavailableError extends Error {
  constructor(message = "Supabase authentication is unavailable") {
    super(message);
    this.name = "SupabaseAuthUnavailableError";
  }
}

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    // New Supabase API keys are opaque strings, not bearer JWTs.
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }

    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

function authConfiguration(): { url: string; publishableKey: string } {
  const url = process.env["SUPABASE_URL"];
  const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];

  if (!url || !publishableKey) {
    const missing = [
      ...(!url ? ["SUPABASE_URL"] : []),
      ...(!publishableKey ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
    ];
    throw new SupabaseAuthUnavailableError(
      `Missing Supabase environment variable(s): ${missing.join(", ")}`,
    );
  }

  return { url, publishableKey };
}

export function bearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token || token.split(".").length !== 3) return null;
  return token;
}

export function createSupabaseAuthClient(token: string): SupabaseClient<Database> {
  const { url, publishableKey } = authConfiguration();
  return createClient<Database>(url, publishableKey, {
    global: {
      fetch: createSupabaseFetch(publishableKey),
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function verifySupabaseToken(token: string) {
  let supabase: SupabaseClient<Database>;

  try {
    supabase = createSupabaseAuthClient(token);
    const { data, error } = await supabase.auth.getClaims(token);

    if (error) {
      if (
        isAuthRetryableFetchError(error) ||
        (isAuthError(error) && (error.status === undefined || error.status >= 500))
      ) {
        throw new SupabaseAuthUnavailableError();
      }
      throw new SupabaseAuthInvalidTokenError();
    }

    const userId = data?.claims?.sub;
    if (!userId) throw new SupabaseAuthInvalidTokenError("The Supabase token has no user ID");

    return {
      supabase,
      claims: data.claims,
      userId,
    };
  } catch (error) {
    if (
      error instanceof SupabaseAuthInvalidTokenError ||
      error instanceof SupabaseAuthUnavailableError
    ) {
      throw error;
    }
    throw new SupabaseAuthUnavailableError();
  }
}
