import { createMiddleware } from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";

import { requireSupabaseToken } from "@/integrations/supabase/auth-request-middleware.server";

type SafeErrorCode = "invalid_response" | "not_configured" | "provider_unavailable" | "timeout";

function jsonResponse(payload: { ok: true; result: "ICA_OK" }, status?: number): Response;
function jsonResponse(payload: { ok: false; error: SafeErrorCode }, status: number): Response;
function jsonResponse(
  payload: { ok: true; result: "ICA_OK" } | { ok: false; error: SafeErrorCode },
  status = 200,
): Response {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isLoopbackRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

const localOnly = createMiddleware().server(async ({ request, next }) => {
  if (process.env.NODE_ENV === "production" || !isLoopbackRequest(request)) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return next();
});

export const Route = createFileRoute("/api/ai/smoke")({
  server: {
    middleware: [localOnly, requireSupabaseToken],
    handlers: {
      POST: async ({ context }) => {
        const userId: string = context.userId;
        void userId;

        const { IbmAiSmokeError, runIbmAiSmoke } = await import("@/lib/ibm-ai.server");

        try {
          const result = await runIbmAiSmoke();
          return jsonResponse({ ok: true, result });
        } catch (error) {
          if (!(error instanceof IbmAiSmokeError)) {
            return jsonResponse({ ok: false, error: "provider_unavailable" }, 502);
          }

          switch (error.code) {
            case "not_configured":
              return jsonResponse({ ok: false, error: error.code }, 503);
            case "timeout":
              return jsonResponse({ ok: false, error: error.code }, 504);
            case "invalid_response":
            case "provider_unavailable":
              return jsonResponse({ ok: false, error: error.code }, 502);
          }
        }
      },
    },
  },
});
