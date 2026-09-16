import { createFileRoute } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import { z } from "zod";

import { assistantRequestSchema } from "@/domain/capacity/assistant";
import { CapacityActionFailure } from "@/domain/capacity/errors";
import { requireSupabaseToken } from "@/integrations/supabase/auth-request-middleware.server";
import { CAPACITY_ASSISTANT_BOUNDS } from "@/server/capacity/bounds.server";
import { CapacityV2InterpreterError } from "@/server/capacity/assistant-interpreter-v2.server";

const MAX_REQUEST_BYTES = CAPACITY_ASSISTANT_BOUNDS.maxRequestBytes;

function response(payload: unknown, status = 200): Response {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function isLoopbackRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

const localOnly = createMiddleware().server(async ({ request, next }) => {
  if (process.env.NODE_ENV === "production" || !isLoopbackRequest(request)) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return next();
});

async function readLimitedJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_REQUEST_BYTES) throw new Error("REQUEST_TOO_LARGE");
  if (!request.body) throw new Error("INVALID_JSON");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new Error("REQUEST_TOO_LARGE");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function statusFor(code: string): number {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "NOT_FOUND") return 404;
  if (code === "STALE_PREVIEW" || code === "CONFLICT" || code === "CLARIFICATION_STALE") return 409;
  if (code === "AI_NOT_CONFIGURED") return 503;
  if (code === "AI_TIMEOUT") return 504;
  if (code === "AI_UNAVAILABLE" || code === "AI_INVALID_RESPONSE") return 502;
  if (code === "REQUEST_CANCELLED") return 499;
  return 400;
}

type HandlerContext = { request: Request; context: { userId: string } };

export const Route = createFileRoute("/api/ai/capacity")({
  // @ts-expect-error -- TanStack's Vite transform supports server routes, but its route type omits this property.
  server: {
    middleware: [localOnly, requireSupabaseToken],
    handlers: {
      POST: async ({ request, context }: HandlerContext) => {
        let body: unknown;
        try {
          body = await readLimitedJson(request);
        } catch (error) {
          const code =
            error instanceof Error && error.message === "REQUEST_TOO_LARGE"
              ? "REQUEST_TOO_LARGE"
              : "INVALID_REQUEST";
          return response(
            {
              ok: false,
              error: {
                code,
                message:
                  code === "REQUEST_TOO_LARGE"
                    ? "Request is too large."
                    : "Expected a valid JSON request.",
              },
            },
            400,
          );
        }

        const parsed = assistantRequestSchema.safeParse(body);
        if (!parsed.success) {
          return response(
            {
              ok: false,
              error: {
                code: "VALIDATION_ERROR",
                message: parsed.error.issues[0]?.message ?? "Invalid assistant request.",
              },
            },
            400,
          );
        }

        try {
          const [{ SupabaseCapacityRepository }, { handleCapacityAssistant }] = await Promise.all([
            import("@/server/capacity/repository.server"),
            import("@/server/capacity/assistant.server"),
          ]);
          const repository = new SupabaseCapacityRepository(request, context.userId);
          const result = await handleCapacityAssistant(parsed.data, repository, context.userId, {
            signal: request.signal,
            useV2Reads: parsed.data.mode === "interpret",
          });
          return response(result, result.ok ? 200 : statusFor(result.error.code));
        } catch (error) {
          const { IbmAiRequestError } = await import("@/lib/ibm-ai.server");
          if (error instanceof CapacityV2InterpreterError) {
            const mapped =
              error.providerCode === "cancelled"
                ? (["REQUEST_CANCELLED", "Request was cancelled."] as const)
                : error.providerCode === "not_configured"
                  ? (["AI_NOT_CONFIGURED", "The local AI runtime is not configured."] as const)
                  : error.providerCode === "timeout"
                    ? (["AI_TIMEOUT", "The AI provider timed out."] as const)
                    : error.providerCode === "provider_unavailable"
                      ? (["AI_UNAVAILABLE", "The AI provider is unavailable."] as const)
                      : ([
                          "AI_INVALID_RESPONSE",
                          "The AI response could not be validated.",
                        ] as const);
            const [code, message] = mapped;
            return response(
              { ok: false, error: { code, message, retryable: code !== "AI_NOT_CONFIGURED" } },
              statusFor(code),
            );
          }
          if (error instanceof IbmAiRequestError) {
            const mapped = {
              cancelled: ["REQUEST_CANCELLED", "Request was cancelled."],
              invalid_response: ["AI_INVALID_RESPONSE", "The AI response could not be validated."],
              not_configured: ["AI_NOT_CONFIGURED", "The local AI runtime is not configured."],
              provider_unavailable: ["AI_UNAVAILABLE", "The AI provider is unavailable."],
              timeout: ["AI_TIMEOUT", "The AI provider timed out."],
            } as const;
            const [code, message] = mapped[error.code];
            return response(
              { ok: false, error: { code, message, retryable: error.code !== "not_configured" } },
              statusFor(code),
            );
          }
          if (
            error instanceof z.ZodError ||
            (error instanceof Error &&
              ["INVALID_MODEL_OUTPUT", "UNKNOWN_MODEL_ACTION"].includes(error.message))
          ) {
            return response(
              {
                ok: false,
                error: {
                  code: "AI_INVALID_RESPONSE",
                  message: "The AI response could not be validated.",
                  retryable: true,
                },
              },
              502,
            );
          }
          if (error instanceof CapacityActionFailure) {
            return response({ ok: false, error: error.detail }, statusFor(error.detail.code));
          }
          return response(
            {
              ok: false,
              error: {
                code: "ACTION_FAILED",
                message: "The assistant request could not be completed.",
                retryable: true,
              },
            },
            500,
          );
        }
      },
    },
  },
});
