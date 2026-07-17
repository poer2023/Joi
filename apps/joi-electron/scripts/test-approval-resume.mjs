import assert from 'node:assert/strict';
import {
  approvalResumeCapabilityInput,
  approvalResumeContinuationMessage,
} from '../src/main/approval-resume.ts';

assert.deepEqual(approvalResumeCapabilityInput({ patch: 'direct', reason: 'keep' }), {
  patch: 'direct',
  reason: 'keep',
});

assert.deepEqual(approvalResumeCapabilityInput({
  server: 'joi_capabilities',
  tool: 'apply_patch',
  arguments: { patch: 'nested', reason: 'original' },
  operation_id: 'op_test',
  affected_paths: ['config.json'],
  reason: 'edited',
  dry_run: true,
}), {
  patch: 'nested',
  reason: 'edited',
  dry_run: true,
});

const continuation = approvalResumeContinuationMessage('apply_patch', {
  status: 'completed',
  summary: 'patch applied',
});
assert.match(continuation, /already executed/i);
assert.match(continuation, /Do not repeat/i);
assert.match(continuation, /read-only verification/i);

console.log('approval resume tests passed');
