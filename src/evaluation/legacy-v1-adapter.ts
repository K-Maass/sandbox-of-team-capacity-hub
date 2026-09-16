import { interpretCapacityMessage } from "@/server/capacity/assistant-interpreter.server";
import type { CapacityEvalCase } from "./capacity-corpus";
import type { EvalActual, EvalConversationState } from "./evaluator";

export type LegacyV1AdapterInput = {
  testCase: CapacityEvalCase;
  state: EvalConversationState;
  boundedContext: {
    scope?: string;
    consultantLabel?: string;
    demandLabel?: string;
    range?: { startDate: string; endDate: string; label?: string };
    includePipeline?: boolean;
    focus?: string;
  };
  pendingClarification?: { field: string; requestedValues?: Record<string, unknown> };
};

export type LegacyV1Interpreter = (message: string, currentDate: string) => Promise<unknown>;

function boundedString(value: string | undefined, max = 200): string | undefined {
  return value?.slice(0, max);
}

export function toLegacyV1AdapterInput(
  testCase: CapacityEvalCase,
  state: EvalConversationState,
): LegacyV1AdapterInput {
  const context = state.safeConversationContext;
  return {
    testCase,
    state,
    boundedContext: {
      scope: context?.scope,
      consultantLabel: boundedString(context?.consultantLabel),
      demandLabel: boundedString(context?.demandLabel),
      range: context?.range,
      includePipeline: context?.includePipeline,
      focus: boundedString(context?.focus, 80),
    },
    // Authoritative candidate labels deliberately do not cross the adapter boundary.
    pendingClarification: state.pendingClarification
      ? {
          field: state.pendingClarification.field,
          requestedValues: state.pendingClarification.requestedValues,
        }
      : undefined,
  };
}

export function createLegacyV1Adapter(
  interpreter: LegacyV1Interpreter = (message, currentDate) =>
    interpretCapacityMessage(message, currentDate),
): (input: LegacyV1AdapterInput) => Promise<EvalActual> {
  return async (input) => {
    const intent = await interpreter(input.testCase.userMessage, "2026-09-15");
    const futureOutcome = ["CLARIFICATION", "CONVERSATION_OR_HELP", "MULTIPLE_CHANGES"].includes(
      input.testCase.expectedOutcome,
    );
    return {
      intent,
      providerResult: {
        provider: "IBM Responses",
        tool: "legacy-v1-interpreter",
        raw: {
          adapter: "legacy-v1",
          boundedContext: input.boundedContext,
          pendingClarification: input.pendingClarification,
          adapterLimitation: futureOutcome
            ? "Legacy V1 cannot emit this typed future outcome reliably; result is reported as an adapter limitation."
            : undefined,
        },
      },
    };
  };
}
