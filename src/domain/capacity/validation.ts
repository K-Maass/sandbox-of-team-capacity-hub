import { z } from "zod";
import { isDateRangeOrdered, normalizeSkills } from "./form-validation";
import { calendarDateSchema } from "./assistant-context";

const nonEmpty = z.string().trim().min(1);
const optionalText = z.string().transform((value) => value.trim());

export const isoDateSchema = calendarDateSchema;
export const uuidSchema = z.string().uuid();
export const levelSchema = z.enum(["Junior", "Consultant", "Senior", "Manager", "Partner"]);
export const roleSchema = z.enum([
  "Strategy",
  "Data",
  "Engineering",
  "Design",
  "Product",
  "Operations",
]);
export const demandTypeSchema = z.enum(["Project", "Topic", "RfP"]);
export const demandStatusSchema = z.enum(["Incoming", "Won", "In Progress", "Lost"]);

const skillsSchema = z.array(z.string()).transform(normalizeSkills);

export const consultantRefSchema = z.union([
  z.object({ consultantId: uuidSchema }).strict(),
  z.object({ email: z.string().trim().email() }).strict(),
  z.object({ name: nonEmpty }).strict(),
]);

export const demandRefSchema = z.union([
  z.object({ demandId: uuidSchema }).strict(),
  z.object({ title: nonEmpty, client: optionalText.optional() }).strict(),
]);

const availabilityBlockRefSchema = z.union([
  z.object({ availabilityBlockId: uuidSchema }).strict(),
  z
    .object({ consultant: consultantRefSchema, startDate: isoDateSchema, endDate: isoDateSchema })
    .strict(),
]);

const createDemandFieldsObject = z.object({
  title: nonEmpty,
  client: optionalText.default(""),
  type: demandTypeSchema.default("Project"),
  status: demandStatusSchema.default("Incoming"),
  description: optionalText.default(""),
  skills: skillsSchema.default([]),
  startDate: isoDateSchema.nullable().default(null),
  endDate: isoDateSchema.nullable().default(null),
  requiredCapacity: z.number().int().min(0).max(1000).default(100),
  owner: consultantRefSchema.nullable().default(null),
});

const createDemandFieldsSchema = createDemandFieldsObject
  .strict()
  .refine((value) => isDateRangeOrdered(value.startDate, value.endDate), {
    message: "End date cannot be before start date",
    path: ["endDate"],
  });

const updateConsultantSchema = z
  .object({
    kind: z.literal("updateConsultant"),
    consultant: consultantRefSchema,
    patch: z
      .object({
        name: nonEmpty.optional(),
        surname: nonEmpty.optional(),
        email: z.string().trim().email().nullable().optional(),
        level: levelSchema.optional(),
        role: roleSchema.optional(),
        skills: skillsSchema.optional(),
        workingCapacity: z.number().int().min(0).max(100).optional(),
        archived: z.boolean().optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, "Patch cannot be empty"),
  })
  .strict();

const createConsultantSchema = z
  .object({
    kind: z.literal("createConsultant"),
    consultant: z
      .object({
        name: nonEmpty,
        surname: nonEmpty,
        email: z.string().trim().email().nullable().default(null),
        level: levelSchema.default("Consultant"),
        role: roleSchema.default("Strategy"),
        skills: skillsSchema.default([]),
        workingCapacity: z.number().int().min(0).max(100).default(100),
      })
      .strict(),
  })
  .strict();

const updateDemandPatchSchema = createDemandFieldsObject
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Patch cannot be empty")
  .refine((value) => isDateRangeOrdered(value.startDate ?? null, value.endDate ?? null), {
    message: "End date cannot be before start date",
    path: ["endDate"],
  });

export const proposedActionSchema = z
  .union([
    createConsultantSchema,
    updateConsultantSchema,
    z.object({ kind: z.literal("createDemand"), demand: createDemandFieldsSchema }).strict(),
    z
      .object({
        kind: z.literal("updateDemand"),
        demand: demandRefSchema,
        patch: updateDemandPatchSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("setAllocation"),
        consultant: consultantRefSchema,
        demand: demandRefSchema,
        capacity: z
          .number()
          .int()
          .min(5)
          .max(100)
          .refine((value) => value % 5 === 0, "Allocation capacity must use 5% increments"),
      })
      .strict(),
    z
      .object({
        kind: z.literal("removeAllocation"),
        consultant: consultantRefSchema,
        demand: demandRefSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("addAvailabilityBlock"),
        consultant: consultantRefSchema,
        startDate: isoDateSchema,
        endDate: isoDateSchema,
        note: optionalText.default(""),
      })
      .strict(),
    z
      .object({ kind: z.literal("removeAvailabilityBlock"), block: availabilityBlockRefSchema })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if (
      value.kind === "addAvailabilityBlock" &&
      !isDateRangeOrdered(value.startDate, value.endDate)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date cannot be before start date",
        path: ["endDate"],
      });
    }
    if (
      value.kind === "removeAvailabilityBlock" &&
      "consultant" in value.block &&
      !isDateRangeOrdered(value.block.startDate, value.block.endDate)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date cannot be before start date",
        path: ["block", "endDate"],
      });
    }
  });

const readActionBaseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("listConsultants"),
      status: z.enum(["active", "archived", "all"]).default("active"),
      role: roleSchema.optional(),
      level: levelSchema.optional(),
      skills: z
        .object({ anyOf: skillsSchema.optional(), allOf: skillsSchema.optional() })
        .strict()
        .optional(),
      onDate: isoDateSchema.optional(),
      includePipeline: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal("listConsultantsRange"),
      status: z.enum(["active", "archived", "all"]).default("active"),
      role: roleSchema.optional(),
      level: levelSchema.optional(),
      skills: z
        .object({ anyOf: skillsSchema.optional(), allOf: skillsSchema.optional() })
        .strict()
        .optional(),
      startDate: isoDateSchema,
      endDate: isoDateSchema,
      includePipeline: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal("getConsultant"),
      consultant: consultantRefSchema,
      onDate: isoDateSchema.optional(),
      includePipeline: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal("listDemands"),
      statuses: z.array(demandStatusSchema).optional(),
      types: z.array(demandTypeSchema).optional(),
      owner: consultantRefSchema.optional(),
      activeOn: isoDateSchema.optional(),
      skills: skillsSchema.optional(),
      includeClosed: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      kind: z.literal("getDemand"),
      demand: demandRefSchema,
      onDate: isoDateSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("getCapacity"),
      consultant: consultantRefSchema,
      onDate: isoDateSchema,
      includePipeline: z.boolean().default(false),
      focus: z
        .enum(["free", "committed", "pipeline", "utilization", "breakdown", "allocations"])
        .default("free"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("getCapacityRange"),
      consultant: consultantRefSchema,
      startDate: isoDateSchema,
      endDate: isoDateSchema,
      includePipeline: z.boolean().default(false),
      focus: z
        .enum(["free", "committed", "pipeline", "utilization", "breakdown", "allocations"])
        .default("free"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("getTeamOverviewRange"),
      startDate: isoDateSchema,
      endDate: isoDateSchema,
      includePipeline: z.boolean().default(false),
      role: roleSchema.optional(),
      level: levelSchema.optional(),
      focus: z.enum(["free", "committed", "pipeline", "utilization", "breakdown"]).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("findAvailabilityWindows"),
      consultant: consultantRefSchema.optional(),
      startDate: isoDateSchema,
      endDate: isoDateSchema,
      minimumFreeCapacity: z.number().int().min(0).max(100),
      minimumWorkingDays: z.number().int().min(1).max(262),
      includePipeline: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal("findStaffingCandidatesRange"),
      demand: demandRefSchema,
      startDate: isoDateSchema,
      endDate: isoDateSchema,
      includePipeline: z.boolean().default(false),
      minimumSkillMatches: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    })
    .strict(),
  z
    .object({
      kind: z.literal("findSuitableDemands"),
      consultant: consultantRefSchema,
      startDate: isoDateSchema,
      endDate: isoDateSchema,
      includePipeline: z.boolean().default(false),
      limit: z.number().int().min(1).max(100).default(20),
    })
    .strict(),
  z
    .object({
      kind: z.literal("skillSupplyDemand"),
      startDate: isoDateSchema,
      endDate: isoDateSchema,
      includePipeline: z.boolean().default(false),
      skill: z.string().trim().min(1).max(100).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("productHelp"),
      topic: z.enum([
        "pipeline",
        "confirmed",
        "committedCapacity",
        "workingCapacity",
        "freeCapacity",
        "overAllocation",
        "candidateRanking",
        "includePipeline",
        "rfp",
        "assistantScope",
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("findStaffingCandidates"),
      demand: demandRefSchema,
      onDate: isoDateSchema,
      includePipeline: z.boolean().default(false),
      minimumSkillMatches: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    })
    .strict(),
  z
    .object({
      kind: z.literal("getTeamOverview"),
      onDate: isoDateSchema,
      includePipeline: z.boolean().default(false),
    })
    .strict(),
]);

export const readActionSchema = readActionBaseSchema.superRefine((value, ctx) => {
  if (
    "startDate" in value &&
    "endDate" in value &&
    !isDateRangeOrdered(value.startDate, value.endDate)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "End date cannot be before start date",
      path: ["endDate"],
    });
  }
});

export const capacityActionRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("read"), action: readActionSchema }).strict(),
  z
    .object({
      mode: z.literal("preview"),
      action: proposedActionSchema,
      asOfDate: isoDateSchema,
      expectedPreconditions: z
        .array(
          z
            .object({
              table: z.enum(["allocations", "availability_blocks", "consultants", "demands"]),
              id: uuidSchema,
              updatedAt: z.string().datetime(),
            })
            .strict(),
        )
        .max(100)
        .optional(),
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

export type ParsedCapacityActionRequest = z.infer<typeof capacityActionRequestSchema>;
