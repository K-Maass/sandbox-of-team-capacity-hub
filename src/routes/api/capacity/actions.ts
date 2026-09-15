import { createFileRoute } from "@tanstack/react-router";

import { capacityActionRequestSchema } from "@/domain/capacity/validation";
import { requireSupabaseToken } from "@/integrations/supabase/auth-request-middleware.server";

function response(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

type CapacityActionHandlerContext = {
  request: Request;
  context: { userId: string };
};

export const Route = createFileRoute("/api/capacity/actions")({
  // @ts-expect-error -- TanStack's Vite transform supports server routes, but its route type omits this property.
  server: {
    middleware: [requireSupabaseToken],
    handlers: {
      POST: async ({ request, context }: CapacityActionHandlerContext) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return response(
            {
              ok: false,
              error: { code: "VALIDATION_ERROR", message: "Expected a JSON request body" },
            },
            400,
          );
        }

        const parsed = capacityActionRequestSchema.safeParse(body);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          return response(
            {
              ok: false,
              error: {
                code: "VALIDATION_ERROR",
                message: issue?.message ?? "Invalid Capacity Hub action",
                field: issue?.path.join(".") || undefined,
              },
            },
            400,
          );
        }

        const { SupabaseCapacityRepository } = await import("@/server/capacity/repository.server");
        const { executeCapacityAction } = await import("@/server/capacity/actions.server");
        const repository = new SupabaseCapacityRepository(request, context.userId);
        const result = await executeCapacityAction(parsed.data, repository, context.userId);
        if (result.ok) return response(result);
        const status =
          result.error.code === "UNAUTHORIZED"
            ? 401
            : result.error.code === "FORBIDDEN"
              ? 403
              : result.error.code === "NOT_FOUND"
                ? 404
                : result.error.code === "STALE_PREVIEW" || result.error.code === "CONFLICT"
                  ? 409
                  : 400;
        return response(result, status);
      },
    },
  },
});
