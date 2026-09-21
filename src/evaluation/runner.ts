import { CAPACITY_EVAL_CORPUS, type CapacityEvalCase } from "./capacity-corpus";
import { CAPACITY_NOVICE_EVAL_CORPUS } from "./capacity-novice-corpus";
import { createStateAwareProviderAdapter } from "./state-aware-provider-adapter";
import {
  evaluateCorpus,
  type EvalActual,
  type EvalConversationState,
  type EvalReport,
} from "./evaluator";

const offline = process.argv.includes("--offline");
const novice = process.argv.includes("--novice");
const apiKeyConfigured = Boolean(process.env["IBM_SERVICES_API_KEY"]);
const selectedCorpus: readonly CapacityEvalCase[] = novice
  ? CAPACITY_NOVICE_EVAL_CORPUS
  : CAPACITY_EVAL_CORPUS;

function requiredCase(id: string): CapacityEvalCase {
  const item = CAPACITY_EVAL_CORPUS.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Missing evaluation case ${id}`);
  return item;
}

async function runOfflineProbe(): Promise<
  EvalReport & { mode: string; semanticEvaluation: string }
> {
  const seed = {
    ...requiredCase("capacity-self"),
    safeConversationContext: {
      scope: "consultant" as const,
      consultantLabel: "Karim Maass",
      range: { startDate: "2026-09-21", endDate: "2026-09-25", label: "next week" },
    },
    pendingClarification: { field: "owner" as const, requestedValues: { missing: ["role"] } },
  };
  const followup = requiredCase("followup-taken");
  const report = await evaluateCorpus([seed, followup], async (testCase, state) => {
    const actuals: Record<string, EvalActual> = {
      "capacity-self": {
        semanticActual: {
          outcome: "READ",
          intentFamily: "capacity_range",
          importantArguments: {
            consultant: { reference: "self" },
            range: { timeConcept: "next_week" },
            focus: "free",
          },
        },
      },
      "followup-taken": {
        semanticActual: {
          outcome: "READ",
          intentFamily: "capacity_range",
          importantArguments: {
            consultant: { reference: "context" },
            focus: "committed",
          },
        },
      },
    };
    return {
      ...actuals[testCase.id],
      providerResult: {
        provider: "offline-plumbing-probe",
        tool: "independent-hand-built-actual",
        raw: {
          contextReceived: Boolean(state.safeConversationContext),
          pendingClarificationReceived: Boolean(state.pendingClarification),
        },
      },
    };
  });
  return { ...report, mode: "offline-plumbing-probe", semanticEvaluation: "NOT_RUN" };
}

if (!offline && !apiKeyConfigured) {
  console.error(
    "Capacity evaluation skipped: IBM_SERVICES_API_KEY is not configured. Re-run with --offline for the bounded plumbing probe.",
  );
  process.exitCode = 2;
} else if (offline) {
  const report = await runOfflineProbe();
  console.log(JSON.stringify(report, null, 2));
  if (report.failed > 0) process.exitCode = 1;
} else {
  const stateAwareAdapter = createStateAwareProviderAdapter();
  const report = await evaluateCorpus(
    selectedCorpus,
    async (testCase: CapacityEvalCase, state: EvalConversationState): Promise<EvalActual> =>
      stateAwareAdapter({ testCase, state }),
  );
  console.log(JSON.stringify(report, null, 2));
  if (report.failed > 0) process.exitCode = 1;
}
