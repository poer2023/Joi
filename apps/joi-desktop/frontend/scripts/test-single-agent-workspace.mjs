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
    { id: 'conv_telegram', title: '每日推荐', channel: 'telegram', last_message: '已返回八张图' },
  ];
  assert.deepEqual(
    workspace.visibleSingleAgentConversations(conversations, messenger).map((item) => item.id),
    ['conv_joi', 'conv_external', 'conv_telegram'],
  );
  assert.deepEqual(
    workspace.filterSingleAgentConversations(conversations, '周末').map((item) => item.id),
    ['conv_external'],
  );
  assert.equal(workspace.conversationChannelLabel('imessage'), 'iMessage');
  assert.equal(workspace.conversationChannelLabel('telegram'), 'Telegram');
  assert.equal(workspace.isMessagingConversationChannel('telegram'), true);
  assert.equal(workspace.isMessagingConversationChannel('desktop'), false);
  assert.deepEqual(
    workspace.splitSingleAgentConversations(workspace.visibleSingleAgentConversations(conversations, messenger)),
    {
      channels: [conversations[3], conversations[4]],
      threads: [conversations[2]],
    },
  );
  assert.deepEqual(
    workspace.filterSingleAgentConversations(conversations, 'telegram').map((item) => item.id),
    ['conv_telegram'],
  );

  const appSource = readFileSync(join(root, 'src', 'App.tsx'), 'utf8');
  const sidebarSource = appSource.slice(appSource.indexOf('function ConversationSidebar'), appSource.indexOf('function compactRoomLastMessage'));
  assert.doesNotMatch(sidebarSource, /item\.last_message/, 'the thread sidebar must not render message previews');
  assert.match(sidebarSource, /splitSingleAgentConversations\(conversations\)/, 'the sidebar must separate messaging channels from local threads');
  assert.match(sidebarSource, /channel-source-badge/, 'the sidebar must render a visible source badge for channel rows');
  assert.match(sidebarSource, /conversationChannelLabel\(item\.channel\)/, 'the channel row must render its human-readable source');
  assert.match(sidebarSource, /<strong>\{conversationTitle\(item\)\}<\/strong>/, 'the thread sidebar must keep the title');
  assert.doesNotMatch(sidebarSource, /<small>\{conversationTitle\(item\)\}<\/small>/, 'the compact channel row must not repeat the conversation title');
  assert.match(sidebarSource, /<time>\{formatShortTime\(item\.updated_at\)\}<\/time>/, 'the thread sidebar must keep the date');
  assert.doesNotMatch(sidebarSource, /sidebar-user-name/, 'the sidebar footer must not repeat the user name beside the avatar');

  const stylesSource = readFileSync(join(root, 'src', 'styles.css'), 'utf8');
  assert.match(stylesSource, /\.conversation-chat-item\s*\{[^}]*min-height:\s*32px;[^}]*padding:\s*4px 8px 4px 10px;/s, 'thread rows must use the compact single-line geometry');
  assert.doesNotMatch(stylesSource, /\.channel-conversation-row \.conversation-chat-item\s*\{[^}]*min-height:\s*46px;/s, 'channel rows must not reserve a removed subtitle line');
  assert.match(stylesSource, /\.channel-source-telegram\s*\{[^}]*rgba\(34, 158, 217, 0\.12\);[^}]*#147fb4;/s, 'Telegram must have a restrained recognizable source color');
  assert.match(stylesSource, /\.thread-list-copy strong\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s, 'long titles must stay on one line');
  assert.match(stylesSource, /\.conversation-list\.tk-sidebar-scroll\s*\{[^}]*padding:\s*0;/s, 'sidebar sections must share the heading and footer width');
  assert.match(stylesSource, /--chat-message-side-rail:\s*calc\(var\(--chat-message-avatar-size\) \+ var\(--chat-message-column-gap\)\);/, 'the message side rail must derive from avatar size and column gap');
  assert.match(stylesSource, /\.composer\s*\{[^}]*width:\s*min\(var\(--chat-bubble-column-max-width\), calc\(100% - var\(--chat-bubble-column-inline-space\)\)\);/s, 'composer must use the shared responsive bubble-column width');
  assert.match(stylesSource, /\.chat-message-scroller-content\s*\{[^}]*width:\s*min\(var\(--chat-column-max-width\), calc\(100% - var\(--chat-column-inline-space\)\)\);/s, 'message rows must use the shared responsive chat column width');
  assert.match(stylesSource, /\.joi-thread-header-avatar\s*\{[^}]*border-radius:\s*50%;/s, 'the header Joi avatar must be circular');
  assert.match(stylesSource, /\.message-avatar\s*\{[^}]*border-radius:\s*50%;/s, 'message avatars must be circular');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
