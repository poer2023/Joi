import assert from 'node:assert/strict';
import {
  executeBrowserClick,
  executeBrowserNavigate,
  executeBrowserObserve,
  executeBrowserType,
  executeComputerObserve,
} from '../src/browser-computer.ts';

const settings = {
  allowed_roots: [process.cwd()],
  default_root: process.cwd(),
  browser_allowed_hosts: [],
  web_research_allow_private_hosts: false,
  file_analyze_max_bytes: 1024,
  workspace_search_max_results: 10,
};

let navigatedURL = '';
let interacted = null;
const host = {
  async observeComputer() {
    return {
      status: 'completed',
      front_app: 'Joi',
      bundle_id: 'com.hao.joi.desktop',
      window_title: 'Joi Window',
      visible_text: 'visible token=SHOULD_NOT_LEAK_123456',
      text_status: 'ok',
    };
  },
  async observeBrowser() {
    return {
      status: 'completed',
      browser_app: 'Google Chrome',
      front_app: 'Google Chrome',
      title: 'Fixture Browser Page',
      url: 'https://example.com/page',
      visible_text: 'browser visible text',
      text_status: 'ok',
    };
  },
  async navigateBrowser(url) {
    navigatedURL = url;
    return {
      status: 'completed',
      browser_app: 'Google Chrome',
      front_app: 'Google Chrome',
      url,
      method: 'frontmost_browser_applescript',
    };
  },
  async interactBrowser(action, selector, text) {
    interacted = { action, selector, text };
    return {
      status: 'completed',
      action,
      selector,
      browser_app: 'Google Chrome',
      front_app: 'Google Chrome',
      method: 'frontmost_browser_javascript',
      result: { status: 'completed', selector, text_length: text.length },
    };
  },
};

const computer = await executeComputerObserve({ include_text: true }, host);
assert.equal(computer.mode, 'computer_observe_v2_macos_snapshot');
assert.equal(computer.observe_status, 'completed');
assert.ok(!String(computer.visible_text).includes('SHOULD_NOT_LEAK'));
assert.ok(String(computer.visible_text).includes('token=[REDACTED]'));

const browser = await executeBrowserObserve({ include_text: true }, host);
assert.equal(browser.mode, 'browser_observe_v1_macos_snapshot');
assert.equal(browser.observe_status, 'completed');
assert.equal(browser.title, 'Fixture Browser Page');
assert.equal(browser.url, 'https://example.com/page');

const fallback = await executeBrowserObserve({ include_text: true }, {
  ...host,
  async observeBrowser() {
    return { status: 'not_browser', front_app: 'Joi', error: 'frontmost app is not a supported browser' };
  },
});
assert.equal(fallback.observe_status, 'fallback_to_computer');
assert.equal(fallback.fallback_observe.mode, 'computer_observe_v2_macos_snapshot');

const blockedNavigate = await executeBrowserNavigate({ url: 'http://127.0.0.1:5173' }, settings, host);
assert.equal(blockedNavigate.navigation_status, 'policy_blocked');
assert.equal(blockedNavigate.reason, 'private_host_not_allowed');

const allowedNavigate = await executeBrowserNavigate({ url: 'http://127.0.0.1:5173' }, {
  ...settings,
  browser_allowed_hosts: ['127.0.0.1:5173'],
  web_research_allow_private_hosts: true,
}, host);
assert.equal(allowedNavigate.navigation_status, 'completed');
assert.equal(navigatedURL, 'http://127.0.0.1:5173/');
assert.equal(allowedNavigate.playwright_used, false);

await assert.rejects(() => executeBrowserClick({ selector: '#submit', permission_profile: 'read_only' }, host), /policy_denied/);

const click = await executeBrowserClick({ selector: '#submit', permission_profile: 'danger_full_access' }, host);
assert.equal(click.mode, 'browser_interaction_v1_macos');
assert.equal(click.interaction_status, 'completed');
assert.deepEqual(interacted, { action: 'click', selector: '#submit', text: '' });

await assert.rejects(() => executeBrowserType({ selector: '#name', permission_profile: 'danger_full_access' }, host), /browser_type text is required/);
const type = await executeBrowserType({ selector: '#name', text: 'Joi', permission_profile: 'danger_full_access' }, host);
assert.equal(type.interaction_status, 'completed');
assert.deepEqual(interacted, { action: 'type', selector: '#name', text: 'Joi' });

console.log('browser/computer runtime tests passed');
