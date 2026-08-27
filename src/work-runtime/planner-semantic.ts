/**
 * Planner semantic decision — AI owns task meaning; control only validates shape.
 * Not a second intent classifier. Delivery family ≠ required capabilities.
 */
export const PLANNER_CAPABILITY_NEEDS = [
  'external_information',
  'code_execution',
  'code_analysis',
  'document_synthesis',
] as const;

export type PlannerCapabilityNeed = (typeof PLANNER_CAPABILITY_NEEDS)[number];

export interface PlannerSemanticDecision {
  requiredCapabilities: PlannerCapabilityNeed[];
  /** Review must check these; never invented by keyword rules. */
  requirements: string[];
  /** Candidate ids chosen by the planner (artifact:/task:/file:). */
  relevantContextIds: string[];
}

export function isPlannerCapabilityNeed(value: unknown): value is PlannerCapabilityNeed {
  return (
    typeof value === 'string' &&
    (PLANNER_CAPABILITY_NEEDS as readonly string[]).includes(value)
  );
}

/** Structural parse only. Missing/invalid fields → null (do not guess semantics). */
export function parsePlannerSemantic(raw: unknown): PlannerSemanticDecision | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const capsRaw = obj.requiredCapabilities ?? obj.capabilityNeeds ?? obj.capabilities;
  if (!Array.isArray(capsRaw) || capsRaw.length === 0) return null;
  const requiredCapabilities = [
    ...new Set(capsRaw.map((c) => String(c || '').trim()).filter(isPlannerCapabilityNeed)),
  ];
  if (!requiredCapabilities.length) return null;
  const reqRaw = obj.planRequirements ?? obj.requirements;
  const requirements = Array.isArray(reqRaw)
    ? reqRaw
        .map((r) => String(r || '').trim())
        .filter((r) => r.length >= 2)
        .slice(0, 8)
    : [];
  const ctxRaw = obj.relevantContextIds ?? obj.selectedContextIds;
  const relevantContextIds = Array.isArray(ctxRaw)
    ? ctxRaw
        .map((id) => String(id || '').trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];
  return { requiredCapabilities, requirements, relevantContextIds };
}

export function mergePlannerSemantic(
  previous: PlannerSemanticDecision | undefined,
  next: PlannerSemanticDecision | null | undefined,
): PlannerSemanticDecision | undefined {
  if (next) return next;
  return previous;
}

export function needsExternalInformation(
  semantic: PlannerSemanticDecision | undefined,
): boolean {
  return !!semantic?.requiredCapabilities.includes('external_information');
}

export function needsCodeExecution(semantic: PlannerSemanticDecision | undefined): boolean {
  return !!semantic?.requiredCapabilities.includes('code_execution');
}

export function needsDocumentSynthesis(
  semantic: PlannerSemanticDecision | undefined,
): boolean {
  return (
    !!semantic?.requiredCapabilities.includes('document_synthesis') ||
    (!!semantic && !semantic.requiredCapabilities.includes('code_execution'))
  );
}

/** Capability selection extras owned by the planner; empty if no reliable semantic. */
export function capabilityNeedFromPlan(
  semantic: PlannerSemanticDecision | undefined,
): { needsExternalInformation?: boolean } {
  if (needsExternalInformation(semantic)) return { needsExternalInformation: true };
  return {};
}
