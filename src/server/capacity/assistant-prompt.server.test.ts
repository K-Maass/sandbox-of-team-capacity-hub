// @ts-expect-error -- Bun provides this module at test runtime; app builds do not include Bun types.
import { describe, expect, test } from "bun:test";

import {
  buildCapacityAssistantPrompt,
  projectSafeSemanticContext,
} from "./assistant-prompt.server";

describe("Luna V2 provider prompt", () => {
  test("projects only bounded semantic context and strips IDs, rows, candidates, and secrets", () => {
    const projected = projectSafeSemanticContext({
      context: {
        scope: "consultant",
        lastConsultant: {
          id: "00000000-0000-4000-8000-000000000001",
          label: "Karim Maass",
          disambiguator: "internal row 7",
          rows: [{ id: "row-secret" }],
        },
        lastDemand: {
          id: "00000000-0000-4000-8000-000000000002",
          label: "Phoenix",
        },
        lastRange: {
          startDate: "2026-09-21",
          endDate: "2026-09-25",
          label: "next week",
        },
        includePipeline: true,
        lastFocus: "committed",
        secret: "Bearer hidden-provider-token",
        authoritativeCandidates: ["Alex Smith"],
      },
      pendingClarification: {
        field: "demand",
        knownFacts: { consultant: { kind: "name", name: "Maya" }, capacity: 50 },
        missing: ["demand", "sql"],
        requestedValues: { rows: [{ id: "00000000-0000-4000-8000-000000000003" }] },
        authoritativeCandidates: ["Phoenix / Acme"],
      },
    });

    expect(projected).toEqual({
      scope: "consultant",
      consultantLabel: "Karim Maass",
      demandLabel: "Phoenix",
      range: { startDate: "2026-09-21", endDate: "2026-09-25", label: "next week" },
      includePipeline: true,
      focus: "committed",
      pendingClarification: {
        field: "demand",
        knownFacts: { consultant: { kind: "name", name: "Maya" }, capacity: 50 },
        missing: ["demand"],
      },
    });
    expect(JSON.stringify(projected)).not.toMatch(
      /00000000-0000-4000-8000-00000000000[1-3]|Bearer|row-secret|Alex Smith|Phoenix \/ Acme|sql/i,
    );
  });

  test("builds concise instructions with the date manifest and failure-boundary examples", () => {
    const prompt = buildCapacityAssistantPrompt({
      currentDate: "2026-09-16",
      currentTime: "14:30:00+02:00",
      timeZone: "Europe/Zurich",
      context: {
        scope: "team",
        lastRange: { startDate: "2026-09-21", endDate: "2026-09-25" },
        lastFocus: "free",
      },
    });

    expect(prompt.length).toBeLessThan(20_000);
    expect(prompt).toContain("today=2026-09-16");
    expect(prompt).toContain("current_time=14:30:00+02:00");
    expect(prompt).toContain("Create Nestle in the pipeline");
    expect(prompt).toContain("What do you need to know?");
    expect(prompt).toContain("Management skills");
    expect(prompt).toContain("What's already taken?");
    expect(prompt).toContain("What about Maya?");
    expect(prompt).toContain("partial_day_availability");
    expect(prompt).toContain("history_undo_unavailable");
    expect(prompt).toContain("API Key Migration");
    expect(prompt).toContain("multiple_changes");
    expect(prompt).not.toContain("phrase-parser");
    expect(prompt).not.toContain("00000000-0000-4000-8000-000000000001");
  });

  test("does not serialize injected credentials or raw read-result data", () => {
    const prompt = buildCapacityAssistantPrompt({
      currentDate: "2026-09-16",
      context: {
        scope: "team",
        lastConsultant: {
          id: "00000000-0000-4000-8000-000000000001",
          label: "api_key=do-not-echo",
        },
        readResult: [{ id: "row-id", secret: "super-secret" }],
        candidateLabels: ["Alex Smith"],
      },
      pendingSemanticFacts: {
        knownFacts: { title: "API Key Migration" },
        rows: [{ id: "row-id" }],
      },
    });

    expect(prompt).not.toContain("do-not-echo");
    expect(prompt).not.toContain("super-secret");
    expect(prompt).not.toContain("row-id");
    expect(prompt).not.toContain("Alex Smith");
    expect(prompt).toContain("API Key Migration");
  });
});
