import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs.filter((arg) => !arg.includes('=')));
const evidenceArg = rawArgs.find((arg) => arg.startsWith('--evidence='));
const outArg = rawArgs.find((arg) => arg.startsWith('--out='));
const requireComplete = args.has('--require-complete');
const init = args.has('--init');
const force = args.has('--force');

const canonicalEvidencePath = join(root, '.e2e', 'conversation-flow-manual-e2e', 'latest.json');
const evidencePath = evidenceArg
  ? resolve(evidenceArg.slice('--evidence='.length))
  : resolve(process.env.JOI_MANUAL_E2E_EVIDENCE || canonicalEvidencePath);
const outPath = outArg ? resolve(outArg.slice('--out='.length)) : '';

const REQUIRED_ITEMS = [
  {
    id: 'pure_chat_streaming_no_task',
    title: 'Pure chat streaming without Product Task',
    requirement: 'Ask a pure chat question; verify streaming/projection reaches terminal state and no Product Task is created.',
  },
  {
    id: 'serious_task_card_tool_evidence',
    title: 'Serious task lifecycle evidence',
    requirement: 'Ask a serious task; verify Task Card, tool/activity status, artifact or verification evidence, and terminal state.',
  },
  {
    id: 'approval_denied_semantics',
    title: 'Approval denied semantics',
    requirement: 'Deny an approval and verify blocked/cancelled semantics remain visible after the final assistant response.',
  },
  {
    id: 'approval_resume_after_reload',
    title: 'Approval resume after reload',
    requirement: 'Approve and resume after renderer reload; verify the same run resumes without duplicate side-effect tool calls.',
  },
  {
    id: 'cancel_streaming_response',
    title: 'Cancel streaming response',
    requirement: 'Cancel a streaming response and verify a terminal cancelled state is persisted and projected.',
  },
  {
    id: 'redirect_running_task',
    title: 'Redirect running task',
    requirement: 'Redirect a running task and verify the child run links back to the redirected parent run.',
  },
  {
    id: 'restart_paused_run_recovery',
    title: 'Restart recovery classification',
    requirement: 'Restart the app with a paused/non-terminal run and verify recovery classification is visible.',
  },
  {
    id: 'memory_correction_next_turn',
    title: 'Memory correction next turn',
    requirement: 'Correct a memory and verify the next turn does not reuse the stale memory.',
  },
  {
    id: 'reminder_proactive_terminal_state',
    title: 'Reminder/proactive terminal state',
    requirement: 'Create or inspect a reminder/proactive item and verify delivery, feedback, close, suppression, or expiry state.',
  },
  {
    id: 'external_entry_desktop_continuation',
    title: 'External entry Desktop continuation',
    requirement: 'Start a task from Telegram or iMessage and continue it in Desktop as the same Product Task.',
  },
];

if (init) {
  initializeTemplate(evidencePath, force);
}

const loaded = readEvidence(evidencePath);
const items = REQUIRED_ITEMS.map((required) => auditManualItem(required, loaded.json?.items || [], evidencePath));
const complete = items.every((item) => item.status === 'proved');
const audit = {
  generated_at: new Date().toISOString(),
  complete,
  status: complete ? 'complete' : 'incomplete',
  objective: 'Joi conversation-flow manual E2E proof',
  evidence_path: evidencePath,
  evidence_exists: loaded.exists,
  evidence_parse_error: loaded.error || '',
  blocking_item_ids: items.filter((item) => item.status !== 'proved').map((item) => item.id),
  next_action: complete
    ? 'Manual E2E proof is present.'
    : `Run pnpm test:conversation-flow:manual:init, complete the checklist in Joi Desktop, then update ${evidencePath}.`,
  items,
};

const output = `${JSON.stringify(audit, null, 2)}\n`;
if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, output);
}
process.stdout.write(output);

if (requireComplete && !complete) {
  process.exit(1);
}

function initializeTemplate(path, overwrite) {
  if (existsSync(path) && !overwrite) return;
  const template = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    objective: 'Joi conversation-flow manual E2E proof',
    instructions: [
      'Set each item status to passed only after observing the behavior in Joi Desktop or a live external channel.',
      'For every passed item, fill observed_at, actor, and either notes or artifact_paths.',
      'artifact_paths may be absolute or relative to this evidence file.',
    ],
    items: REQUIRED_ITEMS.map((item) => ({
      id: item.id,
      title: item.title,
      requirement: item.requirement,
      status: 'pending',
      observed_at: '',
      actor: '',
      notes: '',
      artifact_paths: [],
    })),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(template, null, 2)}\n`);
}

function readEvidence(path) {
  if (!existsSync(path)) return { exists: false, json: null, error: '' };
  try {
    return { exists: true, json: JSON.parse(readFileSync(path, 'utf8')), error: '' };
  } catch (error) {
    return {
      exists: true,
      json: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function auditManualItem(required, evidenceItems, evidencePath) {
  const found = evidenceItems.find((item) => item?.id === required.id);
  const status = String(found?.status || '').trim();
  const actor = String(found?.actor || '').trim();
  const observedAt = String(found?.observed_at || '').trim();
  const notes = String(found?.notes || '').trim();
  const artifactPaths = Array.isArray(found?.artifact_paths) ? found.artifact_paths.map((value) => String(value)) : [];
  const resolvedArtifacts = artifactPaths.map((path) => {
    const resolved = isAbsolute(path) ? path : resolve(dirname(evidencePath), path);
    return {
      path: resolved,
      exists: existsSync(resolved),
    };
  });
  const hasArtifactEvidence = resolvedArtifacts.length > 0 && resolvedArtifacts.every((artifact) => artifact.exists);
  const hasNarrativeEvidence = notes.length >= 10;
  const hasManualAttribution = actor.length > 0 && observedAt.length > 0;
  const proved = status === 'passed' && hasManualAttribution && (hasArtifactEvidence || hasNarrativeEvidence);
  return {
    id: required.id,
    title: required.title,
    requirement: required.requirement,
    status: proved ? 'proved' : 'incomplete',
    evidence: {
      configured_status: status || 'missing',
      observed_at: observedAt,
      actor,
      notes_present: hasNarrativeEvidence,
      artifact_paths: resolvedArtifacts,
      missing_reason: proved ? '' : missingReason({ found, status, actor, observedAt, hasArtifactEvidence, hasNarrativeEvidence }),
    },
  };
}

function missingReason({ found, status, actor, observedAt, hasArtifactEvidence, hasNarrativeEvidence }) {
  if (!found) return 'manual evidence item is missing';
  if (status !== 'passed') return `manual evidence status is ${status || 'empty'}`;
  if (!actor) return 'manual evidence actor is missing';
  if (!observedAt) return 'manual evidence observed_at is missing';
  if (!hasArtifactEvidence && !hasNarrativeEvidence) return 'manual evidence needs notes or existing artifact_paths';
  return 'manual evidence is incomplete';
}
