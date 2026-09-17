import {
  CAPACITY_ASSISTANT_TOOLS_V2,
  parseSemanticToolCall,
} from "@/server/capacity/assistant-tools.server";
import { runIbmFunctionCall, type IbmFunctionCall } from "@/lib/ibm-ai.server";
import { buildCapacityAssistantPrompt } from "@/server/capacity/assistant-prompt.server";
import type { SemanticOutcome } from "@/domain/capacity/assistant-semantic";
import { preProviderSecurityReason } from "@/server/capacity/pre-provider-security.server";
import type { CapacityEvalCase } from "./capacity-corpus";
import type { EvalActual, EvalConversationState } from "./evaluator";

export type StateAwareProviderRequest = {
  testCase: CapacityEvalCase;
  state: EvalConversationState;
};

export type FunctionCallRunner = (options: {
  instructions: string;
  input: string;
  tools: typeof CAPACITY_ASSISTANT_TOOLS_V2;
}) => Promise<IbmFunctionCall>;

function safeSemanticValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(value))
      return undefined;
    if (
      /(bearer\s+|api[_ -]?key\s*[:=]|service[-_ ]?role\s*key\s*[:=]|password\s*[:=]|secret\s*[:=])/i.test(
        value,
      )
    )
      return undefined;
    return value.slice(0, 200);
  }
  if (Array.isArray(value)) return value.map((item) => safeSemanticValue(item, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/(^id$|id$|token|secret|password|credential)/i.test(key)) continue;
      const safe = safeSemanticValue(item, depth + 1);
      if (safe !== undefined) output[key] = safe;
    }
    return output;
  }
  return undefined;
}

export function boundedSafeProviderFacts(state: EvalConversationState): Record<string, unknown> {
  const context = state.safeConversationContext;
  const safeConsultantLabel = safeSemanticValue(context?.consultantLabel);
  const safeDemandLabel = safeSemanticValue(context?.demandLabel);
  return {
    safeConversationContext: context
      ? {
          scope: context.scope,
          consultantLabel:
            typeof safeConsultantLabel === "string" ? safeConsultantLabel : undefined,
          demandLabel: typeof safeDemandLabel === "string" ? safeDemandLabel : undefined,
          range: safeSemanticValue(context.range),
          includePipeline: context.includePipeline,
          focus: context.focus?.slice(0, 80),
        }
      : undefined,
    pendingClarification: state.pendingClarification
      ? {
          field: state.pendingClarification.field,
          requestedValues: safeSemanticValue(state.pendingClarification.requestedValues),
        }
      : undefined,
  };
}

export function createStateAwareProviderAdapter(
  runFunctionCall: FunctionCallRunner = runIbmFunctionCall,
): (request: StateAwareProviderRequest) => Promise<EvalActual> {
  return async ({ testCase, state }) => {
    const safeFacts = boundedSafeProviderFacts(state);
    const guarded = preProviderSecurityReason(testCase.userMessage);
    if (guarded) {
      return {
        semanticActual: {
          outcome: "UNSUPPORTED",
          intentFamily: "unsupported",
          importantArguments: { reason: guarded },
        },
        providerResult: {
          provider: "pre-provider-security",
          tool: "pre-provider-security",
          raw: { guarded: true },
        },
      };
    }
    const instructions = buildCapacityAssistantPrompt({
      currentDate: "2026-09-15",
      context: {
        scope: state.safeConversationContext?.scope,
        lastConsultant: state.safeConversationContext?.consultantLabel
          ? { label: state.safeConversationContext.consultantLabel }
          : undefined,
        lastDemand: state.safeConversationContext?.demandLabel
          ? { label: state.safeConversationContext.demandLabel }
          : undefined,
        lastRange: state.safeConversationContext?.range,
        includePipeline: state.safeConversationContext?.includePipeline,
        lastFocus: state.safeConversationContext?.focus,
      },
      pendingClarification: state.pendingClarification,
    });
    let call: IbmFunctionCall;
    try {
      call = await runFunctionCall({
        instructions,
        input: testCase.userMessage,
        tools: CAPACITY_ASSISTANT_TOOLS_V2,
      });
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        providerResult: {
          provider: "IBM Responses",
          raw: { adapter: "state-aware-provider-v2", safeFacts },
        },
      };
    }

    let outcome: SemanticOutcome;
    try {
      outcome = parseSemanticToolCall(call.name, call.arguments);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        providerResult: {
          provider: "IBM Responses",
          tool: call.name,
          raw: { adapter: "state-aware-provider-v2", arguments: call.arguments, safeFacts },
        },
      };
    }
    return {
      intent: outcome,
      providerResult: {
        provider: "IBM Responses",
        tool: call.name,
        raw: { adapter: "state-aware-provider-v2", arguments: call.arguments, safeFacts },
      },
    };
  };
}
