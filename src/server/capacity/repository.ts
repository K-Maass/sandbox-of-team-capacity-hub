import type { ActionPreview, CapacityDataSet, ResolvedAction } from "@/domain/capacity/contracts";

export type RepositoryMutation = {
  entityId: string;
  changedFields: string[];
};

export interface CapacityRepository {
  load(): Promise<CapacityDataSet>;
  apply(
    action: ResolvedAction,
    preview: ActionPreview,
    actorUserId: string,
  ): Promise<RepositoryMutation>;
}
