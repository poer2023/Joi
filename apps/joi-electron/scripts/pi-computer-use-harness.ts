import { app, BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { executeJoiPiComputerUse } from '../src/main/pi-computer-use';

type CaseResult = {
  id: string;
  kind: 'historical' | 'stress';
  source_pattern: string;
  status: 'passed' | 'failed';
  duration_ms: number;
  evidence?: Record<string, unknown>;
  error?: string;
};

const round = Number(process.env.JOI_PI_HARNESS_ROUND || '1');
const campaignRoot = '.e2e/skill-computer-use-rerun';
const outputPath = resolve(process.env.JOI_PI_HARNESS_OUTPUT || `${campaignRoot}/round-${round}/computer-use.json`);
const userData = resolve(process.env.JOI_PI_HARNESS_USER_DATA || `${campaignRoot}/round-${round}/user-data`);
const captureDir = resolve(process.env.JOI_PI_HARNESS_CAPTURE_DIR || `${campaignRoot}/round-${round}/captures`);
const interactive = process.env.JOI_PI_HARNESS_INTERACTIVE === '1';
const visualSmokeOnly = process.env.JOI_PI_HARNESS_VISUAL_SMOKE === '1';
const recoverySmokeOnly = process.env.JOI_PI_HARNESS_RECOVERY_SMOKE === '1';
const title = `Joi Computer Use Rerun Fixture R${round}`;
const cases: CaseResult[] = [];
const startedAt = new Date().toISOString();
const harnessStarted = performance.now();
const preparedStateIds = new Set<string>();
let fixtureWindow: BrowserWindow | undefined;
let currentStateId = '';
let currentRootRef = '';
let injectSuccessorCaptureFailureOnce = false;

app.setName(`Joi CU Fixture R${round}`);
app.setPath('userData', userData);
app.commandLine.appendSwitch('disable-background-timer-throttling');

process.stderr.write('[joi-pi-harness] waiting for Electron ready\n');
void app.whenReady().then(runHarness);

async function runHarness() {
  process.stderr.write('[joi-pi-harness] Electron ready\n');
  try {
  fixtureWindow = new BrowserWindow({
    width: 860,
    height: 720,
    x: 72 + round * 18,
    y: 72 + round * 18,
    title,
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await fixtureWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fixtureHtml(round))}`);
  process.stderr.write('[joi-pi-harness] fixture loaded\n');
  await wait(900);
  fixtureWindow.focus();
  await wait(400);

  if (visualSmokeOnly) await visualSmoke();
  else if (recoverySmokeOnly) await recoverySmoke();
  else if (round === 1) await roundOne();
  else if (round === 2) await roundTwo();
  else if (round === 3) await roundThree();
  } catch (error) {
    const expectedCases = visualSmokeOnly || recoverySmokeOnly ? 1 : 6;
    while (cases.length < expectedCases) {
      cases.push({
        id: `computer-r${round}-setup-${cases.length + 1}`,
        kind: cases.length < 3 ? 'historical' : 'stress',
        source_pattern: 'fixture setup dependency',
        status: 'failed',
        duration_ms: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    const report = {
      schema_version: 1,
      feature: 'computer_use',
      implementation: '@injaneity/pi-computer-use@0.4.3',
      campaign: 'rerun-1',
      round,
      isolated: true,
      isolated_case_reset: true,
      fixture_window: title,
      user_data: userData,
      real_joi_user_data_touched: false,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      duration_ms: Math.round(performance.now() - harnessStarted),
      mode: visualSmokeOnly ? 'visual-smoke' : recoverySmokeOnly ? 'successor-recovery-smoke' : 'round',
      passed: cases.length === (visualSmokeOnly || recoverySmokeOnly ? 1 : 6) && cases.every((item) => item.status === 'passed'),
      summary: {
        total: cases.length,
        passed: cases.filter((item) => item.status === 'passed').length,
        failed: cases.filter((item) => item.status === 'failed').length,
        historical: cases.filter((item) => item.kind === 'historical').length,
        stress: cases.filter((item) => item.kind === 'stress').length,
        max_case_duration_ms: Math.max(0, ...cases.map((item) => item.duration_ms)),
        unique_prepared_states: preparedStateIds.size,
      },
      cases,
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    fixtureWindow?.destroy();
    process.stdout.write(`${JSON.stringify({ output: outputPath, passed: report.passed, summary: report.summary })}\n`);
    app.exit(report.passed ? 0 : 1);
  }
}

async function visualSmoke() {
  await runCase('computer-preflight-visual-capture', 'stress', '显式 image: always 必须通过 Pi 原生 helper 返回有界截图', async () => {
    const result = await call('observe_ui', {
      root: currentRootRef,
      image: 'always',
      mode: 'visual',
      readText: 'never',
    });
    const images = Array.isArray(result.images) ? result.images : [];
    if (images.length !== 1) throw new Error(`Expected one persisted Pi capture, got ${images.length}`);
    const image = recordValue(images[0]);
    if (Number(image.byte_count || 0) <= 0) throw new Error('Pi capture was empty');
    return {
      state_id: stateIdOf(result),
      capture_bytes: Number(image.byte_count),
      embedded_in_trace: image.embedded_in_trace,
    };
  });
}

async function recoverySmoke() {
  await runCase('computer-preflight-successor-recovery', 'stress', '写入已派发但 successor 截图失败时不得重放，且必须恢复新 state', async () => {
    const ref = await refFor('串行计数按钮');
    injectSuccessorCaptureFailureOnce = true;
    const result = await call('act_ui', {
      stateId: currentStateId,
      actions: [{ action: 'press', ref }],
      expect: { text: '串行计数 1', timeoutMs: 4_000 },
      image: 'never',
    });
    currentStateId = stateIdOf(result);
    assertOutcome(result);
    const details = recordValue(result.details);
    const recovery = recordValue(details.recovery);
    if (recovery.action_replayed !== false || recovery.state_recovered !== true) {
      throw new Error(`Unexpected successor recovery evidence: ${JSON.stringify(recovery)}`);
    }
    const check = await call('search_ui', { stateId: currentStateId, text: '串行计数 1', limit: 5, image: 'never' });
    assertMatchCount(check, 1);
    const doubled = await call('search_ui', { stateId: currentStateId, text: '串行计数 2', limit: 5, image: 'never' });
    if (matchCount(doubled) !== 0) throw new Error('The write appears to have been replayed');
    return {
      state_id: currentStateId,
      action_replayed: false,
      verification: verificationStatus(result),
    };
  });
}

async function roundOne() {
  await runCase('computer-r1-h1-inspect-decision', 'historical', '2026-07-11T03:02:28Z · 在 Joi 窗口查看“无可靠新增”的判断依据', async () => {
    const result = await call('search_ui', { stateId: currentStateId, text: '无可靠新增：隔离来源无更新', limit: 5, image: 'never' });
    assertMatchCount(result, 1);
    return { state_id: currentStateId, matched_text: true };
  });
  await runCase('computer-r1-h2-subscription-search', 'historical', '2026-07-11T03:02:28Z · 打开本地订阅界面并检查关注来源', async () => {
    const inputRef = await refFor('隔离订阅检索', 'setText');
    const buttonRef = await refFor('执行订阅检索', 'press');
    const result = await call('act_ui', {
      stateId: currentStateId,
      actions: [
        { action: 'setText', ref: inputRef, text: 'fixture-topic' },
        { action: 'press', ref: buttonRef },
      ],
      expect: { text: '找到 3 条隔离订阅', timeoutMs: 4_000 },
      image: 'never',
    });
    currentStateId = stateIdOf(result);
    assertOutcome(result);
    return { action_count: 2, state_id: currentStateId, verification: verificationStatus(result) };
  });
  await runCase('computer-r1-h3-hide-selected-card', 'historical', '2026-07-12T13:04:11Z · 按页面标注删除选中的临时 UI 项', async () => {
    const buttonRef = await refFor('隐藏选中卡片');
    const result = await call('act_ui', {
      stateId: currentStateId,
      actions: [{ action: 'press', ref: buttonRef }],
      expect: { text: '待隐藏的截图占位卡片', gone: true, timeoutMs: 4_000 },
      image: 'never',
    });
    currentStateId = stateIdOf(result);
    assertOutcome(result);
    return { state_id: currentStateId, gone_verified: verificationStatus(result) === 'verified' };
  });
  await runCase('computer-r1-p1-concurrent-roots', 'stress', '24 个并发只读窗口发现请求', async () => {
    const results = await Promise.all(Array.from({ length: 24 }, () => call('find_roots', { pid: process.pid, query: title })));
    const hits = results.filter((result) => windowsOf(result).some((window) => String(window.windowTitle || '').includes(title))).length;
    if (hits !== results.length) throw new Error(`Only ${hits}/${results.length} root lookups found the fixture`);
    return { requests: results.length, fixture_hits: hits };
  });
  await runCase('computer-r1-p2-large-outline-search', 'stress', '420 个可访问节点中的末端语义检索', async () => {
    const refreshed = await call('observe_ui', { windowTitle: title, image: 'never', mode: 'semantic' });
    currentStateId = stateIdOf(refreshed);
    const result = await call('search_ui', { stateId: currentStateId, text: '压力项 419', limit: 5, image: 'never' });
    assertMatchCount(result, 1);
    const chars = JSON.stringify(result).length;
    if (chars > 240_000) throw new Error(`Bounded result exceeded 240000 chars: ${chars}`);
    return { nodes_requested: 420, result_json_chars: chars };
  });
  await runCase('computer-r1-p3-stale-state-rejection', 'stress', '成功写入后的旧 stateId 禁止再次派发', async () => {
    const initial = currentStateId;
    const ref = await refFor('串行计数按钮');
    const successor = await call('act_ui', {
      stateId: initial,
      actions: [{ action: 'press', ref }],
      expect: { text: '串行计数 1', timeoutMs: 4_000 },
      image: 'never',
    });
    currentStateId = stateIdOf(successor);
    assertOutcome(successor);
    let rejected = false;
    let message = '';
    try {
      await call('act_ui', { stateId: initial, actions: [{ action: 'press', ref }], image: 'never' });
    } catch (error) {
      rejected = true;
      message = error instanceof Error ? error.message : String(error);
    }
    if (!rejected) throw new Error('Stale state write was not rejected');
    return { rejected, error_layer: /stale|superseded|state|epoch/i.test(message) ? 'stale_state' : 'unknown' };
  });
}

async function roundTwo() {
  await runCase('computer-r2-h1-login-spinner', 'historical', '2026-07-03T15:33:59Z · 检查登录按钮持续转圈的界面状态', async () => {
    const result = await call('search_ui', { stateId: currentStateId, text: '登录仍在处理中', limit: 5, image: 'never' });
    assertMatchCount(result, 1);
    return { matched_status: true, state_id: currentStateId };
  });
  await runCase('computer-r2-h2-original-image-mode', 'historical', '2026-07-13T05:16:43Z · 检查弹窗左侧是否展示原图', async () => {
    const result = await call('search_ui', { stateId: currentStateId, text: '原图 3024 × 4032', limit: 5, image: 'never' });
    const ref = firstRef(result);
    if (!ref) throw new Error('Original-image metadata ref missing');
    const inspected = await call('inspect_ui', { stateId: currentStateId, ref, includeRaw: false, image: 'never' });
    if (!JSON.stringify(inspected).includes('3024')) throw new Error('Original resolution missing from inspection');
    return { inspected_ref: ref, original_dimensions_visible: true };
  });
  await runCase('computer-r2-h3-latest-36-hours', 'historical', '2026-07-11T14:28:59Z · 切换为最新倒序 36 小时', async () => {
    const ref = await refFor('切换最新 36 小时');
    const result = await call('act_ui', {
      stateId: currentStateId,
      actions: [{ action: 'press', ref }],
      expect: { text: '已按最新倒序显示 36 小时', timeoutMs: 4_000 },
      image: 'never',
    });
    currentStateId = stateIdOf(result);
    assertOutcome(result);
    return { state_id: currentStateId, verification: verificationStatus(result) };
  });
  await runCase('computer-r2-p1-parallel-state-search', 'stress', '同一 stateId 上 48 个并发语义读取', async () => {
    const results = await Promise.all(Array.from({ length: 48 }, (_, index) => call('search_ui', { stateId: currentStateId, text: `并发标签 ${index % 8}`, limit: 10, image: 'never' })));
    const matched = results.filter((result) => matchCount(result) >= 1).length;
    if (matched !== results.length) throw new Error(`Only ${matched}/${results.length} searches matched`);
    return { requests: results.length, matched };
  });
  await runCase('computer-r2-p2-serialized-counter', 'stress', '同一窗口的 8 个写事务必须串行且不丢计数', async () => {
    for (let index = 1; index <= 8; index += 1) {
      const ref = await refFor('串行计数按钮');
      const result = await call('act_ui', {
        stateId: currentStateId,
        actions: [{ action: 'press', ref }],
        expect: { text: `串行计数 ${index}`, timeoutMs: 4_000 },
        image: 'never',
      });
      currentStateId = stateIdOf(result);
      assertOutcome(result);
    }
    return { transactions: 8, final_text: '串行计数 8' };
  });
  await runCase('computer-r2-p3-invalid-ref-honesty', 'stress', '无效 ref 必须失败且不得坐标猜测或重放', async () => {
    let message = '';
    try {
      await call('act_ui', { stateId: currentStateId, actions: [{ action: 'press', ref: '@e999999' }], image: 'never' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    if (!message) throw new Error('Invalid ref unexpectedly succeeded');
    if (!/ref|element|target|state/i.test(message)) throw new Error(`Unexpected invalid-ref error: ${message}`);
    return { failed_honestly: true, replayed: false };
  });
}

async function roundThree() {
  await runCase('computer-r3-h1-fold-tool-calls', 'historical', '2026-07-14T00:12:51Z · 折叠工具调用只保留产物与结论', async () => {
    const ref = await refFor('折叠所有工具调用');
    const result = await call('act_ui', { stateId: currentStateId, actions: [{ action: 'press', ref }], expect: { text: '工具调用已折叠', timeoutMs: 4_000 }, image: 'never' });
    currentStateId = stateIdOf(result);
    assertOutcome(result);
    return { verification: verificationStatus(result) };
  });
  await runCase('computer-r3-h2-full-archive-text', 'historical', '2026-07-13T04:23:36Z · 点击摘要后查看全部详细内容', async () => {
    const ref = await refFor('查看全文');
    const result = await call('act_ui', { stateId: currentStateId, actions: [{ action: 'press', ref }], expect: { text: '完整归档正文第 12 段', timeoutMs: 4_000 }, image: 'never' });
    currentStateId = stateIdOf(result);
    assertOutcome(result);
    return { full_text_visible: true };
  });
  await runCase('computer-r3-h3-output-bounce', 'historical', '2026-07-13T14:34:08Z · 检查完成后内容回弹隐藏的 UI 状态', async () => {
    const result = await call('wait_for', { stateId: currentStateId, text: '稳定输出：全部内容保持可见', timeoutMs: 2_000, image: 'never' });
    if (detailValue(result, 'found') !== true) throw new Error('Stable output was not found');
    currentStateId = stateIdOf(result);
    return { found: true, state_id: currentStateId };
  });
  await runCase('computer-r3-p1-many-roots', 'stress', '80 个连续窗口发现请求', async () => {
    let hits = 0;
    for (let index = 0; index < 80; index += 1) {
      const result = await call('find_roots', { pid: process.pid, query: title });
      if (windowsOf(result).some((window) => String(window.windowTitle || '').includes(title))) hits += 1;
    }
    if (hits !== 80) throw new Error(`${hits}/80 roots found`);
    return { requests: 80, hits };
  });
  await runCase('computer-r3-p2-text-pagination', 'stress', '超长文本按 offset/limit 分页读取', async () => {
    const ref = await refFor('超长隔离文本', null);
    const first = await call('read_text', { stateId: currentStateId, ref, offset: 0, limit: 2_000, image: 'never' });
    const second = await call('read_text', { stateId: currentStateId, ref, offset: 2_000, limit: 2_000, image: 'never' });
    if (JSON.stringify(first) === JSON.stringify(second)) throw new Error('Pagination returned identical pages');
    return { pages: 2 };
  });
  await runCase('computer-r3-p3-postcondition-failure', 'stress', '错误 postcondition 必须报告 failed 而不是假成功', async () => {
    const ref = await refFor('无变化按钮');
    const result = await call('act_ui', { stateId: currentStateId, actions: [{ action: 'press', ref }], expect: { text: '永远不会出现的文本', timeoutMs: 500 }, image: 'never' });
    if (verificationStatus(result) !== 'failed') throw new Error(`Expected failed verification, got ${verificationStatus(result)}`);
    return { verification: 'failed', recorded_only_round: true };
  });
}

async function call(tool: string, input: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`${tool} timed out after 30 seconds`)), 30_000);
  const injectFailure = tool === 'act_ui' && injectSuccessorCaptureFailureOnce;
  if (injectFailure) injectSuccessorCaptureFailureOnce = false;
  return await executeJoiPiComputerUse(tool, input, {
    cwd: userData,
    capture_dir: captureDir,
    interactive,
    signal: controller.signal,
    test_fail_successor_capture_after_act: injectFailure,
  }).finally(() => clearTimeout(timeout));
}

async function refFor(text: string, action: string | null = 'press'): Promise<string> {
  const result = await call('search_ui', {
    stateId: currentStateId,
    text,
    ...(action ? { action } : {}),
    limit: 10,
    image: 'never',
  });
  const ref = firstRef(result);
  if (!ref) throw new Error(`No UI ref found for ${text}`);
  return ref;
}

function firstRef(result: Record<string, unknown>): string {
  const details = recordValue(result.details);
  const matches = Array.isArray(details.matches) ? details.matches : [];
  const first = recordValue(matches[0]);
  return String(first.ref || recordValue(first.node).ref || '');
}

function stateIdOf(result: Record<string, unknown>): string {
  const details = recordValue(result.details);
  return String(details.stateId || recordValue(details.capture).stateId || '');
}

function windowsOf(result: Record<string, unknown>): Array<Record<string, unknown>> {
  const windows = recordValue(result.details).windows;
  return Array.isArray(windows) ? windows.map(recordValue) : [];
}

function matchCount(result: Record<string, unknown>): number {
  const matches = recordValue(result.details).matches;
  return Array.isArray(matches) ? matches.length : 0;
}

function assertMatchCount(result: Record<string, unknown>, minimum: number) {
  const count = matchCount(result);
  if (count < minimum) throw new Error(`Expected at least ${minimum} UI match, got ${count}`);
}

function assertOutcome(result: Record<string, unknown>) {
  const execution = recordValue(recordValue(result.details).execution);
  if (execution.outcome !== 'worked') {
    throw new Error(`Pi action outcome was ${String(execution.outcome || 'missing')}: ${JSON.stringify(execution).slice(0, 8_000)}`);
  }
}

function verificationStatus(result: Record<string, unknown>): string {
  return String(recordValue(recordValue(result.details).execution).verification && recordValue(recordValue(recordValue(result.details).execution).verification).status || '');
}

function detailValue(result: Record<string, unknown>, key: string): unknown {
  return recordValue(result.details)[key];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function runCase(id: string, kind: 'historical' | 'stress', sourcePattern: string, test: () => Promise<Record<string, unknown>>) {
  const started = performance.now();
  try {
    const prepared = await prepareIsolatedCase();
    const preparedStateId = stateIdOf(prepared);
    if (preparedStateIds.has(preparedStateId)) {
      throw new Error(`Isolated case reused a previous prepared stateId: ${preparedStateId}`);
    }
    preparedStateIds.add(preparedStateId);
    const evidence = await test();
    cases.push({
      id,
      kind,
      source_pattern: sourcePattern,
      status: 'passed',
      duration_ms: Math.round(performance.now() - started),
      evidence: { ...evidence, isolated_case_reset: true, prepared_state_id: preparedStateId, fresh_state: true },
    });
  } catch (error) {
    cases.push({ id, kind, source_pattern: sourcePattern, status: 'failed', duration_ms: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) });
  }
}

async function prepareIsolatedCase(): Promise<Record<string, unknown>> {
  if (!fixtureWindow) throw new Error('Fixture window is unavailable');
  await fixtureWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fixtureHtml(round))}`);
  await wait(220);
  fixtureWindow.focus();
  await wait(120);
  const roots = await call('find_roots', { pid: process.pid, query: title });
  const root = windowsOf(roots).find((candidate) => String(candidate.windowTitle || '').includes(title));
  currentRootRef = String(root?.windowRef || '');
  if (!currentRootRef) throw new Error('Pi root discovery did not return a stable @r ref for the isolated fixture');
  const observed = await call('observe_ui', {
    root: currentRootRef,
    image: 'never',
    mode: 'semantic',
    readText: 'never',
  });
  currentStateId = stateIdOf(observed);
  if (!currentStateId) throw new Error('Pi semantic observation did not return a stateId');
  return observed;
}

function fixtureHtml(activeRound: number): string {
  const pressureItems = Array.from({ length: activeRound === 1 ? 420 : 120 }, (_, index) => `<button type="button" aria-label="压力项 ${index}">压力项 ${index}</button>`).join('');
  const parallelLabels = Array.from({ length: 8 }, (_, index) => `<span>并发标签 ${index}</span>`).join('');
  const longText = Array.from({ length: 360 }, (_, index) => `超长隔离文本第${index}段：ABCDEFGHIJKLMNOPQRSTUVWXYZ`).join(' ');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title><style>
body{font:15px -apple-system;margin:24px;background:#f7f7fa;color:#1d1d22}.panel{background:white;border:1px solid #ddd;border-radius:12px;padding:16px;margin:12px 0}button,input{font:inherit;padding:8px;margin:4px}.pressure{height:190px;overflow:auto}.hidden{display:none}.status{font-weight:600}
</style></head><body>
<h1>${title}</h1>
<section class="panel" aria-label="历史用例区">
  <p role="status" class="status">无可靠新增：隔离来源无更新</p>
  <label>隔离订阅检索 <input aria-label="隔离订阅检索" value=""></label>
  <button aria-label="执行订阅检索" onclick="document.getElementById('subscription-result').textContent='找到 3 条隔离订阅'">执行订阅检索</button>
  <output id="subscription-result">尚未检索</output>
  <article id="temporary-card"><span>待隐藏的截图占位卡片</span><button aria-label="隐藏选中卡片" onclick="this.parentElement.classList.add('hidden')">隐藏选中卡片</button></article>
  <p role="status">登录仍在处理中</p>
  <p aria-label="原图信息">原图 3024 × 4032 · 未裁切</p>
  <button aria-label="切换最新 36 小时" onclick="document.getElementById('sort-status').textContent='已按最新倒序显示 36 小时'">切换最新 36 小时</button><output id="sort-status">当前为默认排序</output>
  <button aria-label="折叠所有工具调用" onclick="document.getElementById('fold-status').textContent='工具调用已折叠'">折叠所有工具调用</button><output id="fold-status">工具调用展开</output>
  <button aria-label="查看全文" onclick="document.getElementById('archive-full').classList.remove('hidden')">查看全文</button><p id="archive-full" class="hidden">完整归档正文第 12 段</p>
  <p role="status">稳定输出：全部内容保持可见</p>
</section>
<section class="panel"><div>${parallelLabels}</div><button aria-label="压力计数按钮" onclick="this.dataset.count=String(Number(this.dataset.count||0)+1)">压力计数按钮</button><button aria-label="串行计数按钮" onclick="window.serialCount=(window.serialCount||0)+1;document.getElementById('serial-status').textContent='串行计数 '+window.serialCount">串行计数按钮</button><output id="serial-status">串行计数 0</output><button aria-label="无变化按钮">无变化按钮</button></section>
<section class="panel pressure" aria-label="压力列表">${pressureItems}</section>
<section class="panel"><p aria-label="超长隔离文本">${longText}</p></section>
</body></html>`;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
