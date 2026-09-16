import { z } from "zod";

import type {
  ActionImpact,
  ActionWarning,
  FieldChange,
  MutationResult,
  ProposedAction,
  ReadAction,
} from "./contracts";
import { pendingClarificationSchema, type PendingClarification } from "./assistant-clarification";
import { dateRangeSchema } from "./assistant-context";
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
  "multiple_changes",
  "outside_capacity_hub",
  "security_request",
  "allocation_date_granularity",
  "partial_day_availability",
  "temporary_capacity_schedule",
  "history_undo_unavailable",
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
  z
    .object({
      type: z.literal("relativeWrite"),
      operation: z.discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("adjustConsultantCapacity"),
            consultant: z.union([
              z.object({ consultantId: uuidSchema }).strict(),
              z.object({ email: z.string().email() }).strict(),
              z.object({ name: z.string().trim().min(1) }).strict(),
            ]),
            delta: z.number().int(),
          })
          .strict(),
        z
          .object({
            kind: z.literal("adjustAllocation"),
            consultant: z.union([
              z.object({ consultantId: uuidSchema }).strict(),
              z.object({ email: z.string().email() }).strict(),
              z.object({ name: z.string().trim().min(1) }).strict(),
            ]),
            demand: z.union([
              z.object({ demandId: uuidSchema }).strict(),
              z.object({ title: z.string().trim().min(1), client: z.string().optional() }).strict(),
            ]),
            delta: z.number().int(),
          })
          .strict(),
        z
          .object({
            kind: z.literal("adjustDemandCapacity"),
            demand: z.union([
              z.object({ demandId: uuidSchema }).strict(),
              z.object({ title: z.string().trim().min(1), client: z.string().optional() }).strict(),
            ]),
            delta: z.number().int(),
          })
          .strict(),
        z
          .object({
            kind: z.literal("changeConsultantSkill"),
            consultant: z.union([
              z.object({ consultantId: uuidSchema }).strict(),
              z.object({ email: z.string().email() }).strict(),
              z.object({ name: z.string().trim().min(1) }).strict(),
            ]),
            skill: z.string().trim().min(1).max(100),
            operation: z.enum(["add", "remove"]),
          })
          .strict(),
        z
          .object({
            kind: z.literal("updateConsultantProfile"),
            consultant: z.union([
              z.object({ consultantId: uuidSchema }).strict(),
              z.object({ email: z.string().email() }).strict(),
              z.object({ name: z.string().trim().min(1) }).strict(),
            ]),
            role: z
              .enum(["Strategy", "Data", "Engineering", "Design", "Product", "Operations"])
              .optional(),
            level: z.enum(["Junior", "Consultant", "Senior", "Manager", "Partner"]).optional(),
            skill: z.string().trim().min(1).max(100).optional(),
            operation: z.enum(["add", "remove"]).optional(),
          })
          .strict(),
      ]),
      asOfDate: isoDateSchema,
    })
    .strict(),
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

export const conversationContextSchema = z
  .object({
    scope: z.enum(["consultant", "team", "demand"]).optional(),
    lastConsultant: z
      .object({
        id: uuidSchema,
        label: z.string().trim().min(1).max(200),
        disambiguator: z.string().trim().max(320).nullable().optional(),
      })
      .strict()
      .optional(),
    lastDemand: z
      .object({
        id: uuidSchema,
        label: z.string().trim().min(1).max(200),
        disambiguator: z.string().trim().max(200).nullable().optional(),
      })
      .strict()
      .optional(),
    lastRange: dateRangeSchema.optional(),
    includePipeline: z.boolean().optional(),
    lastFocus: z
      .enum([
        "free",
        "committed",
        "pipeline",
        "utilization",
        "breakdown",
        "allocations",
        "staffing",
        "availability",
        "skills",
      ])
      .optional(),
    explainFocus: z
      .enum(["free", "committed", "pipeline", "utilization", "allocations"])
      .optional(),
  })
  .strict();

export const assistantRequestSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("interpret"),
      message: z.string().trim().min(1).max(4_000),
      context: conversationContextSchema.optional(),
      pendingClarification: pendingClarificationSchema.optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("clarify"),
      intent: actionableCapacityIntentSchema,
      selections: z.array(clarificationSelectionSchema).min(1).max(4),
      context: conversationContextSchema.optional(),
      pendingClarification: pendingClarificationSchema.optional(),
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

export type CapacityIntent =
  z.infer<typeof capacityIntentSchema> | z.infer<typeof actionableCapacityIntentSchema>;
export type ActionableCapacityIntent = z.infer<typeof actionableCapacityIntentSchema>;
export type AssistantPresentation = z.infer<typeof assistantPresentationSchema>;
export type ClarificationField = z.infer<typeof clarificationFieldSchema>;
export type ClarificationSelection = z.infer<typeof clarificationSelectionSchema>;
export type ConversationContext = {
  scope?: "consultant" | "team" | "demand";
  lastConsultant?: { id: string; label: string; disambiguator?: string | null };
  lastDemand?: { id: string; label: string; disambiguator?: string | null };
  lastRange?: { startDate: string; endDate: string; label?: string };
  includePipeline?: boolean;
  lastFocus?:
    | "free"
    | "committed"
    | "pipeline"
    | "utilization"
    | "breakdown"
    | "allocations"
    | "staffing"
    | "availability"
    | "skills";
  explainFocus?: "free" | "committed" | "pipeline" | "utilization" | "allocations";
};
export type AssistantRequest =
  | {
      mode: "interpret";
      message: string;
      context?: ConversationContext;
      pendingClarification?: PendingClarification;
    }
  | {
      mode: "clarify";
      intent: ActionableCapacityIntent;
      selections: ClarificationSelection[];
      context?: ConversationContext;
      pendingClarification?: PendingClarification;
    }
  | {
      mode: "confirm";
      confirmed: true;
      action: ProposedAction;
      asOfDate: string;
      previewId: string;
    };

export type AssistantCandidate = { id: string; label: string; secondary?: string };

type PendingClarificationResponse = {
  pendingClarification?: PendingClarification | null;
};

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
      archived?: boolean;
      allocations?: Array<{
        id?: string;
        demand: string;
        capacity: number;
        classification: "committed" | "pipeline";
      }>;
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
    }
  | {
      kind: "rangeCapacity";
      onDateStart: string;
      onDateEnd: string;
      person: AssistantPersonRow;
      days: Array<{
        onDate: string;
        free: number;
        overAllocated: number;
        committed: number;
        pipeline: number;
        unavailable: boolean;
      }>;
      aggregate: {
        averageFree: number;
        minimumFree: number;
        maximumFree: number;
        workingDays: number;
      };
      utilization?: number | null;
    }
  | {
      kind: "availabilityWindows";
      windows: Array<{
        consultant: string;
        startDate: string;
        endDate: string;
        minimumFree: number;
        averageFree: number;
      }>;
    }
  | {
      kind: "rangeOverview";
      startDate: string;
      endDate: string;
      days: Array<{
        onDate: string;
        free: number;
        overAllocated: number;
        committed: number;
        pipeline: number;
        gap: number;
      }>;
      minimumFree: number;
      maximumFree: number;
    }
  | {
      kind: "allocationBreakdown";
      startDate: string;
      endDate: string;
      allocations: Array<{
        demand: string;
        capacity: number;
        activeDays: string[];
        classification: "committed" | "pipeline";
      }>;
    }
  | {
      kind: "skillSupplyDemand";
      rows: Array<{ skill: string; consultants: number; demandCount: number }>;
    }
  | { kind: "help"; topic: string; answer: string };

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
  | (PendingClarificationResponse & {
      ok: true;
      kind: "read";
      message: string;
      details: AssistantReadDetails;
      currentDate: string;
      context?: ConversationContext;
    })
  | (PendingClarificationResponse & {
      ok: true;
      kind: "preview";
      message: string;
      action: ProposedAction;
      preview: AssistantPreview;
      currentDate: string;
      context?: ConversationContext;
    })
  | (PendingClarificationResponse & {
      ok: true;
      kind: "clarification";
      message: string;
      field: ClarificationField;
      candidates: AssistantCandidate[];
      intent: ActionableCapacityIntent;
      selections: ClarificationSelection[];
      currentDate: string;
      context?: ConversationContext;
    })
  | (PendingClarificationResponse & {
      ok: true;
      kind: "semantic_clarification";
      message: string;
      currentDate: string;
      context?: ConversationContext;
    })
  | (PendingClarificationResponse & {
      ok: true;
      kind: "unsupported";
      message: string;
      reason: z.infer<typeof unsupportedReasonSchema>;
      currentDate: string;
      context?: ConversationContext;
    })
  | (PendingClarificationResponse & {
      ok: true;
      kind: "executed";
      success: AssistantSuccess;
      currentDate: string;
      context?: ConversationContext;
    })
  | (PendingClarificationResponse & {
      ok: false;
      error: { code: string; message: string; retryable?: boolean };
      replacement?: { action: ProposedAction; preview: AssistantPreview };
      currentDate?: string;
      context?: ConversationContext;
    });

export function isReadIntent(
  intent: ActionableCapacityIntent,
): intent is Extract<CapacityIntent, { type: "read" }> {
  return intent.type === "read";
}

export function readActionFromIntent(intent: ActionableCapacityIntent): ReadAction | null {
  return intent.type === "read" ? intent.action : null;
}
