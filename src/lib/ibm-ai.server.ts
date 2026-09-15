const IBM_RESPONSES_URL = "https://api.servicesessentials.ibm.com/v1/responses";
const IBM_SMOKE_MODEL = "gpt-5.6-luna";
const EXPECTED_OUTPUT = "ICA_OK";
const REQUEST_TIMEOUT_MS = 30_000;

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
