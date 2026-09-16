import { z } from "zod";

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export const calendarDateSchema = z
  .string()
  .refine(isCalendarDate, "Expected a valid YYYY-MM-DD date");

export const dateRangeSchema = z
  .object({
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
    label: z.string().trim().max(120).optional(),
  })
  .strict()
  .refine((value) => value.endDate >= value.startDate, {
    message: "End date cannot be before start date",
    path: ["endDate"],
  });

export type AssistantDateRange = z.infer<typeof dateRangeSchema>;
