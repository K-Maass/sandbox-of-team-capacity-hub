// @ts-expect-error -- Bun provides this module at test runtime; app builds do not include Bun types.
import { afterEach, describe, expect, test } from "bun:test";

import { IbmAiRequestError, runIbmFunctionCall, type IbmFunctionTool } from "./ibm-ai.server";

const originalFetch = globalThis.fetch;
const originalKey = process.env["IBM_SERVICES_API_KEY"];
const tools: IbmFunctionTool[] = [
  {
    type: "function",
    name: "test_action",
    description: "Test",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
];

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env["IBM_SERVICES_API_KEY"];
  else process.env["IBM_SERVICES_API_KEY"] = originalKey;
});

function request(options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
  return runIbmFunctionCall({ instructions: "Test", input: "Test", tools, ...options });
}

describe("IBM Responses function-call adapter", () => {
  test("requires the server-side credential", async () => {
    delete process.env["IBM_SERVICES_API_KEY"];
    expect(request()).rejects.toMatchObject({ code: "not_configured" });
  });

  test("accepts exactly one valid function call and ignores reasoning items", async () => {
    process.env["IBM_SERVICES_API_KEY"] = "configured-for-test";
    globalThis.fetch = async () =>
      Response.json({
        status: "completed",
        model: "gpt-5.6-luna",
        output: [
          { type: "reasoning" },
          { type: "function_call", name: "test_action", arguments: "{}" },
        ],
      });
    await expect(request()).resolves.toEqual({ name: "test_action", arguments: "{}" });
  });

  test("rejects provider failure and malformed or multiple calls", async () => {
    process.env["IBM_SERVICES_API_KEY"] = "configured-for-test";
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await expect(request()).rejects.toMatchObject({ code: "provider_unavailable" });

    globalThis.fetch = async () =>
      Response.json({ status: "completed", model: "gpt-5.6-luna", output: [] });
    await expect(request()).rejects.toMatchObject({ code: "invalid_response" });

    globalThis.fetch = async () =>
      Response.json({
        status: "completed",
        model: "gpt-5.6-luna",
        output: [
          { type: "function_call", name: "one", arguments: "{}" },
          { type: "function_call", name: "two", arguments: "{}" },
        ],
      });
    await expect(request()).rejects.toMatchObject({ code: "invalid_response" });
  });

  test("distinguishes cancellation and timeout", async () => {
    process.env["IBM_SERVICES_API_KEY"] = "configured-for-test";
    globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    const controller = new AbortController();
    controller.abort();
    await expect(request({ signal: controller.signal })).rejects.toMatchObject({
      code: "cancelled",
    });
    await expect(request({ timeoutMs: 5 })).rejects.toMatchObject({ code: "timeout" });
  });

  test("does not expose the credential in adapter errors", () => {
    expect(new IbmAiRequestError("provider_unavailable").message).toBe("provider_unavailable");
  });
});
