import { z } from "zod";
import { isDateRangeOrdered, normalizeSkills } from "./form-validation";

const nonEmpty = z.string().trim().min(1);
const optionalText = z.string().transform((value) => value.trim());

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export const isoDateSchema = z.string().refine(isCalendarDate, "Expected a valid YYYY-MM-DD date");
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

const updateDemandPatchSchema = createDemandFieldsObject
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Patch cannot be empty")
  .refine((value) => isDateRangeOrdered(value.startDate ?? null, value.endDate ?? null), {
    message: "End date cannot be before start date",
    path: ["endDate"],
  });

export const proposedActionSchema = z.union([
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
    .strict()
    .refine((value) => isDateRangeOrdered(value.startDate, value.endDate), {
      message: "End date cannot be before start date",
      path: ["endDate"],
    }),
  z
    .object({ kind: z.literal("removeAvailabilityBlock"), block: availabilityBlockRefSchema })
    .strict(),
]);

export const readActionSchema = z.discriminatedUnion("kind", [
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

export const capacityActionRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("read"), action: readActionSchema }).strict(),
  z
    .object({ mode: z.literal("preview"), action: proposedActionSchema, asOfDate: isoDateSchema })
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
