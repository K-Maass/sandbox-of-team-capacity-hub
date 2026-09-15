import { z } from "zod";

import type {
  ActionImpact,
  ActionWarning,
  FieldChange,
  MutationResult,
  ProposedAction,
  ReadAction,
} from "./contracts";
import { isoDateSchema, proposedActionSchema, readActionSchema, uuidSchema } from "./validation";

export const assistantPresentationSchema = z.enum([
  "default",
  "available_consultants",
  "staffing_gap",
  "overallocated_consultants",
]);

export const unsupportedReasonSchema = z.enum([
  "destructive_action",
  "missing_information",
  "outside_capacity_hub",
  "security_request",
]);

export const capacityIntentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("read"),
      action: readActionSchema,
      presentation: assistantPresentationSchema.default("default"),
    })
    .strict(),
  z
    .object({
      type: z.literal("write"),
      action: proposedActionSchema,
      asOfDate: isoDateSchema,
    })
    .strict(),
  z.object({ type: z.literal("unsupported"), reason: unsupportedReasonSchema }).strict(),
]);

export const actionableCapacityIntentSchema = z.union([
  capacityIntentSchema.options[0],
  capacityIntentSchema.options[1],
]);

export const clarificationFieldSchema = z.enum([
  "block",
  "block.consultant",
  "consultant",
  "demand",
  "demand.owner",
  "owner",
  "patch.owner",
]);

export const clarificationSelectionSchema = z
  .object({ field: clarificationFieldSchema, candidateId: uuidSchema })
  .strict();

export const assistantRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("interpret"), message: z.string().trim().min(1).max(4_000) }).strict(),
  z
    .object({
      mode: z.literal("clarify"),
      intent: actionableCapacityIntentSchema,
      selections: z.array(clarificationSelectionSchema).min(1).max(4),
    })
    .strict(),
  z
    .object({
      mode: z.literal("confirm"),
      confirmed: z.literal(true),
      action: proposedActionSchema,
      asOfDate: isoDateSchema,
      previewId: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);

export type CapacityIntent = z.infer<typeof capacityIntentSchema>;
export type ActionableCapacityIntent = z.infer<typeof actionableCapacityIntentSchema>;
export type AssistantPresentation = z.infer<typeof assistantPresentationSchema>;
export type ClarificationField = z.infer<typeof clarificationFieldSchema>;
export type ClarificationSelection = z.infer<typeof clarificationSelectionSchema>;
export type AssistantRequest =
  | { mode: "interpret"; message: string }
  | {
      mode: "clarify";
      intent: ActionableCapacityIntent;
      selections: ClarificationSelection[];
    }
  | {
      mode: "confirm";
      confirmed: true;
      action: ProposedAction;
      asOfDate: string;
      previewId: string;
    };

export type AssistantCandidate = { id: string; label: string; secondary?: string };

export type AssistantPersonRow = {
  id: string;
  name: string;
  secondary: string;
  skills: string[];
  availableCapacity: number | null;
  rawFreeCapacity: number | null;
  warnings: string[];
};

export type AssistantDemandRow = {
  id: string;
  title: string;
  client: string;
  status: string;
  requiredCapacity: number;
  staffedCapacity: number;
  gapCapacity: number;
};

export type AssistantReadDetails =
  | { kind: "people"; onDate: string | null; rows: AssistantPersonRow[] }
  | { kind: "demands"; rows: AssistantDemandRow[] }
  | {
      kind: "capacity";
      onDate: string;
      person: AssistantPersonRow;
      committedCapacity: number;
      pipelineCapacity: number;
      unavailable: boolean;
    }
  | {
      kind: "demand";
      demand: AssistantDemandRow;
      allocations: Array<{ id: string; name: string; capacity: number }>;
    }
  | {
      kind: "overview";
      onDate: string;
      activeCount: number;
      availableCapacity: number;
      overAllocatedCapacity: number;
      staffingGap: number;
      people: AssistantPersonRow[];
      demands: AssistantDemandRow[];
    };

export type AssistantPreview = {
  previewId: string;
  asOfDate: string;
  title: string;
  subject: string;
  changes: FieldChange[];
  warnings: ActionWarning[];
  impact: ActionImpact;
  labels: Record<string, string>;
  requiresConfirmation: true;
};

export type AssistantSuccess = {
  message: string;
  result: MutationResult;
  labels: Record<string, string>;
};

export type AssistantResponse =
  | {
      ok: true;
      kind: "read";
      message: string;
      details: AssistantReadDetails;
      currentDate: string;
    }
  | {
      ok: true;
      kind: "preview";
      message: string;
      action: ProposedAction;
      preview: AssistantPreview;
      currentDate: string;
    }
  | {
      ok: true;
      kind: "clarification";
      message: string;
      field: ClarificationField;
      candidates: AssistantCandidate[];
      intent: ActionableCapacityIntent;
      selections: ClarificationSelection[];
      currentDate: string;
    }
  | {
      ok: true;
      kind: "unsupported";
      message: string;
      reason: z.infer<typeof unsupportedReasonSchema>;
      currentDate: string;
    }
  | {
      ok: true;
      kind: "executed";
      success: AssistantSuccess;
      currentDate: string;
    }
  | {
      ok: false;
      error: { code: string; message: string; retryable?: boolean };
      replacement?: { action: ProposedAction; preview: AssistantPreview };
      currentDate?: string;
    };

export function isReadIntent(
  intent: ActionableCapacityIntent,
): intent is Extract<CapacityIntent, { type: "read" }> {
  return intent.type === "read";
}

export function readActionFromIntent(intent: ActionableCapacityIntent): ReadAction | null {
  return intent.type === "read" ? intent.action : null;
}
