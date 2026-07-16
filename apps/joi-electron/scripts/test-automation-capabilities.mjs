import assert from 'node:assert/strict';
import {
  executeAutomationUpdateCapability,
  executeRequestUserInputCapability,
} from '../src/main/automation-capabilities.ts';

const clarification = executeRequestUserInputCapability({
  question: 'Which cadence?',
  options: ['Daily', 'Weekly', 'Monthly', 'Ignored'],
  header: 'Automation cadence that is deliberately too long',
});
assert.equal(clarification.status, 'needs_user_input');
assert.deepEqual(clarification.options, ['Daily', 'Weekly', 'Monthly']);
assert.equal(String(clarification.header).length, 24);

const saved = [];
const fakeStore = {
  saveAutomation(request) {
    saved.push(request);
    return {
      id: `automation_test_${saved.length}`,
      slug: `automation-test-${saved.length}`,
      status: request.enabled === false ? 'PAUSED' : 'ACTIVE',
      cwds: request.cwds || [],
      metadata: request.metadata || {},
      ...request,
    };
  },
};
const chatRequest = { channel: 'desktop', message: 'Create a schedule', conversation_id: 'conv_source' };

const refusedMutation = executeAutomationUpdateCapability({ mode: 'delete', automation_id: 'existing' }, chatRequest, fakeStore);
assert.equal(refusedMutation.status, 'review_required');
assert.equal(saved.length, 0);

const incompleteHeartbeat = executeAutomationUpdateCapability({
  mode: 'suggested_create',
  kind: 'heartbeat',
  name: 'Continue work',
  prompt: 'Check progress',
  rrule: 'FREQ=HOURLY;INTERVAL=2',
}, chatRequest, fakeStore);
assert.equal(incompleteHeartbeat.status, 'needs_user_input');
assert.equal(saved.length, 0);

const proposal = executeAutomationUpdateCapability({
  mode: 'suggested_create',
  kind: 'cron',
  name: 'Daily brief',
  prompt: 'Summarize current project status.',
  rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0',
  model: 'deepseek-v4-flash',
  reasoning_effort: 'medium',
  cwds: ['/Users/hao/project/Joi'],
  permission_profile: 'workspace_write',
}, chatRequest, fakeStore);
assert.equal(proposal.status, 'suggested_create');
assert.equal(proposal.review_required, true);
assert.equal(saved.length, 1);
assert.equal(saved[0].enabled, false);
assert.equal(saved[0].is_draft, true);
assert.equal(saved[0].execution_kind, 'cron');
assert.equal(saved[0].rrule, 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0');
assert.equal(saved[0].model, 'deepseek-v4-flash');
assert.equal(saved[0].reasoning_effort, 'medium');
assert.equal(saved[0].permission_profile, 'workspace_write');
assert.deepEqual(saved[0].target, { type: 'workspace', cwd: '/Users/hao/project/Joi' });
assert.equal(saved[0].metadata.source_conversation_id, 'conv_source');

console.log('automation capability tests passed');
