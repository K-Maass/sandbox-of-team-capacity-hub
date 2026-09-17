import { afterEach, describe, expect, it } from "bun:test";

import { isHostedProductionRequest } from "./capacity";

const originalVercel = process.env["VERCEL"];
const originalVercelEnv = process.env["VERCEL_ENV"];
const originalHostedFlag = process.env["CAPACITY_AI_HOSTED"];

afterEach(() => {
  if (originalVercel === undefined) delete process.env["VERCEL"];
  else process.env["VERCEL"] = originalVercel;
  if (originalVercelEnv === undefined) delete process.env["VERCEL_ENV"];
  else process.env["VERCEL_ENV"] = originalVercelEnv;
  if (originalHostedFlag === undefined) delete process.env["CAPACITY_AI_HOSTED"];
  else process.env["CAPACITY_AI_HOSTED"] = originalHostedFlag;
});

describe("hosted Capacity Assistant runtime gate", () => {
  it("allows only an explicitly enabled Vercel production request", () => {
    process.env["VERCEL"] = "1";
    process.env["VERCEL_ENV"] = "production";
    process.env["CAPACITY_AI_HOSTED"] = "true";

    expect(isHostedProductionRequest(new Request("https://capacity.example/api/ai/capacity"))).toBe(
      true,
    );
  });

  it("rejects preview deployments and disabled hosted runtimes", () => {
    process.env["VERCEL"] = "1";
    process.env["VERCEL_ENV"] = "preview";
    process.env["CAPACITY_AI_HOSTED"] = "true";
    expect(isHostedProductionRequest(new Request("https://capacity.example/api/ai/capacity"))).toBe(
      false,
    );

    process.env["VERCEL_ENV"] = "production";
    process.env["CAPACITY_AI_HOSTED"] = "false";
    expect(isHostedProductionRequest(new Request("https://capacity.example/api/ai/capacity"))).toBe(
      false,
    );
  });

  it("does not treat loopback requests as hosted production requests", () => {
    process.env["VERCEL"] = "1";
    process.env["VERCEL_ENV"] = "production";
    process.env["CAPACITY_AI_HOSTED"] = "true";

    expect(isHostedProductionRequest(new Request("http://127.0.0.1/api/ai/capacity"))).toBe(false);
  });
});
