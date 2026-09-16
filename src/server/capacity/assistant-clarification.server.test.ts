// @ts-expect-error -- Bun provides this module at test runtime; app builds do not include Bun types.
import { describe, expect, test } from "bun:test";

import {
  semanticOutcomeSchema,
  type SemanticClarification,
} from "@/domain/capacity/assistant-semantic";
import {
  applyPendingSemanticOutcome,
  clearAfterCancel,
  clearAfterCompletedRead,
  clearAfterCompletedWritePreview,
  clearAfterContextInvalidation,
  clearAfterMultipleChanges,
  clearAfterUnsupported,
  completePendingClarification,
  createPendingClarification,
  parsePendingClarification,
  reconcilePendingClarification,
  replacePendingClarification,
} from "./assistant-clarification.server";

const annaClarification: SemanticClarification = {
  type: "clarification",
  intentFamily: "create_consultant",
  knownFacts: { name: "Anna" },
  missing: ["surname", "level", "role"],
  question: "What surname, level, and role should Anna have?",
  reason: "A consultant needs the remaining profile fields before creation.",
};

const phoenixClarification: SemanticClarification = {
  type: "clarification",
  intentFamily: "staffing_candidates",
  knownFacts: { demand: { kind: "name", name: "Phoenix" } },
  missing: ["date"],
  question: "Which date should I use for Phoenix?",
  reason: "Staffing candidates need a point date.",
};

function semanticOutcome(value: unknown) {
  return semanticOutcomeSchema.parse(value);
}

describe("ephemeral pending clarification state", () => {
  test("Anna clarification completes and clears within the same pending family", () => {
    const pending = createPendingClarification(annaClarification);
    expect(pending).not.toHaveProperty("type");
    const completed = semanticOutcome({
      type: "write",
      action: {
        kind: "createConsultant",
        consultant: { name: "Anna", surname: "Jones", level: "Senior", role: "Data" },
      },
    });

    expect(completePendingClarification(pending, "create_consultant")).toBeNull();
    expect(applyPendingSemanticOutcome(pending, completed)).toBeNull();
  });

  test("clarification help retains the pending state", () => {
    const pending = createPendingClarification(annaClarification);
    const help = semanticOutcome({ type: "conversation_or_help", topic: "clarification" });

    expect(applyPendingSemanticOutcome(pending, help)).toEqual(pending);
    expect(reconcilePendingClarification(JSON.parse(JSON.stringify(pending)), help)).toEqual({
      ok: true,
      pending,
    });
  });

  test("a new clarification creates state and unrelated conversation clears it", () => {
    const created = reconcilePendingClarification(null, annaClarification);
    expect(created).toEqual({
      ok: true,
      pending: createPendingClarification(annaClarification),
    });

    const unrelated = semanticOutcome({ type: "conversation_or_help", topic: "howToUse" });
    expect(
      reconcilePendingClarification(createPendingClarification(annaClarification), unrelated),
    ).toEqual({ ok: true, pending: null });
  });

  test("an unrelated Karim read clears Anna pending state", () => {
    const pending = createPendingClarification(annaClarification);
    const read = semanticOutcome({
      type: "read",
      action: { kind: "getConsultant", consultant: { kind: "name", name: "Karim" } },
    });

    expect(applyPendingSemanticOutcome(pending, read)).toBeNull();
  });

  test("Phoenix semantic facts remain separate from ambiguity candidate selection", () => {
    const pending = createPendingClarification(phoenixClarification);
    expect(pending.knownFacts).toEqual({ demand: { kind: "name", name: "Phoenix" } });
    expect(parsePendingClarification({ ...pending, candidates: [{ id: "candidate" }] }).ok).toBe(
      false,
    );
    expect(JSON.stringify(pending)).not.toContain('"candidates"');
  });

  test("cancellation, invalid context, unsupported, and multiple changes clear state", () => {
    const pending = createPendingClarification(annaClarification);
    expect(clearAfterCancel(pending)).toBeNull();
    expect(clearAfterContextInvalidation(pending)).toBeNull();
    expect(clearAfterUnsupported(pending)).toBeNull();
    expect(clearAfterMultipleChanges(pending)).toBeNull();
    expect(clearAfterCompletedRead(pending)).toBeNull();
    expect(clearAfterCompletedWritePreview(pending)).toBeNull();
    expect(pending).toBeDefined();
  });

  test("a new clarification replaces the old one", () => {
    const first = createPendingClarification(annaClarification);
    const second = replacePendingClarification(first, phoenixClarification);

    expect(second).toEqual(createPendingClarification(phoenixClarification));
    expect(second).not.toEqual(first);
  });

  test("tampered, oversized, and ID-bearing state is rejected", () => {
    const pending = createPendingClarification(annaClarification);
    expect(parsePendingClarification({ ...pending, previewId: "a".repeat(64) })).toEqual({
      ok: false,
      error: "INVALID_PENDING_CLARIFICATION",
    });
    expect(
      parsePendingClarification({
        ...pending,
        reason: "x".repeat(20_000),
      }),
    ).toEqual({ ok: false, error: "PENDING_CLARIFICATION_TOO_LARGE" });
    expect(
      parsePendingClarification({
        ...pending,
        knownFacts: { name: "00000000-0000-4000-8000-000000000001" },
      }).ok,
    ).toBe(false);
    expect(
      parsePendingClarification({
        ...pending,
        knownFacts: { rows: [] },
      }).ok,
    ).toBe(false);
  });
});
