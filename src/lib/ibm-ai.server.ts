const IBM_RESPONSES_URL = "https://api.servicesessentials.ibm.com/v1/responses";
const IBM_SMOKE_MODEL = "gpt-5.6-luna";
const EXPECTED_OUTPUT = "ICA_OK";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PROVIDER_BODY_BYTES = 512 * 1024;

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
  "cancelled" | "invalid_response" | "not_configured" | "provider_unavailable" | "timeout";

export class IbmAiRequestError extends Error {
  readonly code: IbmAiRequestErrorCode;

  constructor(code: IbmAiRequestErrorCode) {
    super(code);
    this.name = "IbmAiRequestError";
    this.code = code;
  }
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
  const apiKey = process.env["IBM_SERVICES_API_KEY"];
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
  if (declaredLength > MAX_PROVIDER_BODY_BYTES) {
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
      if (total > MAX_PROVIDER_BODY_BYTES) {
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

export async function runIbmFunctionCall(options: {
  instructions: string;
  input: string;
  tools: IbmFunctionTool[];
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<IbmFunctionCall> {
  const apiKey = process.env["IBM_SERVICES_API_KEY"];
  if (!apiKey) throw new IbmAiRequestError("not_configured");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort("timeout"),
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
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
  } catch {
    cleanup();
    if (controller.signal.reason === "cancelled") throw new IbmAiRequestError("cancelled");
    if (controller.signal.reason === "timeout") throw new IbmAiRequestError("timeout");
    throw new IbmAiRequestError("provider_unavailable");
  }
  try {
    if (!response.ok) {
      await response.body?.cancel();
      throw new IbmAiRequestError("provider_unavailable");
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
      calls[0].arguments.length > 16_384
    ) {
      throw new IbmAiRequestError("invalid_response");
    }

    return { name: calls[0].name, arguments: calls[0].arguments };
  } finally {
    cleanup();
  }
}
