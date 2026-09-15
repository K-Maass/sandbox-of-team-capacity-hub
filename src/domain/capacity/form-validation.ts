export function isDateRangeOrdered(startDate: string | null, endDate: string | null): boolean {
  return !startDate || !endDate || endDate >= startDate;
}

export function availabilityRangesOverlap(
  first: { startDate: string; endDate: string },
  second: { startDate: string; endDate: string },
): boolean {
  return first.startDate <= second.endDate && first.endDate >= second.startDate;
}

export function validateConsultantForm(
  name: string,
  surname: string,
  rawWorkingCapacity: string,
): { error: string | null; workingCapacity: number } {
  const workingCapacity = Number(rawWorkingCapacity);
  if (!name.trim() || !surname.trim()) {
    return { error: "Name and surname are required.", workingCapacity };
  }
  if (!Number.isFinite(workingCapacity) || workingCapacity < 0 || workingCapacity > 100) {
    return { error: "Working capacity must be between 0% and 100%.", workingCapacity };
  }
  return { error: null, workingCapacity };
}

export function parseDemandRequiredCapacity(raw: string): number {
  return Math.max(0, Math.min(1000, Number(raw) || 0));
}

export function validateDemandForm(
  title: string,
  startDate: string,
  endDate: string,
): string | null {
  if (!title.trim()) return "Title is required.";
  if (!isDateRangeOrdered(startDate || null, endDate || null)) {
    return "End date cannot be before start date.";
  }
  return null;
}

export function validateAvailabilityBlockForm(
  startDate: string,
  endDate: string,
  existing: Array<{ startDate: string; endDate: string }>,
): string | null {
  if (!startDate || !endDate) return "Choose a start and end date.";
  if (!isDateRangeOrdered(startDate, endDate)) return "End date cannot be before start date.";
  if (existing.some((block) => availabilityRangesOverlap(block, { startDate, endDate }))) {
    return "This overlaps an existing unavailable period.";
  }
  return null;
}

export function normalizeSkills(skills: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of skills) {
    const skill = raw.trim().replace(/\s+/g, " ");
    const key = skill.toLowerCase();
    if (!skill || seen.has(key)) continue;
    seen.add(key);
    normalized.push(skill);
  }
  return normalized;
}
