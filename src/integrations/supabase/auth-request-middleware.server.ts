import { createMiddleware } from "@tanstack/react-start";

import { SupabaseAuthInvalidTokenError, bearerToken, verifySupabaseToken } from "./auth.server";

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
 * Validates a Supabase access token for a server route with the publishable key.
 * Downstream handlers receive only the authenticated user's ID.
 */
export const requireSupabaseToken = createMiddleware().server(async ({ request, next }) => {
  const token = bearerToken(request);
  if (!token) return jsonError("unauthorized", 401);

  try {
    const { userId } = await verifySupabaseToken(token);

    return next({
      context: {
        userId,
      },
    });
  } catch (error) {
    if (error instanceof SupabaseAuthInvalidTokenError) {
      return jsonError("unauthorized", 401);
    }
    return jsonError("auth_unavailable", 503);
  }
});
