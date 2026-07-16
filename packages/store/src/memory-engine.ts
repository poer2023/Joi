export type MemoryLayer = 'profile' | 'knowledge' | 'state' | 'episode';

export type MemoryEvidenceKind =
  | 'correction'
  | 'explicit'
  | 'repeated_behavior'
  | 'behavior'
  | 'task_outcome'
  | 'legacy';

export type MemoryObservationDraft = {
  layer: MemoryLayer;
  type: string;
  statement: string;
  summary: string;
  memoryKey: string;
  evidenceKind: MemoryEvidenceKind;
  evidenceAuthority: number;
  confidence: number;
  scopeType: 'global' | 'user' | 'room' | 'project';
  scopeID: string;
  privacyLevel: 'public' | 'internal' | 'private';
  contextTags: string[];
  polarity: -1 | 0 | 1;
  explicit: boolean;
  correction: boolean;
  reviewRequired: boolean;
  reviewReason: string;
  expiresAt?: string;
  why: string;
  futureEffect: string;
};

export type MemoryExtractionContext = {
  projectID?: string;
  roomID?: string;
  userID?: string;
  now?: Date;
  stateTTLDays?: number;
};

export type MemoryPolicyConfig = {
  version: number;
  use_memories: boolean;
  generate_memories: boolean;
  disable_on_external_context: boolean;
  background_idle_seconds: number;
  stable_profile_limit: number;
  dynamic_limit: number;
  relevance_threshold: number;
  state_ttl_days: number;
  provisional_retention_days: number;
  episode_retention_days: number;
  implicit_promotion_evidence: number;
  physical_delete_automatic: boolean;
};

export const MEMORY_PIPELINE_VERSION = 'memory_os_v3_codex_alma';
export const LOCAL_MEMORY_EMBEDDING_MODEL = 'joi-local-feature-v1';

export const DEFAULT_MEMORY_POLICY: MemoryPolicyConfig = {
  version: 3,
  use_memories: true,
  generate_memories: true,
  disable_on_external_context: true,
  background_idle_seconds: 300,
  stable_profile_limit: 8,
  dynamic_limit: 6,
  relevance_threshold: 0.48,
  state_ttl_days: 14,
  provisional_retention_days: 90,
  episode_retention_days: 365,
  implicit_promotion_evidence: 3,
  physical_delete_automatic: false,
};

const DURABLE_MARKERS = /(?:请记住|帮我记|记住[:：]?|以后|从现在开始|今后|后续都|总是|一直|默认|我的偏好|我偏好|我更喜欢|我喜欢|我不喜欢|我讨厌|我习惯|我希望|i\s+(?:prefer|like|dislike|always|never))/iu;
const EXPLICIT_REMEMBER_COMMAND = /^(?:(?:请|麻烦|请你|麻烦你)\s*)?(?:记住|帮我记(?:住)?)(?:[:：,，\s]|$)/iu;
const CORRECTION_MARKERS = /(?:更正(?:一下|[:：]|为|成)|纠正(?:一下|[:：]|为|成)|改成|不是.+而是|我不再|以后别|以后不要|之前.+不对|actually|instead|no longer)/iu;
const REPEATED_BEHAVIOR_MARKERS = /(?:我)?(?:通常|经常|常常|一般会|倾向于|往往|多数时候|typically|usually|often|tend to)/iu;
const CURRENT_STATE_MARKERS = /(?:我现在|我目前|我最近|这几天|这周|今天|此刻|currently|right now|lately)/iu;
const PROJECT_MARKERS = /(?:项目|仓库|代码库|路径|服务器|主机|NAS|路由器|数据库|部署|构建|Joi|工程|workspace|repository|server|database|deploy)/iu;
const RULE_MARKERS = /(?:必须|不要|别|优先|默认|先.+再|只能|禁止|should|must|never|always)/iu;
const PREFERENCE_MARKERS = /(?:我(?:更)?喜欢|我不喜欢|我讨厌|我偏好|我的偏好|我习惯|我希望|对我来说|给我.+优先|i\s+(?:prefer|like|dislike|want))/iu;
const SESSION_ONLY_MARKERS = /(?:仅本轮|只在本轮|这次|本次|这一轮|当前会话|临时|只回复|只运行|测试|验收|暗号|验证码)/iu;
const DO_NOT_STORE_MARKERS = /(?:不要记住|别记住|不要写入(?:长期)?记忆|不要保存|do not remember|don't remember)/iu;
const SECRET_MARKERS = /(?:密码|验证码|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|private[_ -]?key|client[_ -]?secret|secret)/iu;
const SENSITIVE_INFERENCE_MARKERS = /(?:身份证|护照|银行卡|住址|家庭地址|精确位置|病史|疾病|诊断|药物|收入|工资|资产|债务|政治立场|宗教|性取向|婚姻|怀孕|medical|diagnosis|salary|income|politic|religion|sexual)/iu;

export function memoryGenerationExclusionReason(message: string): string {
  const text = normalizeWhitespace(message);
  if (!text) return 'empty_input';
  if (DO_NOT_STORE_MARKERS.test(text)) return 'user_requested_no_memory';
  if (SECRET_MARKERS.test(text)) return 'secret_content';
  if (SESSION_ONLY_MARKERS.test(text) && !DURABLE_MARKERS.test(text) && !CORRECTION_MARKERS.test(text)) return 'session_only';
  if (isInterrogativeMemoryPrompt(text)) return 'interrogative_prompt';
  return '';
}

export function isInterrogativeMemoryPrompt(message: string): boolean {
  const text = normalizeWhitespace(message);
  return /[?？]/u.test(text) && !EXPLICIT_REMEMBER_COMMAND.test(text);
}

export function extractMemoryObservations(message: string, context: MemoryExtractionContext = {}): MemoryObservationDraft[] {
  const text = normalizeWhitespace(message).slice(0, 2_000);
  if (memoryGenerationExclusionReason(text)) return [];

  const correction = CORRECTION_MARKERS.test(text);
  const preference = PREFERENCE_MARKERS.test(text);
  const repeatedBehavior = REPEATED_BEHAVIOR_MARKERS.test(text);
  const currentState = CURRENT_STATE_MARKERS.test(text) && !DURABLE_MARKERS.test(text);
  const projectRule = PROJECT_MARKERS.test(text) && RULE_MARKERS.test(text);
  const explicit = EXPLICIT_REMEMBER_COMMAND.test(text) || DURABLE_MARKERS.test(text) || correction;
  if (!explicit && !preference && !repeatedBehavior && !currentState && !projectRule) return [];

  const statement = cleanObservationStatement(text);
  if (statement.length < 3) return [];
  const layer: MemoryLayer = currentState ? 'state' : projectRule ? 'knowledge' : 'profile';
  const type = inferObservationType(statement, layer, projectRule);
  const scopeType: MemoryObservationDraft['scopeType'] = layer === 'knowledge' && context.projectID
    ? 'project'
    : layer === 'state' && context.roomID
      ? 'room'
      : layer === 'profile' || layer === 'state'
        ? 'user'
        : context.projectID
          ? 'project'
          : 'global';
  const scopeID = scopeType === 'project'
    ? context.projectID || ''
    : scopeType === 'room'
      ? context.roomID || ''
      : scopeType === 'user'
        ? context.userID || 'desktop_user'
        : '';
  const sensitiveInference = SENSITIVE_INFERENCE_MARKERS.test(statement) && !explicit;
  const privacyLevel: MemoryObservationDraft['privacyLevel'] = SENSITIVE_INFERENCE_MARKERS.test(statement) ? 'private' : 'internal';
  const evidenceKind: MemoryEvidenceKind = correction
    ? 'correction'
    : explicit
      ? 'explicit'
      : repeatedBehavior
        ? 'repeated_behavior'
        : 'behavior';
  const now = context.now || new Date();
  const expiresAt = layer === 'state'
    ? new Date(now.getTime() + Math.max(1, context.stateTTLDays || DEFAULT_MEMORY_POLICY.state_ttl_days) * 86_400_000).toISOString()
    : undefined;
  const contextTags = inferMemoryContextTags(statement);
  return [{
    layer,
    type,
    statement,
    summary: summarizeObservation(statement, layer),
    memoryKey: canonicalMemoryKey(statement, layer, type, contextTags),
    evidenceKind,
    evidenceAuthority: memoryEvidenceAuthority(evidenceKind),
    confidence: correction ? 0.98 : explicit ? 0.9 : currentState ? 0.8 : projectRule ? 0.74 : 0.68,
    scopeType,
    scopeID,
    privacyLevel,
    contextTags,
    polarity: inferMemoryPolarity(statement),
    explicit,
    correction,
    reviewRequired: explicit || sensitiveInference,
    reviewReason: sensitiveInference ? 'sensitive_inference_requires_review' : explicit ? 'explicit_memory_requires_confirmation' : '',
    expiresAt,
    why: correction
      ? '用户明确纠正了既有事实或偏好。'
      : explicit
        ? '用户明确表达了可复用的长期事实、偏好或规则。'
        : currentState
          ? '用户表达了有时间边界的当前状态。'
          : '系统观察到可能重复出现的偏好或工作方式。',
    futureEffect: layer === 'state'
      ? `在 ${expiresAt?.slice(0, 10)} 前作为当前状态参考，之后自动归档。`
      : explicit
        ? '确认后在后续相关场景应用，直到用户纠正、停用或删除。'
        : '出现足够多独立证据后才会进入稳定记忆。',
  }];
}

export function createTaskEpisodeObservation(input: {
  request: string;
  outcome: string;
  projectID?: string;
  userID?: string;
  now?: Date;
}): MemoryObservationDraft | null {
  const request = normalizeWhitespace(input.request).slice(0, 500);
  const outcome = normalizeWhitespace(input.outcome).slice(0, 700);
  if (!request || !outcome || SECRET_MARKERS.test(`${request} ${outcome}`) || DO_NOT_STORE_MARKERS.test(request)) return null;
  const statement = `任务：${request}\n结果：${outcome}`;
  const contextTags = [...new Set(['task', ...inferMemoryContextTags(`${request} ${outcome}`)])];
  const now = input.now || new Date();
  return {
    layer: 'episode',
    type: 'episode',
    statement,
    summary: `任务情节：${request.slice(0, 64)}${request.length > 64 ? '…' : ''}`,
    memoryKey: canonicalMemoryKey(request, 'episode', 'episode', contextTags),
    evidenceKind: 'task_outcome',
    evidenceAuthority: memoryEvidenceAuthority('task_outcome'),
    confidence: 0.82,
    scopeType: input.projectID ? 'project' : 'user',
    scopeID: input.projectID || input.userID || 'desktop_user',
    privacyLevel: SENSITIVE_INFERENCE_MARKERS.test(statement) ? 'private' : 'internal',
    contextTags,
    polarity: 0,
    explicit: false,
    correction: false,
    reviewRequired: false,
    reviewReason: '',
    expiresAt: new Date(now.getTime() + DEFAULT_MEMORY_POLICY.episode_retention_days * 86_400_000).toISOString(),
    why: '已完成的严肃任务形成了可追溯的任务情节。',
    futureEffect: '后续相似任务可召回本次结果；到期后自动归档。',
  };
}

export function inferLegacyMemoryLayer(type: string, metadata: Record<string, unknown> = {}): MemoryLayer {
  const explicitLayer = String(metadata.layer || '').toLowerCase();
  if (['profile', 'knowledge', 'state', 'episode'].includes(explicitLayer)) return explicitLayer as MemoryLayer;
  const normalized = type.toLowerCase();
  if (['user_preference', 'working_preference', 'preference', 'workflow_rule', 'workflow_preference', 'anti_preference', 'anti_pattern', 'heuristic'].includes(normalized)) return 'profile';
  if (['current_state', 'user_state', 'relationship_state'].includes(normalized)) return 'state';
  if (['episode', 'outcome', 'decision'].includes(normalized)) return 'episode';
  return 'knowledge';
}

export function memoryEvidenceAuthority(kind: string): number {
  switch (kind) {
    case 'correction': return 100;
    case 'explicit': return 90;
    case 'repeated_behavior': return 70;
    case 'task_outcome': return 65;
    case 'behavior': return 50;
    default: return 20;
  }
}

export function inferMemoryPolarity(text: string): -1 | 0 | 1 {
  if (/(?:不喜欢|讨厌|不要|别|禁止|不再|never|dislike|do not|don't)/iu.test(text)) return -1;
  if (/(?:喜欢|偏好|希望|优先|默认|prefer|like|want|always)/iu.test(text)) return 1;
  return 0;
}

export function canonicalMemoryKey(statement: string, layer: MemoryLayer, type: string, tags: string[] = []): string {
  const subject = statement
    .toLowerCase()
    .replace(/(?:请记住|帮我记|记住|以后|从现在开始|今后|我的偏好|我偏好|我更喜欢|我喜欢|我不喜欢|我讨厌|我习惯|我希望|不要|别|总是|一直|默认|更正|纠正|改成|不再|通常|经常|常常|一般会|倾向于|往往|多数时候|我|i\s+(?:prefer|like|dislike|want|always|never)|typically|usually|often|tend\s+to)/giu, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/giu, '')
    .slice(0, 240);
  const topicType = layer === 'profile' && ['user_preference', 'anti_preference'].includes(type) ? 'preference' : type;
  return `${layer}:${topicType}:${stableHash(`${subject}|${[...new Set(tags)].sort().join('|')}`)}`;
}

export function inferMemoryContextTags(text: string): string[] {
  const tags: string[] = [];
  const add = (tag: string) => { if (!tags.includes(tag)) tags.push(tag); };
  if (/(?:图片|图像|照片|image|photo)/iu.test(text)) add('output:image');
  if (/(?:链接|网址|url|link)/iu.test(text)) add('output:link');
  if (/(?:简短|精简|直接|一句|concise|brief)/iu.test(text)) add('communication:concise');
  if (/(?:详细|完整|深度|全面|architecture|架构)/iu.test(text)) add('communication:deep');
  if (/(?:代码|工程|仓库|测试|构建|部署|runtime|code|test|build)/iu.test(text)) add('domain:engineering');
  if (/(?:设计|视觉|界面|审美|design|visual|ui)/iu.test(text)) add('domain:design');
  if (/(?:吃|食物|餐厅|菜|咖啡|茶|food|coffee|restaurant)/iu.test(text)) add('domain:food');
  if (/(?:电影|音乐|游戏|书|阅读|movie|music|game|book)/iu.test(text)) add('domain:media');
  if (/(?:旅行|酒店|航班|travel|hotel|flight)/iu.test(text)) add('domain:travel');
  if (tags.length === 0) add('context:general');
  return tags;
}

export function memorySearchFeatures(text: string): string[] {
  const normalized = text.toLowerCase();
  const features = new Set<string>();
  for (const word of normalized.match(/[a-z0-9_]{2,}/giu) || []) features.add(word);
  for (const run of normalized.match(/[\u4e00-\u9fff]{2,}/gu) || []) {
    if (run.length <= 8) features.add(run);
    for (let size = 2; size <= 3; size += 1) {
      for (let index = 0; index <= run.length - size; index += 1) features.add(run.slice(index, index + size));
    }
  }
  return [...features].slice(0, 512);
}

export function localMemoryVector(text: string, dimensions = 192): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  for (const feature of memorySearchFeatures(text)) {
    const hash = stableHashNumber(feature);
    const index = hash % dimensions;
    vector[index] += ((hash >>> 8) & 1) === 0 ? 1 : -1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? vector.map((value) => Number((value / norm).toFixed(6))) : vector;
}

export function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    dot += (left[index] || 0) * (right[index] || 0);
    leftNorm += (left[index] || 0) ** 2;
    rightNorm += (right[index] || 0) ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return Math.max(0, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)));
}

export function lexicalSimilarity(left: string, right: string): number {
  const leftSet = new Set(memorySearchFeatures(left));
  const rightSet = new Set(memorySearchFeatures(right));
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  let intersection = 0;
  for (const value of leftSet) if (rightSet.has(value)) intersection += 1;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union > 0 ? intersection / union : 0;
}

export function normalizeRelevanceScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

export function attributeMemoryAnswerInfluence(answer: string, memoryText: string): {
  score: number;
  used: boolean;
  similarity: number;
  lexical: number;
  anchorCoverage: number;
  matchedAnchors: number;
} {
  const similarity = cosineSimilarity(localMemoryVector(answer), localMemoryVector(memoryText));
  const lexical = lexicalSimilarity(answer, memoryText);
  const answerFeatures = new Set(memorySearchFeatures(answer));
  const anchors = memorySearchFeatures(memoryText).filter((feature) => /[\u4e00-\u9fff]/u.test(feature) ? feature.length >= 3 : feature.length >= 4);
  const matchedAnchors = anchors.reduce((count, feature) => count + (answerFeatures.has(feature) ? 1 : 0), 0);
  const anchorCoverage = anchors.length > 0 ? matchedAnchors / anchors.length : 0;
  const strongAnchorMatch = matchedAnchors >= Math.min(4, Math.max(2, Math.ceil(anchors.length * 0.25))) && anchorCoverage >= 0.2;
  const score = normalizeRelevanceScore(Math.max(similarity * 0.62 + lexical * 0.38, strongAnchorMatch ? anchorCoverage + 0.18 : anchorCoverage * 0.65));
  return {
    score,
    used: score >= 0.42 || strongAnchorMatch,
    similarity: normalizeRelevanceScore(similarity),
    lexical: normalizeRelevanceScore(lexical),
    anchorCoverage: normalizeRelevanceScore(anchorCoverage),
    matchedAnchors,
  };
}

function inferObservationType(statement: string, layer: MemoryLayer, projectRule: boolean): string {
  if (layer === 'state') return 'current_state';
  if (layer === 'profile') {
    if (/(?:不要|别|禁止|不喜欢|讨厌|never|dislike)/iu.test(statement)) return 'anti_preference';
    if (/(?:流程|步骤|先.+再|工作方式|workflow)/iu.test(statement)) return 'workflow_preference';
    return 'user_preference';
  }
  if (projectRule && /(?:必须|不要|禁止|约束|must|never)/iu.test(statement)) return 'project_constraint';
  if (/(?:路径|服务器|主机|数据库|设备|environment|server|database)/iu.test(statement)) return 'environment_fact';
  return 'project_fact';
}

function summarizeObservation(statement: string, layer: MemoryLayer): string {
  const prefix = layer === 'profile' ? '偏好' : layer === 'state' ? '当前状态' : layer === 'episode' ? '任务情节' : '知识';
  return `${prefix}：${statement.slice(0, 64)}${statement.length > 64 ? '…' : ''}`;
}

function cleanObservationStatement(text: string): string {
  return normalizeWhitespace(text)
    .replace(/^(?:好的[,，。\s]*)?(?:请)?(?:帮我)?记住[:：]?\s*/u, '')
    .replace(/^(?:从现在开始|今后|以后)[:：,，]?\s*/u, '')
    .replace(/^[,，。:：;；\s]+/u, '')
    .trim();
}

function normalizeWhitespace(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stableHash(value: string): string {
  return stableHashNumber(value).toString(16).padStart(8, '0');
}

function stableHashNumber(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
