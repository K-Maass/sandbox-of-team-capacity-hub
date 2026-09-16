import {
  type SemanticClarification,
  type SemanticIntentFamily,
  type SemanticOutcome,
} from "@/domain/capacity/assistant-semantic";
import {
  pendingClarificationSchema,
  type PendingClarification,
} from "@/domain/capacity/assistant-clarification";
import { CAPACITY_ASSISTANT_BOUNDS } from "./bounds.server";

/**
 * Ephemeral state carried between requests. It contains only semantic hints;
 * database resolution, candidate choices, and mutation authority stay outside
 * this state and remain server-owned.
 */
export { pendingClarificationSchema } from "@/domain/capacity/assistant-clarification";
export type { PendingClarification } from "@/domain/capacity/assistant-clarification";

export type PendingClarificationParseError =
  "INVALID_PENDING_CLARIFICATION" | "PENDING_CLARIFICATION_TOO_LARGE";

export type PendingClarificationParseResult =
  | { ok: true; pending: PendingClarification | null }
  | { ok: false; error: PendingClarificationParseError };

export type PendingClarificationStateResult =
  | { ok: true; pending: PendingClarification | null }
  | { ok: false; error: PendingClarificationParseError };

function serializedBytes(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") return null;
    return new TextEncoder().encode(serialized).byteLength;
  } catch {
    return null;
  }
}

function isWithinSerializedBound(value: unknown): boolean {
  const bytes = serializedBytes(value);
  return bytes !== null && bytes <= CAPACITY_ASSISTANT_BOUNDS.maxPendingClarificationBytes;
}

/** Parse and revalidate untrusted state received on a subsequent request. */
export function parsePendingClarification(value: unknown): PendingClarificationParseResult {
  if (value === undefined || value === null) return { ok: true, pending: null };
  if (!isWithinSerializedBound(value)) {
    return { ok: false, error: "PENDING_CLARIFICATION_TOO_LARGE" };
  }
  const parsed = pendingClarificationSchema.safeParse(value);
  return parsed.success
    ? { ok: true, pending: parsed.data }
    : { ok: false, error: "INVALID_PENDING_CLARIFICATION" };
}

/** Named alias for call sites that make the trust boundary explicit. */
export const revalidatePendingClarification = parsePendingClarification;

export function createPendingClarification(
  clarification: SemanticClarification,
): PendingClarification {
  const pending = pendingClarificationSchema.parse({
    intentFamily: clarification.intentFamily,
    knownFacts: clarification.knownFacts,
    missing: clarification.missing,
    question: clarification.question,
    reason: clarification.reason,
  });
  if (!isWithinSerializedBound(pending)) {
    throw new Error("PENDING_CLARIFICATION_TOO_LARGE");
  }
  return pending;
}

/** A new semantic clarification explicitly supersedes the previous one. */
export function replacePendingClarification(
  _current: PendingClarification | null,
  clarification: SemanticClarification,
): PendingClarification {
  return createPendingClarification(clarification);
}

export const supersedePendingClarification = replacePendingClarification;

/** Conversation/help does not consume the pending clarification. */
export function retainPendingClarification(
  pending: PendingClarification | null,
): PendingClarification | null {
  return pending;
}

export function clearPendingClarification(): null {
  return null;
}

/** Clear only when the completed outcome belongs to the pending family. */
export function completePendingClarification(
  pending: PendingClarification | null,
  completedIntentFamily: SemanticIntentFamily,
): PendingClarification | null {
  return pending?.intentFamily === completedIntentFamily ? null : pending;
}

export function clearAfterCompletedRead(_pending: PendingClarification | null): null {
  return null;
}

export function clearAfterCompletedWritePreview(_pending: PendingClarification | null): null {
  return null;
}

export function clearAfterCancel(_pending: PendingClarification | null): null {
  return null;
}

export function clearAfterUnsupported(_pending: PendingClarification | null): null {
  return null;
}

export function clearAfterMultipleChanges(_pending: PendingClarification | null): null {
  return null;
}

export function clearAfterContextInvalidation(_pending: PendingClarification | null): null {
  return null;
}

/**
 * Advance already-validated state from one semantic outcome. No natural
 * language parsing occurs here, and database ambiguity selections are not an
 * event in this state machine.
 */
export function applyPendingSemanticOutcome(
  pending: PendingClarification | null,
  outcome: SemanticOutcome,
): PendingClarification | null {
  if (outcome.type === "clarification") {
    return replacePendingClarification(pending, outcome);
  }
  if (!pending) return null;
  if (outcome.type === "conversation_or_help") {
    return outcome.topic === "clarification" ? retainPendingClarification(pending) : null;
  }
  return clearPendingClarification();
}

export type PendingClarificationTransition =
  | "terminal"
  | "completed_read"
  | "completed_write_preview"
  | "cancel"
  | "unsupported"
  | "multiple_changes"
  | "context_invalidated"
  | { type: "semantic"; outcome: SemanticOutcome };

/** Revalidate and apply a typed lifecycle event at a request boundary. */
export function transitionPendingClarification(
  rawPending: unknown,
  transition: PendingClarificationTransition,
): PendingClarificationStateResult {
  const parsed = parsePendingClarification(rawPending);
  if (!parsed.ok) return parsed;
  if (transition === "terminal" || transition === "completed_read") {
    return { ok: true, pending: clearAfterCompletedRead(parsed.pending) };
  }
  if (transition === "completed_write_preview") {
    return { ok: true, pending: clearAfterCompletedWritePreview(parsed.pending) };
  }
  if (transition === "cancel") return { ok: true, pending: clearAfterCancel(parsed.pending) };
  if (transition === "unsupported") {
    return { ok: true, pending: clearAfterUnsupported(parsed.pending) };
  }
  if (transition === "multiple_changes") {
    return { ok: true, pending: clearAfterMultipleChanges(parsed.pending) };
  }
  if (transition === "context_invalidated") {
    return { ok: true, pending: clearAfterContextInvalidation(parsed.pending) };
  }
  return { ok: true, pending: applyPendingSemanticOutcome(parsed.pending, transition.outcome) };
}

/** Revalidate untrusted pending state before applying a next semantic result. */
export function reconcilePendingClarification(
  rawPending: unknown,
  outcome: SemanticOutcome,
): PendingClarificationStateResult {
  return transitionPendingClarification(rawPending, { type: "semantic", outcome });
}
