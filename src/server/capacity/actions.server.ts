import type {
  ActionError,
  ActionPreview,
  ActionResult,
  CapacityActionRequest,
  CapacityDataSet,
  JsonValue,
  MutationResult,
  ResolvedAction,
} from "@/domain/capacity/contracts";
import { CapacityActionFailure } from "@/domain/capacity/errors";
import { buildActionPreview, computeActionImpact } from "@/domain/capacity/previews";
import { executeReadAction } from "@/domain/capacity/reads";
import { CAPACITY_ASSISTANT_BOUNDS } from "./bounds.server";
import type { CapacityRepository } from "./repository";

export type CapacityActionResponse =
  | ActionResult<unknown>
  | {
      ok: false;
      error: {
        code: "STALE_PREVIEW";
        message: string;
      };
      replacementPreview: ActionPreview | null;
      currentError?: ActionError;
    };

function recordForAction(
  data: CapacityDataSet,
  action: ResolvedAction,
  entityId?: string,
): JsonValue | null {
  let value: unknown = null;
  switch (action.kind) {
    case "createConsultant":
      value = entityId ? (data.consultants.find((item) => item.id === entityId) ?? null) : null;
      break;
    case "updateConsultant":
      value = data.consultants.find((item) => item.id === action.consultantId) ?? null;
      break;
    case "createDemand":
      value = entityId ? (data.demands.find((item) => item.id === entityId) ?? null) : null;
      break;
    case "updateDemand":
      value = data.demands.find((item) => item.id === action.demandId) ?? null;
      break;
    case "setAllocation":
      value =
        data.allocations.find((item) => item.id === (entityId ?? action.allocationId)) ?? null;
      break;
    case "removeAllocation":
      value = data.allocations.find((item) => item.id === action.allocationId) ?? null;
      break;
    case "addAvailabilityBlock":
      value = entityId
        ? (data.availabilityBlocks.find((item) => item.id === entityId) ?? null)
        : null;
      break;
    case "removeAvailabilityBlock":
      value =
        data.availabilityBlocks.find((item) => item.id === action.availabilityBlockId) ?? null;
      break;
  }
  return value === null ? null : (JSON.parse(JSON.stringify(value)) as JsonValue);
}

async function staleResponse(
  repository: CapacityRepository,
  action: Extract<CapacityActionRequest, { mode: "confirm" }>["action"],
  asOfDate: string,
  actorUserId: string,
): Promise<CapacityActionResponse> {
  const current = await repository.load();
  let replacementPreview: ActionPreview;
  try {
    replacementPreview = await buildActionPreview(action, current, asOfDate, actorUserId);
  } catch (error) {
    if (error instanceof CapacityActionFailure) {
      return {
        ok: false,
        error: { code: "STALE_PREVIEW", message: "The action is no longer valid" },
        replacementPreview: null,
        currentError: error.detail,
      };
    }
    throw error;
  }
  return {
    ok: false,
    error: { code: "STALE_PREVIEW", message: "The underlying Capacity Hub data changed" },
    replacementPreview,
  };
}

export async function executeCapacityAction(
  request: CapacityActionRequest,
  repository: CapacityRepository,
  actorUserId: string,
): Promise<CapacityActionResponse> {
  try {
    if (request.mode === "read") {
      const data = await repository.load();
      return {
        ok: true,
        data: executeReadAction(request.action, data, CAPACITY_ASSISTANT_BOUNDS),
      };
    }

    const current = await repository.load();
    let preview: ActionPreview;
    try {
      preview = await buildActionPreview(
        request.action,
        current,
        request.asOfDate,
        actorUserId,
        request.mode === "preview" ? request.expectedPreconditions : undefined,
      );
    } catch (error) {
      if (
        request.mode === "preview" &&
        error instanceof CapacityActionFailure &&
        error.detail.code === "STALE_PREVIEW"
      ) {
        return { ok: false, error: error.detail, replacementPreview: null };
      }
      if (request.mode === "confirm" && error instanceof CapacityActionFailure) {
        return {
          ok: false,
          error: { code: "STALE_PREVIEW", message: "The action is no longer valid" },
          replacementPreview: null,
          currentError: error.detail,
        };
      }
      throw error;
    }

    if (request.mode === "preview") return { ok: true, data: preview };

    if (preview.previewId !== request.previewId) {
      return {
        ok: false,
        error: { code: "STALE_PREVIEW", message: "The preview is stale or does not match" },
        replacementPreview: preview,
      };
    }

    if (!preview.changes.length) {
      const unchanged = recordForAction(current, preview.action);
      const result: MutationResult = {
        phase: "executed",
        actionKind: request.action.kind,
        changed: false,
        changedFields: [],
        before: unchanged,
        after: unchanged,
        actualImpact: preview.impact,
        executedAt: new Date().toISOString(),
      };
      return { ok: true, data: result };
    }

    try {
      const beforeRecord = recordForAction(current, preview.action);
      const mutation = await repository.apply(preview.action, preview, actorUserId);
      const after = await repository.load();
      const result: MutationResult = {
        phase: "executed",
        actionKind: request.action.kind,
        changed: true,
        changedFields: mutation.changedFields,
        before: beforeRecord,
        after: recordForAction(after, preview.action, mutation.entityId),
        actualImpact: computeActionImpact(current, after, preview.action, request.asOfDate),
        executedAt: new Date().toISOString(),
      };
      return { ok: true, data: result };
    } catch (error) {
      if (
        error instanceof CapacityActionFailure &&
        (error.detail.code === "CONFLICT" || error.detail.code === "STALE_PREVIEW")
      ) {
        return await staleResponse(repository, request.action, request.asOfDate, actorUserId);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof CapacityActionFailure) return { ok: false, error: error.detail };
    return {
      ok: false,
      error: { code: "CONFLICT", message: "The Capacity Hub action could not be completed" },
    };
  }
}
