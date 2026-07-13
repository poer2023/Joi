import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const outDir = mkdtempSync(join(tmpdir(), 'joi-single-agent-workspace-'));
const esbuildBin = [
  join(root, '..', '..', '..', 'node_modules', '.pnpm', 'esbuild@0.27.7', 'node_modules', '@esbuild', 'darwin-arm64', 'bin', 'esbuild'),
  join(root, '..', '..', '..', 'node_modules', '.pnpm', 'node_modules', '.bin', 'esbuild'),
  join(root, 'node_modules', '.bin', 'esbuild'),
].find((candidate) => existsSync(candidate)) || 'node_modules/.bin/esbuild';

try {
  const entry = join(outDir, 'entry.ts');
  const bundle = join(outDir, 'bundle.mjs');
  writeFileSync(entry, `export * from '${root}/src/features/workspace/singleAgentWorkspace.ts';`);
  execFileSync(esbuildBin, [entry, '--bundle', '--format=esm', '--platform=node', '--target=es2020', '--outfile=' + bundle], { cwd: root, stdio: 'inherit' });
  const workspace = await import(pathToFileURL(bundle).href);

  const messenger = {
    rooms: [
      { id: 'room_hub', type: 'private_hub', title: '私人总群', conversation_id: 'conv_hub' },
      { id: 'room_ops', type: 'project_dm', title: 'Rune Ops', persona_id: 'persona_ops', conversation_id: 'conv_ops' },
      { id: 'room_joi', type: 'project_dm', title: 'Joi', persona_id: 'persona_joi', conversation_id: 'conv_joi' },
    ],
    personas: [
      { id: 'persona_ops', display_name: 'Rune Ops', handle: '@rune-ops' },
      { id: 'persona_joi', display_name: 'Joi', handle: '@joi-desktop' },
    ],
  };
  assert.equal(workspace.selectPrimaryJoiRoom(messenger).id, 'room_joi');

  const conversations = [
    { id: 'conv_hub', title: '私人总群', channel: 'desktop' },
    { id: 'conv_ops', title: 'Rune Ops', channel: 'desktop' },
    { id: 'conv_joi', title: 'Joi', channel: 'desktop' },
    { id: 'conv_external', title: '家庭计划', channel: 'imessage', last_message: '周末出发' },
  ];
  assert.deepEqual(
    workspace.visibleSingleAgentConversations(conversations, messenger).map((item) => item.id),
    ['conv_joi', 'conv_external'],
  );
  assert.deepEqual(
    workspace.filterSingleAgentConversations(conversations, '周末').map((item) => item.id),
    ['conv_external'],
  );
  assert.equal(workspace.conversationChannelLabel('imessage'), 'iMessage');

  const appSource = readFileSync(join(root, 'src', 'App.tsx'), 'utf8');
  const sidebarSource = appSource.slice(appSource.indexOf('function ConversationSidebar'), appSource.indexOf('function compactRoomLastMessage'));
  assert.doesNotMatch(sidebarSource, /item\.last_message/, 'the thread sidebar must not render message previews');
  assert.doesNotMatch(sidebarSource, /item\.channel/, 'the thread sidebar must not render channel labels');
  assert.match(sidebarSource, /<strong>\{conversationTitle\(item\)\}<\/strong>/, 'the thread sidebar must keep the title');
  assert.match(sidebarSource, /<time>\{formatShortTime\(item\.updated_at\)\}<\/time>/, 'the thread sidebar must keep the date');

  const stylesSource = readFileSync(join(root, 'src', 'styles.css'), 'utf8');
  assert.match(stylesSource, /\.conversation-chat-item\s*\{[^}]*min-height:\s*32px;[^}]*padding:\s*4px 8px 4px 10px;/s, 'thread rows must use the compact single-line geometry');
  assert.match(stylesSource, /\.thread-list-copy strong\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s, 'long titles must stay on one line');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
