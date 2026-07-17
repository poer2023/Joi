import assert from 'node:assert/strict';
import {
  shouldRecoverPiWriteSuccessorFailure,
  shouldRetryPiComputerUseFailure,
} from '../src/pi-computer-use-policy.ts';

assert.equal(shouldRetryPiComputerUseFailure('observe_ui', new Error('Capture timed out while capturing window 42')), true);
assert.equal(shouldRetryPiComputerUseFailure('find_roots', new Error('HelperTransportError: socket refused')), true);
assert.equal(shouldRetryPiComputerUseFailure('read_text', new Error('pi-computer-use helper app daemon is unavailable')), true);
assert.equal(shouldRetryPiComputerUseFailure('act_ui', new Error('Capture timed out after click')), false);
assert.equal(shouldRetryPiComputerUseFailure('computer_use', new Error('ECONNREFUSED')), false);
assert.equal(shouldRetryPiComputerUseFailure('observe_ui', new Error('Operation aborted'), true), false);
assert.equal(shouldRetryPiComputerUseFailure('observe_ui', new Error('Accessibility permission missing')), false);

assert.equal(shouldRecoverPiWriteSuccessorFailure('act_ui', new Error('Capture timed out while capturing window 42')), true);
assert.equal(shouldRecoverPiWriteSuccessorFailure('act_ui', new Error('Capture failed after checked actions')), true);
assert.equal(shouldRecoverPiWriteSuccessorFailure('act_ui', new Error('element ref is invalid')), false);
assert.equal(shouldRecoverPiWriteSuccessorFailure('observe_ui', new Error('Capture timed out')), false);
assert.equal(shouldRecoverPiWriteSuccessorFailure('act_ui', new Error('Capture timed out'), true), false);

console.log('Pi computer-use retry policy tests passed');
