import type {
  AvailabilityBlockDto,
  AvailabilityBlockRef,
  ConsultantDto,
  ConsultantRef,
  DemandDto,
  DemandRef,
} from "./contracts";
import { CapacityActionFailure } from "./errors";

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function consultantCandidate(consultant: ConsultantDto) {
  return {
    id: consultant.id,
    label: `${consultant.name} ${consultant.surname}`,
    secondary: consultant.email ?? (consultant.archivedAt ? "Archived" : consultant.role),
  };
}

export function resolveConsultant(
  ref: ConsultantRef,
  consultants: ConsultantDto[],
  options: { activeOnly?: boolean; field?: string } = {},
): ConsultantDto {
  const pool = options.activeOnly
    ? consultants.filter((consultant) => !consultant.archivedAt)
    : consultants;
  let matches: ConsultantDto[];

  if ("consultantId" in ref) {
    matches = pool.filter((consultant) => consultant.id === ref.consultantId);
  } else if ("email" in ref) {
    const email = normalize(ref.email);
    matches = pool.filter(
      (consultant) => consultant.email && normalize(consultant.email) === email,
    );
  } else {
    const name = normalize(ref.name);
    const fullMatches = pool.filter(
      (consultant) => normalize(`${consultant.name} ${consultant.surname}`) === name,
    );
    matches = fullMatches.length
      ? fullMatches
      : pool.filter(
          (consultant) =>
            normalize(consultant.name) === name || normalize(consultant.surname) === name,
        );
  }

  if (!matches.length)
    throw new CapacityActionFailure("NOT_FOUND", "Consultant not found", {
      field: options.field,
    });
  if (matches.length > 1) {
    throw new CapacityActionFailure("AMBIGUOUS_REFERENCE", "Consultant name is ambiguous", {
      candidates: matches.map(consultantCandidate),
      field: options.field,
    });
  }
  return matches[0];
}

function demandCandidate(demand: DemandDto) {
  return {
    id: demand.id,
    label: demand.title,
    secondary: [demand.client || "No client", demand.startDate ?? "Open start"].join(" · "),
  };
}

export function resolveDemand(
  ref: DemandRef,
  demands: DemandDto[],
  options: { field?: string } = {},
): DemandDto {
  let matches: DemandDto[];
  if ("demandId" in ref) {
    matches = demands.filter((demand) => demand.id === ref.demandId);
  } else {
    const title = normalize(ref.title);
    matches = demands.filter((demand) => normalize(demand.title) === title);
    if (ref.client !== undefined) {
      const client = normalize(ref.client);
      matches = matches.filter((demand) => normalize(demand.client) === client);
    }
  }
  if (!matches.length)
    throw new CapacityActionFailure("NOT_FOUND", "Demand not found", {
      field: options.field,
    });
  if (matches.length > 1) {
    throw new CapacityActionFailure("AMBIGUOUS_REFERENCE", "Demand title is ambiguous", {
      candidates: matches.map(demandCandidate),
      field: options.field,
    });
  }
  return matches[0];
}

export function resolveAvailabilityBlock(
  ref: AvailabilityBlockRef,
  blocks: AvailabilityBlockDto[],
  consultants: ConsultantDto[],
  options: { field?: string } = {},
): AvailabilityBlockDto {
  let matches: AvailabilityBlockDto[];
  if ("availabilityBlockId" in ref) {
    matches = blocks.filter((block) => block.id === ref.availabilityBlockId);
  } else {
    const consultant = resolveConsultant(ref.consultant, consultants, {
      field: options.field ? `${options.field}.consultant` : undefined,
    });
    matches = blocks.filter(
      (block) =>
        block.consultantId === consultant.id &&
        block.startDate === ref.startDate &&
        block.endDate === ref.endDate,
    );
  }
  if (!matches.length)
    throw new CapacityActionFailure("NOT_FOUND", "Availability block not found", {
      field: options.field,
    });
  if (matches.length > 1) {
    throw new CapacityActionFailure("AMBIGUOUS_REFERENCE", "Availability block is ambiguous", {
      candidates: matches.map((block) => ({
        id: block.id,
        label: `${block.startDate} to ${block.endDate}`,
        secondary: block.note || undefined,
      })),
      field: options.field,
    });
  }
  return matches[0];
}
