import { z } from "zod";

import { semanticClarificationSchema } from "./assistant-semantic";

/**
 * Safe ephemeral semantic state carried between assistant requests.
 * It intentionally excludes candidate selections, authoritative IDs, rows,
 * previews, credentials, transcripts, and mutation authority.
 */
export const pendingClarificationSchema = semanticClarificationSchema.omit({ type: true }).strict();

export type PendingClarification = z.infer<typeof pendingClarificationSchema>;
