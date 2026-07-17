import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { app } from 'electron';
import { BrowserWorkbenchManager } from '../src/main/browser-workbench.ts';
import { analyzeImageFile } from '../src/main/media-analysis.ts';

const tinyImage = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="%234c7dff"/><text x="8" y="26" fill="white">JOI</text></svg>');
const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>Joi Browser Harness</title></head>
<body style="font:28px -apple-system;min-height:2400px">
  <h1>JOI BROWSER REAL CONTROL</h1>
  <input id="name" placeholder="type here"><button id="submit">Apply</button>
  <input id="file" type="file"><button id="popup">Popup</button>
  <div id="output">idle</div><img src="${tinyImage}" alt="Joi fixture">
  <script>
    console.log('harness-ready');
    fetch('/api').then(r => r.json()).then(v => console.log('api:' + v.ok));
    document.querySelector('#submit').onclick = () => {
      const value = document.querySelector('#name').value;
      document.querySelector('#output').textContent = 'submitted:' + value;
      console.log('button:' + value);
    };
    document.querySelector('#popup').onclick = () => window.open('/second', '_blank');
  </script>
</body></html>`;

const server = createServer((req, res) => {
  if (req.url === '/api') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url === '/second') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Second Tab</title><h1>SECOND JOI TAB</h1>');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page);
});

const manager = new BrowserWorkbenchManager();
const evidence: Record<string, unknown> = {};

async function runHarness(): Promise<void> {
  process.stdout.write('browser-harness:electron-ready\n');
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('browser fixture server did not bind');
  const baseURL = `http://127.0.0.1:${address.port}`;
  try {
    process.stdout.write(`browser-harness:fixture=${baseURL}\n`);
    const opened = await manager.execute({ action: 'open', url: baseURL, visible: false });
    process.stdout.write('browser-harness:opened\n');
    assert.match(opened.session_id, /^browser_/);
    assert.equal(opened.title, 'Joi Browser Harness');
    const sessionID = opened.session_id;
    const tabID = opened.active_tab_id!;

    const observed = await manager.execute({ action: 'observe', session_id: sessionID, tab_id: tabID });
    assert.match(observed.text || '', /JOI BROWSER REAL CONTROL/);
    assert.ok(Array.isArray((observed.result as { interactive?: unknown[] }).interactive));

    const typed = await manager.execute({ action: 'type', session_id: sessionID, tab_id: tabID, selector: '#name', text: 'full-control' });
    assert.equal((typed.result as { value?: string }).value, 'full-control');
    await manager.execute({ action: 'click', session_id: sessionID, tab_id: tabID, selector: '#submit' });
    const evaluated = await manager.execute({ action: 'evaluate', session_id: sessionID, tab_id: tabID, expression: 'document.querySelector("#output").textContent' });
    assert.equal(evaluated.result, 'submitted:full-control');

    const scrolled = await manager.execute({ action: 'scroll', session_id: sessionID, tab_id: tabID, delta_y: 900 });
    assert.ok(Number((scrolled.result as { y?: number }).y) > 0);
    const images = await manager.execute({ action: 'get_images', session_id: sessionID, tab_id: tabID });
    assert.equal(images.images?.[0]?.alt, 'Joi fixture');

    const uploadPath = `${app.getPath('temp')}/joi-browser-upload.txt`;
    writeFileSync(uploadPath, 'joi upload fixture');
    const uploaded = await manager.execute({ action: 'upload', session_id: sessionID, tab_id: tabID, selector: '#file', paths: [uploadPath] });
    assert.equal((uploaded.result as { paths?: string[] }).paths?.[0], uploadPath);

    const screenshot = await manager.execute({ action: 'screenshot', session_id: sessionID, tab_id: tabID });
    assert.ok(screenshot.screenshot_path && existsSync(screenshot.screenshot_path));
    process.stdout.write('browser-harness:screenshot\n');
    const vision = await analyzeImageFile(screenshot.screenshot_path!, `${app.getPath('temp')}/joi-browser-vision`);
    process.stdout.write('browser-harness:vision\n');
    assert.equal(vision.status, 'completed');
    assert.ok(Number(vision.width) > 0 && Number(vision.height) > 0);

    const consoleResult = await manager.execute({ action: 'console', session_id: sessionID, tab_id: tabID });
    assert.match(JSON.stringify(consoleResult.console), /button:full-control/);
    const network = await manager.execute({ action: 'network', session_id: sessionID, tab_id: tabID });
    assert.match(JSON.stringify(network.network), /\/api/);
    const cdp = await manager.execute({ action: 'cdp', session_id: sessionID, tab_id: tabID, method: 'Runtime.evaluate', params: { expression: '6 * 7', returnByValue: true } });
    assert.equal((cdp.result as { result?: { value?: number } }).result?.value, 42);

    await manager.execute({ action: 'click', session_id: sessionID, tab_id: tabID, selector: '#popup' });
    process.stdout.write('browser-harness:popup-clicked\n');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const tabs = await manager.execute({ action: 'list_tabs', session_id: sessionID });
    assert.equal(tabs.tabs?.length, 2);
    const secondTab = tabs.tabs?.find((tab) => tab.id !== tabID);
    assert.ok(secondTab);
    await manager.execute({ action: 'activate_tab', session_id: sessionID, tab_id: secondTab!.id });
    const secondObserved = await manager.execute({ action: 'observe', session_id: sessionID, tab_id: secondTab!.id });
    assert.match(secondObserved.text || '', /SECOND JOI TAB/);
    await manager.execute({ action: 'close_tab', session_id: sessionID, tab_id: secondTab!.id });

    evidence.opened = opened;
    evidence.observed = observed;
    evidence.vision = vision;
    evidence.console = consoleResult.console;
    evidence.network_event_count = network.network?.length || 0;
    evidence.cdp = cdp.result;
    evidence.tabs = tabs.tabs;
    const evidenceDir = process.env.JOI_EVIDENCE_DIR;
    if (evidenceDir) {
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(`${evidenceDir}/browser-workbench-result.json`, `${JSON.stringify(evidence, null, 2)}\n`);
    }
    await manager.execute({ action: 'close', session_id: sessionID });
    console.log('browser workbench real-control tests passed');
  } finally {
    manager.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    app.quit();
  }
}

process.stdout.write('browser-harness:waiting-electron-ready\n');
void app.whenReady().then(runHarness).catch((error) => {
  console.error(error);
  app.exit(1);
});
