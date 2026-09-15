import { createMiddleware } from "@tanstack/react-start";

import { supabaseAdmin } from "./client.server";

function jsonError(error: "auth_unavailable" | "unauthorized", status: number): Response {
  return Response.json(
    { ok: false, error },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

/**
 * Validates a Supabase access token for a server route.
 *
 * The bearer token and service-role client remain inside this adapter. Downstream
 * handlers receive only the authenticated user's ID.
 */
export const requireSupabaseToken = createMiddleware().server(async ({ request, next }) => {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonError("unauthorized", 401);

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token || token.split(".").length !== 3) return jsonError("unauthorized", 401);

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) return jsonError("unauthorized", 401);

    return next({
      context: {
        userId: data.user.id,
      },
    });
  } catch {
    return jsonError("auth_unavailable", 503);
  }
});
