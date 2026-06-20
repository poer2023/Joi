import type { NormalizedRunEvent } from './types';

const toolLabelMap: Record<string, { running: string; completed: string; failed: string }> = {
  web_research_v1: {
    running: '正在读取网页',
    completed: '已读取网页',
    failed: '网页读取失败',
  },
  web_research_v2: {
    running: '正在检索网页',
    completed: '已完成网页检索',
    failed: '网页检索失败',
  },
  browser_read: {
    running: '正在读取网页',
    completed: '已读取网页',
    failed: '网页读取失败',
  },
  workspace_search_v1: {
    running: '正在搜索工作区',
    completed: '已搜索工作区',
    failed: '工作区搜索失败',
  },
  file_analyze_v1: {
    running: '正在分析文件',
    completed: '已分析文件',
    failed: '文件分析失败',
  },
  file_read: {
    running: '正在读取文件',
    completed: '已读取文件',
    failed: '文件读取失败',
  },
  system_health_check_v1: {
    running: '正在检查系统状态',
    completed: '已检查系统状态',
    failed: '系统检查失败',
  },
};

export function summarizeExecutionEvent(event: NormalizedRunEvent): string {
  const toolName = toolNameFromEvent(event);
  const labels = toolLabelMap[toolName] ?? inferToolLabels(toolName);

  if (event.status === 'running' || event.status === 'queued' || event.status === 'pending') {
    return event.summary || labels.running;
  }
  if (event.status === 'completed') {
    return event.summary || labels.completed;
  }
  if (event.status === 'failed' || event.status === 'blocked') {
    return event.summary || event.error || labels.failed;
  }
  if (event.status === 'waiting_approval') {
    return event.summary || '等待确认';
  }
  return event.summary || event.title || '正在处理';
}

export function detailForExecutionEvent(event: NormalizedRunEvent): string | undefined {
  const source = sourceLabelFromEvent(event);
  if (source) return source;
  return event.title && event.title !== summarizeExecutionEvent(event) ? event.title : undefined;
}

export function sourceLabelFromEvent(event: NormalizedRunEvent): string {
  const source = stringValue(event.snapshot.source_label)
    || stringValue(event.snapshot.source_url)
    || stringValue(event.snapshot.url)
    || stringValue(event.delta.source_label)
    || stringValue(event.delta.url);
  if (!source) return '';
  try {
    const parsed = new URL(source);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return source.length > 56 ? `${source.slice(0, 48)}...` : source;
  }
}

function toolNameFromEvent(event: NormalizedRunEvent): string {
  return (
    stringValue(event.snapshot.tool_name)
    || stringValue(event.snapshot.capability)
    || stringValue(event.snapshot.workflow_name)
    || stringValue(event.delta.tool_name)
    || stringValue(event.delta.capability)
    || event.title
    || event.itemId
    || 'tool'
  ).toLowerCase();
}

function inferToolLabels(toolName: string) {
  if (toolName.includes('web') || toolName.includes('browser')) {
    return { running: '正在读取网页', completed: '已读取网页', failed: '网页处理失败' };
  }
  if (toolName.includes('workspace')) {
    return { running: '正在搜索工作区', completed: '已搜索工作区', failed: '工作区搜索失败' };
  }
  if (toolName.includes('file')) {
    return { running: '正在读取文件', completed: '已读取文件', failed: '文件处理失败' };
  }
  if (toolName.includes('memory')) {
    return { running: '正在处理记忆', completed: '已处理记忆', failed: '记忆处理失败' };
  }
  if (toolName.includes('health')) {
    return { running: '正在检查系统状态', completed: '已检查系统状态', failed: '系统检查失败' };
  }
  return { running: '正在执行工具', completed: '已完成工具调用', failed: '工具执行失败' };
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}
