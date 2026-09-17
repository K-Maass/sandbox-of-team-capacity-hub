import type { ConversationContext } from "@/domain/capacity/assistant";
import type { PendingClarification } from "@/domain/capacity/assistant-clarification";
import { semanticOutcomeSchema, type SemanticOutcome } from "@/domain/capacity/assistant-semantic";
import type { CapacityDataSet } from "@/domain/capacity/contracts";
import {
  runIbmFunctionCall,
  IbmAiRequestError,
  type IbmFunctionCall,
  type IbmFunctionTool,
} from "@/lib/ibm-ai.server";
import {
  compileSemanticOutcome,
  type SemanticCompilerOptions,
  type SemanticCompilerOutput,
} from "./assistant-compiler.server";
import { buildCapacityAssistantPrompt } from "./assistant-prompt.server";
import { CAPACITY_ASSISTANT_TOOLS_V2, parseSemanticToolCall } from "./assistant-tools.server";
import { preProviderSecurityReason } from "./pre-provider-security.server";

export type CapacityV2FunctionCallRequest = {
  instructions: string;
  input: string;
  tools: IbmFunctionTool[];
  signal?: AbortSignal;
};

export type CapacityV2FunctionCallRunner = (
  request: CapacityV2FunctionCallRequest,
) => Promise<IbmFunctionCall>;

export type CapacityV2InterpreterOptions = {
  /** The already validated conversation context; prompt projection removes its IDs. */
  context?: ConversationContext;
  /** Safe semantic clarification state; it contains no authoritative candidates or IDs. */
  pendingClarification?: PendingClarification;
  signal?: AbortSignal;
  currentTime?: string;
  timeZone?: string;
  runFunctionCall?: CapacityV2FunctionCallRunner;
};

export type CapacityV2CompileOptions = Omit<SemanticCompilerOptions, "context"> & {
  context?: ConversationContext;
};

export type CapacityV2InterpreterErrorCode =
  | "CAPACITY_V2_PROVIDER_ERROR"
  | "CAPACITY_V2_MALFORMED_TOOL_CALL"
  | "CAPACITY_V2_UNKNOWN_TOOL_CALL"
  | "CAPACITY_V2_INVALID_SEMANTIC_OUTCOME";

/** Errors at the V2 provider boundary are explicit and never trigger V1 fallback. */
export class CapacityV2InterpreterError extends Error {
  readonly code: CapacityV2InterpreterErrorCode;
  readonly providerCode?: import("@/lib/ibm-ai.server").IbmAiRequestErrorCode;
  readonly providerDiagnostics?: import("@/lib/ibm-ai.server").IbmAiRequestDiagnostics;

  constructor(
    code: CapacityV2InterpreterErrorCode,
    providerCode?: import("@/lib/ibm-ai.server").IbmAiRequestErrorCode,
    providerDiagnostics?: import("@/lib/ibm-ai.server").IbmAiRequestDiagnostics,
  ) {
    super(code);
    this.name = "CapacityV2InterpreterError";
    this.code = code;
    this.providerCode = providerCode;
    this.providerDiagnostics = providerDiagnostics;
  }
}

const defaultFunctionCallRunner: CapacityV2FunctionCallRunner = (request) =>
  runIbmFunctionCall(request);

function isFunctionCall(value: unknown): value is IbmFunctionCall {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as IbmFunctionCall).name === "string" &&
    typeof (value as IbmFunctionCall).arguments === "string"
  );
}

function parserErrorCode(error: unknown): CapacityV2InterpreterErrorCode {
  return error instanceof Error && error.message === "UNKNOWN_SEMANTIC_TOOL"
    ? "CAPACITY_V2_UNKNOWN_TOOL_CALL"
    : "CAPACITY_V2_INVALID_SEMANTIC_OUTCOME";
}

function isInterpreterOptions(value: unknown): value is CapacityV2InterpreterOptions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return [
    "context",
    "pendingClarification",
    "signal",
    "currentTime",
    "timeZone",
    "runFunctionCall",
    "data",
    "currentUserConsultantId",
  ].some((key) => key in record);
}

/**
 * Interpret one message through the Luna V2 semantic tool. It produces
 * semantic meaning only and never reads, resolves, previews, confirms, or
 * mutates Capacity Hub data.
 */
export function interpretCapacityMessageV2(
  message: string,
  currentDate: string,
  options?: CapacityV2InterpreterOptions,
): Promise<SemanticOutcome>;
export function interpretCapacityMessageV2(
  message: string,
  currentDate: string,
  context?: ConversationContext,
  pendingClarification?: PendingClarification,
  signal?: AbortSignal,
  runFunctionCall?: CapacityV2FunctionCallRunner,
): Promise<SemanticOutcome>;
export async function interpretCapacityMessageV2(
  message: string,
  currentDate: string,
  optionsOrContext: CapacityV2InterpreterOptions | ConversationContext = {},
  pendingClarification?: PendingClarification,
  signal?: AbortSignal,
  positionalRunner?: CapacityV2FunctionCallRunner,
): Promise<SemanticOutcome> {
  if (preProviderSecurityReason(message)) {
    return semanticOutcomeSchema.parse({ type: "unsupported", reason: "security_request" });
  }

  const options: CapacityV2InterpreterOptions = isInterpreterOptions(optionsOrContext)
    ? optionsOrContext
    : {
        context: optionsOrContext,
        pendingClarification,
        signal,
        runFunctionCall: positionalRunner,
      };
  const instructions = buildCapacityAssistantPrompt({
    currentDate,
    currentTime: options.currentTime,
    timeZone: options.timeZone,
    context: options.context,
    pendingClarification: options.pendingClarification,
  });
  const runFunctionCall = options.runFunctionCall ?? defaultFunctionCallRunner;

  let call: IbmFunctionCall;
  try {
    call = await runFunctionCall({
      instructions,
      input: message,
      tools: CAPACITY_ASSISTANT_TOOLS_V2,
      signal: options.signal,
    });
  } catch (error) {
    throw new CapacityV2InterpreterError(
      "CAPACITY_V2_PROVIDER_ERROR",
      error instanceof IbmAiRequestError ? error.code : undefined,
      error instanceof IbmAiRequestError ? error.diagnostics : undefined,
    );
  }

  if (!isFunctionCall(call)) {
    throw new CapacityV2InterpreterError("CAPACITY_V2_MALFORMED_TOOL_CALL");
  }

  try {
    return parseSemanticToolCall(call.name, call.arguments);
  } catch (error) {
    throw new CapacityV2InterpreterError(parserErrorCode(error));
  }
}

/** Compile semantic meaning against authoritative, server-loaded data only. */
export function compileCapacityMessageV2(
  outcome: SemanticOutcome,
  options: CapacityV2CompileOptions,
): SemanticCompilerOutput {
  return compileSemanticOutcome(outcome, options);
}

/** Convenience adapter: V2 interpretation followed by deterministic compilation. */
export async function interpretAndCompileCapacityMessageV2(
  message: string,
  options: CapacityV2InterpreterOptions & {
    data: CapacityDataSet;
    currentUserConsultantId: string;
    currentDate: string;
  },
): Promise<SemanticCompilerOutput> {
  const outcome = await interpretCapacityMessageV2(message, options.currentDate, options);
  return compileCapacityMessageV2(outcome, {
    data: options.data,
    currentUserConsultantId: options.currentUserConsultantId,
    currentDate: options.currentDate,
    context: options.context,
  });
}
