// @ts-expect-error -- Bun provides this module at test runtime; app builds do not include Bun types.
import { expect, test } from "bun:test";

import { CAPACITY_ASSISTANT_BOUNDS } from "./bounds.server";

test("assistant limits are centralized and bounded", () => {
  expect(CAPACITY_ASSISTANT_BOUNDS.maxDateHorizonDays).toBe(366);
  expect(CAPACITY_ASSISTANT_BOUNDS.maxWorkingDays).toBe(262);
  expect(CAPACITY_ASSISTANT_BOUNDS.maxResultCount).toBe(100);
  expect(CAPACITY_ASSISTANT_BOUNDS.maxScenarioPeople).toBe(25);
  expect(CAPACITY_ASSISTANT_BOUNDS.maxScenarioDemands).toBe(100);
  expect(CAPACITY_ASSISTANT_BOUNDS.maxActionPlanItems).toBe(5);
  expect(CAPACITY_ASSISTANT_BOUNDS.maxActionPlanDependencyDepth).toBe(5);
  expect(CAPACITY_ASSISTANT_BOUNDS.maxContextBytes).toBe(16 * 1024);
});
