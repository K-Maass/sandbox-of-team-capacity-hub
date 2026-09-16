// @ts-expect-error -- Bun provides this module at test runtime; app builds do not include Bun types.
import { describe, expect, test } from "bun:test";

import { CapacityActionFailure } from "./errors";
import { resolveConsultant, resolveDemand } from "./resolution";
import {
  normalizeSkills,
  parseDemandRequiredCapacity,
  validateAvailabilityBlockForm,
  validateConsultantForm,
  validateDemandForm,
} from "./form-validation";
import { capacityActionRequestSchema } from "./validation";

const consultants = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Alex",
    surname: "Smith",
    email: "alex.one@example.com",
    level: "Consultant",
    role: "Strategy",
    skills: [],
    workingCapacity: 100,
    archivedAt: null,
    linkedToUser: false,
    isCurrentUser: false,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Alex",
    surname: "Jones",
    email: "alex.two@example.com",
    level: "Senior",
    role: "Data",
    skills: [],
    workingCapacity: 80,
    archivedAt: null,
    linkedToUser: false,
    isCurrentUser: false,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  },
];

const demands = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    title: "Apollo",
    client: "One",
    type: "Project",
    status: "Won",
    description: "",
    skills: [],
    startDate: null,
    endDate: null,
    requiredCapacity: 100,
    owner: null,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    title: "Apollo",
    client: "Two",
    type: "Project",
    status: "Incoming",
    description: "",
    skills: [],
    startDate: null,
    endDate: null,
    requiredCapacity: 100,
    owner: null,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  },
];

describe("Capacity Hub action validation and resolution", () => {
  test("normalizes and case-insensitively deduplicates model-supplied skills", () => {
    expect(normalizeSkills([" AI ", "ai", "Supply   Chain", ""])).toEqual(["AI", "Supply Chain"]);
  });

  test("preserves current consultant and demand form validation semantics", () => {
    expect(validateConsultantForm("", "Smith", "100").error).toBe("Name and surname are required.");
    expect(validateConsultantForm("Alex", "Smith", "60.5")).toEqual({
      error: null,
      workingCapacity: 60.5,
    });
    expect(parseDemandRequiredCapacity("not-a-number")).toBe(0);
    expect(parseDemandRequiredCapacity("1200")).toBe(1000);
    expect(validateDemandForm("Alpha", "2026-09-20", "2026-09-19")).toBe(
      "End date cannot be before start date.",
    );
  });

  test("preserves inclusive availability overlap validation", () => {
    const existing = [{ startDate: "2026-09-10", endDate: "2026-09-20" }];
    expect(validateAvailabilityBlockForm("2026-09-20", "2026-09-21", existing)).toBe(
      "This overlaps an existing unavailable period.",
    );
    expect(validateAvailabilityBlockForm("2026-09-21", "2026-09-22", existing)).toBeNull();
  });

  test("applies current UI defaults to demand creation", () => {
    const parsed = capacityActionRequestSchema.parse({
      mode: "preview",
      asOfDate: "2026-09-15",
      action: { kind: "createDemand", demand: { title: "New demand" } },
    });
    expect(parsed.action.demand).toMatchObject({
      client: "",
      type: "Project",
      status: "Incoming",
      requiredCapacity: 100,
      owner: null,
    });
  });

  test("rejects invalid dates, arbitrary fields and non-step allocations", () => {
    expect(
      capacityActionRequestSchema.safeParse({
        mode: "preview",
        asOfDate: "2026-02-30",
        action: { kind: "removeAllocation", consultant: { name: "Alex" }, demand: { title: "A" } },
      }).success,
    ).toBe(false);
    expect(
      capacityActionRequestSchema.safeParse({
        mode: "preview",
        asOfDate: "2026-09-15",
        action: {
          kind: "addAvailabilityBlock",
          consultant: { name: "Alex" },
          startDate: "2026-09-25",
          endDate: "2026-09-21",
        },
      }).success,
    ).toBe(false);
    expect(
      capacityActionRequestSchema.safeParse({
        mode: "preview",
        asOfDate: "2026-09-15",
        action: {
          kind: "setAllocation",
          consultant: { name: "Alex Smith" },
          demand: { title: "Apollo", client: "One" },
          capacity: 17,
          sql: "select 1",
        },
      }).success,
    ).toBe(false);
  });

  test("confirmation schema never accepts a returned preview as authority", () => {
    expect(
      capacityActionRequestSchema.safeParse({
        mode: "confirm",
        confirmed: true,
        asOfDate: "2026-09-15",
        previewId: "a".repeat(64),
        action: {
          kind: "updateConsultant",
          consultant: { name: "Alex Smith" },
          patch: { role: "Data" },
        },
        preview: { action: { consultantId: "invented" } },
      }).success,
    ).toBe(false);
  });

  test("ambiguous consultant and demand names return candidates", () => {
    for (const resolve of [
      () => resolveConsultant({ name: "Alex" }, consultants),
      () => resolveDemand({ title: "Apollo" }, demands),
    ]) {
      try {
        resolve();
        throw new Error("expected ambiguity");
      } catch (error) {
        expect(error).toBeInstanceOf(CapacityActionFailure);
        expect(error.detail.code).toBe("AMBIGUOUS_REFERENCE");
        expect(error.detail.candidates).toHaveLength(2);
      }
    }
  });

  test("client and full name resolve ambiguity deterministically", () => {
    expect(resolveConsultant({ name: "Alex Smith" }, consultants).id).toBe(consultants[0].id);
    expect(resolveDemand({ title: "Apollo", client: "Two" }, demands).id).toBe(demands[1].id);
  });
});
