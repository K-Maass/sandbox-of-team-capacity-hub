/**
 * Single source of truth for assistant request, search, context, and provider limits.
 * Keep these values server-owned so clients cannot expand the work performed per request.
 */
export const CAPACITY_ASSISTANT_BOUNDS = {
  maxRequestBytes: 32 * 1024,
  maxMessageChars: 4_000,
  maxContextBytes: 16 * 1024,
  maxProviderResponseBytes: 512 * 1024,
  maxProviderArgumentsChars: 16_384,
  providerTimeoutMs: 30_000,
  maxDateHorizonDays: 366,
  maxWorkingDays: 262,
  maxResultCount: 100,
  defaultResultCount: 20,
  maxScenarioPeople: 25,
  maxScenarioDemands: 100,
  maxActionPlanItems: 5,
  maxActionPlanDependencyDepth: 5,
  rangeVariationNoticePoints: 10,
} as const;

export type CapacityAssistantBounds = typeof CAPACITY_ASSISTANT_BOUNDS;
