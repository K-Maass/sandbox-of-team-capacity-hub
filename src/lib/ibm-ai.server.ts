const IBM_RESPONSES_URL = "https://api.servicesessentials.ibm.com/v1/responses";
const IBM_SMOKE_MODEL = "gpt-5.6-luna";
const EXPECTED_OUTPUT = "ICA_OK";
import { CAPACITY_ASSISTANT_BOUNDS } from "@/server/capacity/bounds.server";

export type IbmAiSmokeErrorCode =
  "invalid_response" | "not_configured" | "provider_unavailable" | "timeout";

export class IbmAiSmokeError extends Error {
  readonly code: IbmAiSmokeErrorCode;

  constructor(code: IbmAiSmokeErrorCode) {
    super(code);
    this.name = "IbmAiSmokeError";
    this.code = code;
  }
}

export type IbmFunctionTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: true;
};

export type IbmFunctionCall = { name: string; arguments: string };

export type IbmAiRequestErrorCode =
  | "cancelled"
  | "invalid_request"
  | "invalid_response"
  | "not_configured"
  | "provider_unavailable"
  | "timeout";

export type IbmAiRequestDiagnostics = {
  httpStatus?: number;
  providerErrorCode?: string;
  providerErrorDetail?: string;
};

export class IbmAiRequestError extends Error {
  readonly code: IbmAiRequestErrorCode;
  readonly diagnostics?: IbmAiRequestDiagnostics;

  constructor(code: IbmAiRequestErrorCode, diagnostics?: IbmAiRequestDiagnostics) {
    super(code);
    this.name = "IbmAiRequestError";
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

function getIbmServicesApiKey(): string | undefined {
  const raw = process.env["IBM_SERVICES_API_KEY"];
  if (!raw) return undefined;

  // Vercel env values are sometimes pasted with surrounding typographic/ASCII quotes.
  // Strip only boundary quote characters and whitespace; never alter the token body.
  const cleaned = raw.trim().replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, "");
  return cleaned || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractOutputText(payload: unknown): string | null {
  if (!isRecord(payload) || payload.status !== "completed" || !Array.isArray(payload.output)) {
    return null;
  }

  const textParts: string[] = [];

  for (const outputItem of payload.output) {
    if (!isRecord(outputItem) || outputItem.type !== "message") continue;
    if (!Array.isArray(outputItem.content)) continue;

    for (const contentItem of outputItem.content) {
      if (!isRecord(contentItem) || contentItem.type !== "output_text") continue;
      if (typeof contentItem.text === "string") textParts.push(contentItem.text);
    }
  }

  return textParts.length ? textParts.join("").trim() : null;
}

export async function runIbmAiSmoke(): Promise<typeof EXPECTED_OUTPUT> {
  const apiKey = getIbmServicesApiKey();
  if (!apiKey) throw new IbmAiSmokeError("not_configured");

  let response: Response;

  try {
    response = await fetch(IBM_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: IBM_SMOKE_MODEL,
        input: "Reply with exactly ICA_OK and no other text.",
        max_output_tokens: 256,
        store: false,
      }),
      signal: AbortSignal.timeout(CAPACITY_ASSISTANT_BOUNDS.providerTimeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new IbmAiSmokeError("timeout");
    }
    throw new IbmAiSmokeError("provider_unavailable");
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new IbmAiSmokeError("provider_unavailable");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new IbmAiSmokeError("invalid_response");
  }

  if (!isRecord(payload) || payload.model !== IBM_SMOKE_MODEL) {
    throw new IbmAiSmokeError("invalid_response");
  }

  const output = extractOutputText(payload);
  if (output !== EXPECTED_OUTPUT) throw new IbmAiSmokeError("invalid_response");

  return EXPECTED_OUTPUT;
}

async function readLimitedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > CAPACITY_ASSISTANT_BOUNDS.maxProviderResponseBytes) {
    await response.body?.cancel();
    throw new IbmAiRequestError("invalid_response");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > CAPACITY_ASSISTANT_BOUNDS.maxProviderResponseBytes) {
        await reader.cancel();
        throw new IbmAiRequestError("invalid_response");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

const MAX_PROVIDER_ERROR_DETAIL_CHARS = 512;
const DIAGNOSTIC_CREDENTIAL_LABEL =
  "(?:api[_ -]?key|access[_ -]?token|service[_ -]?role(?:[_ -]?key)?|authorization|password|secret|token|jwt)";
const DIAGNOSTIC_CREDENTIAL_ASSIGNMENT = new RegExp(
  `['"]?\\b${DIAGNOSTIC_CREDENTIAL_LABEL}['"]?\\s*[:=]\\s*['"]?[^,;\\s}"']+`,
  "gi",
);
const DIAGNOSTIC_CREDENTIAL_LITERAL = new RegExp(
  `\\b${DIAGNOSTIC_CREDENTIAL_LABEL}\\b\\s+(?:is\\s+[A-Za-z0-9._~+/=-]{8,}\\b|(?=[A-Za-z0-9._~+/=-]{8,}\\b)(?=[A-Za-z0-9._~+/=-]*[-_.~+/=0-9])[A-Za-z0-9._~+/=-]{8,}\\b)`,
  "gi",
);
const DIAGNOSTIC_JWT = /\b[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;

function sanitizeProviderDiagnosticText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const sanitized = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, "Bearer [REDACTED]")
    .replace(DIAGNOSTIC_CREDENTIAL_ASSIGNMENT, "credential=[REDACTED]")
    .replace(DIAGNOSTIC_CREDENTIAL_LITERAL, "credential=[REDACTED]")
    .replace(DIAGNOSTIC_JWT, "[REDACTED]")
    .replace(/\b(?:sk|gh[pousr]|xox[baprs])[-_][A-Za-z0-9_-]{10,}\b/gi, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();

  return sanitized.length > 0 ? sanitized.slice(0, MAX_PROVIDER_ERROR_DETAIL_CHARS) : undefined;
}

function sanitizeProviderErrorCode(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]{1,100}$/.test(value)) return undefined;
  return value;
}

function embeddedProviderErrorCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(/"code"\s*:\s*"([A-Za-z0-9_.-]{1,100})"/);
  return match?.[1];
}

function networkErrorDiagnostics(error: unknown): IbmAiRequestDiagnostics {
  const parts: string[] = [];
  let providerErrorCode: string | undefined;

  if (error instanceof Error) {
    const message = sanitizeProviderDiagnosticText(`${error.name}: ${error.message}`);
    if (message) parts.push(message);

    const cause = (error as Error & { cause?: unknown }).cause;
    if (isRecord(cause)) {
      providerErrorCode = sanitizeProviderErrorCode(cause["code"]);
      const causeMessage = sanitizeProviderDiagnosticText(cause["message"]);
      if (causeMessage) parts.push(`cause=${causeMessage}`);
    } else if (cause instanceof Error) {
      const causeMessage = sanitizeProviderDiagnosticText(`${cause.name}: ${cause.message}`);
      if (causeMessage) parts.push(`cause=${causeMessage}`);
    }
  } else {
    const detail = sanitizeProviderDiagnosticText(String(error));
    if (detail) parts.push(detail);
  }

  return {
    providerErrorCode,
    providerErrorDetail: parts.length ? parts.join("; ") : "Fetch failed before an HTTP response was received.",
  };
}


function providerErrorDiagnostics(httpStatus: number, body: string): IbmAiRequestDiagnostics {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      httpStatus,
      providerErrorDetail: sanitizeProviderDiagnosticText(body),
    };
  }

  const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : undefined;
  const providerErrorCode =
    embeddedProviderErrorCode(error?.message) ?? sanitizeProviderErrorCode(error?.code);
  const message = sanitizeProviderDiagnosticText(error?.message ?? error?.detail);
  const parameter = sanitizeProviderDiagnosticText(error?.param);
  const providerErrorDetail = [message, parameter ? `param=${parameter}` : undefined]
    .filter((part): part is string => part !== undefined)
    .join("; ");

  return {
    httpStatus,
    providerErrorCode,
    providerErrorDetail: providerErrorDetail || sanitizeProviderDiagnosticText(body),
  };
}

async function readProviderErrorDiagnostics(response: Response): Promise<IbmAiRequestDiagnostics> {
  try {
    return providerErrorDiagnostics(response.status, await readLimitedText(response));
  } catch {
    await response.body?.cancel();
    return {
      httpStatus: response.status,
      providerErrorDetail: "Provider error body was unavailable or exceeded the diagnostic limit.",
    };
  }
}

function classifyProviderHttpStatus(status: number): IbmAiRequestErrorCode {
  return status >= 400 && status < 500 ? "invalid_request" : "provider_unavailable";
}

export async function runIbmFunctionCall(options: {
  instructions: string;
  input: string;
  tools: IbmFunctionTool[];
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<IbmFunctionCall> {
  const apiKey = getIbmServicesApiKey();
  if (!apiKey) throw new IbmAiRequestError("not_configured");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort("timeout"),
    options.timeoutMs ?? CAPACITY_ASSISTANT_BOUNDS.providerTimeoutMs,
  );
  const cancel = () => controller.abort("cancelled");
  const cleanup = () => {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", cancel);
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) {
    cancel();
    cleanup();
    throw new IbmAiRequestError("cancelled");
  }

  let response: Response;
  try {
    response = await fetch(IBM_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: IBM_SMOKE_MODEL,
        instructions: options.instructions,
        input: options.input,
        tools: options.tools,
        tool_choice: "required",
        parallel_tool_calls: false,
        max_output_tokens: 4096,
        store: false,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    cleanup();
    if (controller.signal.reason === "cancelled") throw new IbmAiRequestError("cancelled");
    if (controller.signal.reason === "timeout") throw new IbmAiRequestError("timeout");
    throw new IbmAiRequestError("provider_unavailable", networkErrorDiagnostics(error));
  }
  try {
    if (!response.ok) {
      const diagnostics = await readProviderErrorDiagnostics(response);
      throw new IbmAiRequestError(classifyProviderHttpStatus(response.status), diagnostics);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(await readLimitedText(response));
    } catch (error) {
      if (error instanceof IbmAiRequestError) throw error;
      if (controller.signal.reason === "cancelled") throw new IbmAiRequestError("cancelled");
      if (controller.signal.reason === "timeout") throw new IbmAiRequestError("timeout");
      throw new IbmAiRequestError("invalid_response");
    }

    if (
      !isRecord(payload) ||
      payload.status !== "completed" ||
      payload.model !== IBM_SMOKE_MODEL ||
      !Array.isArray(payload.output)
    ) {
      throw new IbmAiRequestError("invalid_response");
    }

    const calls = payload.output.filter(
      (item): item is Record<string, unknown> => isRecord(item) && item.type === "function_call",
    );
    if (
      calls.length !== 1 ||
      typeof calls[0].name !== "string" ||
      typeof calls[0].arguments !== "string" ||
      calls[0].arguments.length > CAPACITY_ASSISTANT_BOUNDS.maxProviderArgumentsChars
    ) {
      throw new IbmAiRequestError("invalid_response");
    }

    return { name: calls[0].name, arguments: calls[0].arguments };
  } finally {
    cleanup();
  }
}
