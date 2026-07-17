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
  assert.match(sidebarSource, /aria-current=\{activeTab === 'today' \? 'page' : undefined\}/, 'Today must be a fixed top-level sidebar destination');
  assert.match(sidebarSource, /className=\{`sidebar-today-item/, 'Today must not be rendered as a conversation row');
  assert.match(sidebarSource, /sidebar-today-count/, 'Today must expose its actionable item count');

  const chatHomeSource = appSource.slice(appSource.indexOf('function ChatHome'), appSource.indexOf('function MessengerChatHeader'));
  assert.match(chatHomeSource, /useState<RightInspectorTab>\('conversation'\)/, 'the inspector must default to a visible permanent tab after overview leaves the tab strip');
  assert.match(chatHomeSource, /onOpenProfile=\{\(\) => \{[\s\S]*setRightInspectorTab\('overview'\);[\s\S]*setRightPanelPreference\('expanded'\);/, 'the chat identity must open the preserved profile surface directly');
  assert.match(chatHomeSource, /const conversationTreeOpen = !rightPanelCollapsed && rightInspectorTab === 'conversation';/, 'the conversation tree must derive its open state from the right inspector');
  assert.doesNotMatch(chatHomeSource, /toggleConversationTreeInspector|onOpenConversationTree/, 'the titlebar must not retain an independent conversation-tree control');
  assert.match(chatHomeSource, /if \(conversationTree\?\.active_conversation_id === assetConversationID\) return;/, 'returning to the conversation-tree tab must not refresh away unsaved local drafts');
  assert.match(chatHomeSource, /conversationTreePanel=\{\([\s\S]*<ConversationTreeInspectorPanel/, 'the conversation tree must render through the right inspector');
  assert.doesNotMatch(chatHomeSource, /\{conversationTreeOpen \? \([\s\S]*<Conversation/, 'the conversation tree must not render as a floating transcript layer');

  const chatHeaderSource = appSource.slice(appSource.indexOf('function MessengerChatHeader'), appSource.indexOf('function ConversationTreeInspectorPanel'));
  assert.doesNotMatch(chatHeaderSource, /onOpenToday|TodayIcon/, 'the chat titlebar must not duplicate the fixed Today destination');
  assert.doesNotMatch(chatHeaderSource, /ConversationTreeIcon|conversation-tree-button|打开会话分支|onOpenConversationTree/, 'the chat titlebar must not expose a separate branch shortcut');
  assert.match(chatHeaderSource, /handleTitlebarControlPointerUp\(event, onOpenInspector\)/, 'the inspector must activate on pointerup outside the draggable titlebar');
  assert.match(chatHeaderSource, /aria-label="打开会话资料"[\s\S]*handleTitlebarControlPointerUp\(event, onOpenProfile\)/, 'avatar and conversation identity must open profile through a real titlebar-safe button');

  const inspectorSource = appSource.slice(appSource.indexOf('function CompanionInspectorPanel'), appSource.indexOf('function CompanionTerminalPanel'));
  assert.doesNotMatch(inspectorSource, /\['overview', '概览'\]/, 'overview must not remain a permanent inspector tab');
  assert.match(inspectorSource, /const staticTabs[\s\S]*\['conversation', '分支'\][\s\S]*\['runs', '运行'\][\s\S]*\['assets', '产物'\][\s\S]*\['memory', '记忆'\]/, 'the permanent inspector tabs must keep the agreed four-item order');
  assert.match(inspectorSource, /effectiveTab === 'overview' \? \([\s\S]*<MessengerOverviewPanel/, 'the existing profile surface must remain available as a direct destination');
  assert.match(inspectorSource, /\['conversation', '分支'\]/, 'the right inspector must expose a plainly named branch tab');
  assert.match(inspectorSource, /effectiveTab === 'conversation' \? \(\s*conversationTreePanel/, 'the conversation-tree tab must render its retained panel content');

  const conversationTreePanelSource = appSource.slice(appSource.indexOf('function ConversationTreeInspectorPanel'), appSource.indexOf('function ConversationTreeRows'));
  assert.match(conversationTreePanelSource, /id="right-inspector-conversation"[\s\S]*role="tabpanel"[\s\S]*aria-labelledby="right-inspector-tab-conversation"/, 'the conversation tree must use the inspector tabpanel contract');
  assert.doesNotMatch(conversationTreePanelSource, /role="dialog"|ui-popover-surface|useLayerLifecycle/, 'the conversation tree must no longer behave like a popover');
  assert.doesNotMatch(conversationTreePanelSource, /<header>|onRefresh|>刷新<|conversation-tree-empty-state|当前会话还没有分支/, 'the branch tab must not repeat a page header, manual refresh, or empty-state card');
  assert.match(conversationTreePanelSource, /只跟随当前会话，不包含其他历史会话/, 'the branch panel must explain its current-conversation scope');
  assert.match(conversationTreePanelSource, /尚无其他分支/, 'a single-node tree must keep one compact honest status');
  assert.match(conversationTreePanelSource, /className="conversation-branch-create"[\s\S]*>从这里新开分支<\/[\s\S]*<details className="conversation-workbench-advanced">/, 'the primary branch action must remain on the simple surface before advanced maintenance');
  assert.match(conversationTreePanelSource, /<details className="conversation-workbench-advanced">/, 'context compaction and portability must be grouped as advanced actions');
  assert.match(conversationTreePanelSource, /<details className="conversation-workbench-advanced">[\s\S]*当前版本信息[\s\S]*保存版本信息/, 'version naming and description must remain available inside advanced actions');

  const todayPageSource = appSource.slice(appSource.indexOf('function TodayCheckpointPage'), appSource.indexOf('function checkpointItemMark'));
  assert.match(todayPageSource, /className="today-page"/, 'Today must render as a full workspace page');
  assert.doesNotMatch(todayPageSource, /role="dialog"|aria-modal|today-checkpoint-backdrop|useLayerLifecycle/, 'Today must not retain modal behavior');
  assert.match(todayPageSource, /items\.filter\(isVisibleTodayCheckpointItem\)/, 'Today must remove quiet and duplicate total rows from its visible queue');
  assert.match(todayPageSource, /meaningfulItems\.map/, 'Today must list actionable items rather than quiet placeholders');

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
  assert.match(stylesSource, /\.messenger-chat-header\s*\{[^}]*-webkit-app-region:\s*no-drag;/s, 'the chat header must not remain one monolithic Electron drag region');
  assert.match(stylesSource, /\.im-app-shell\.sidebar-collapsed \.messenger-chat-header\s*\{[^}]*padding-left:\s*148px;/s, 'collapsed chat identity must clear the traffic lights and sidebar expand control');
  assert.match(stylesSource, /\.messenger-chat-header > \.messenger-chat-identity\s*\{[^}]*-webkit-app-region:\s*drag;/s, 'only the non-interactive identity column should retain window dragging');
  assert.match(stylesSource, /\.messenger-chat-header \.messenger-chat-profile-button,[\s\S]*-webkit-app-region:\s*no-drag;/, 'the profile button and its contents must stay outside the Electron drag region');
  assert.match(stylesSource, /\.messenger-chat-header > \.observe-button,\s*\.messenger-chat-header > \.observe-button \*\s*\{[^}]*pointer-events:\s*auto;[^}]*-webkit-app-region:\s*no-drag;/s, 'chat-header controls and icons must stay outside the Electron drag region');
  assert.match(stylesSource, /\.companion-right-panel\.collapsed \.right-inspector-header,\s*\.companion-right-panel\.collapsed \.right-inspector-header-drag-spacer\s*\{[^}]*-webkit-app-region:\s*no-drag;/s, 'a collapsed inspector must not leave an invisible native drag region over chat controls');
  assert.match(stylesSource, /\.conversation-workbench-panel\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*0;[^}]*background:\s*var\(--tk-surface-app\);/s, 'the conversation tree must fill the existing inspector surface');
  assert.match(stylesSource, /\.messenger-chat-header\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto auto;/s, 'the titlebar must reserve compact controls for immersive mode and the inspector');
  assert.match(appSource, /const \[immersiveMode, setImmersiveMode\] = useState\(false\);/, 'chat must own a reversible immersive state');
  assert.match(appSource, /event\.metaKey[\s\S]*event\.shiftKey[\s\S]*event\.key\.toLowerCase\(\) === 'f'/, 'Command+Shift+F must toggle immersive mode');
  assert.match(chatHomeSource, /aria-label="退出沉浸模式"[\s\S]*className="immersive-mode-restore-button"/, 'immersive chat must expose one restore control');
  assert.match(chatHomeSource, /\{!immersiveMode \? \(\s*<form ref=\{composerRef\}/s, 'immersive chat must remove the composer while retaining its React state');
  assert.match(stylesSource, /\.immersive-mode \.chat-thread\s*\{[^}]*margin-bottom:\s*0;/s, 'immersive messages must not reserve composer space');
  assert.match(stylesSource, /\.immersive-mode-restore-button\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;[^}]*-webkit-app-region:\s*no-drag;/s, 'immersive restore control must remain lightweight and clickable');
  assert.match(stylesSource, /\.conversation-workbench-panel\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) auto;/s, 'the branch panel must not reserve a duplicate internal header row');
  assert.match(stylesSource, /\.conversation-workbench-content\s*\{[^}]*display:\s*grid;[^}]*padding:\s*0 16px 20px;/s, 'the simplified branch panel must use one continuous scroll surface');
  assert.doesNotMatch(stylesSource, /\.conversation-tree-empty-state\s*\{|\.conversation-workbench-panel > header\s*\{/, 'obsolete duplicate branch structures must be removed');
  assert.match(stylesSource, /\.sidebar-today-item\s*\{[^}]*grid-template-columns:\s*18px minmax\(0, 1fr\) auto;/s, 'Today must use a compact fixed sidebar row');
  assert.match(stylesSource, /\.today-page\s*\{[^}]*height:\s*100%;[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\);/s, 'Today must occupy the workspace without an overlay');
  assert.doesNotMatch(stylesSource, /\.today-checkpoint-backdrop\s*\{/, 'the obsolete Today modal backdrop must be removed');
  assert.doesNotMatch(stylesSource, /\.conversation-workbench-popover\s*\{/, 'the obsolete floating conversation-tree surface must be removed');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
