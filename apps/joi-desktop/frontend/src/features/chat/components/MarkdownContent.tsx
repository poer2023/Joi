import { memo, type ReactNode } from 'react';

type Block =
  | { type: 'blockquote'; lines: string[] }
  | { type: 'code'; code: string; language?: string }
  | { type: 'heading'; depth: number; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'paragraph'; lines: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] };

const inlinePattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]]+\]\([^)]+\))/g;
const LONG_CODE_LINE_THRESHOLD = 18;
const LONG_CODE_CHARACTER_THRESHOLD = 1_200;

export const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return <div className="markdown-content">{parseBlocks(content).map(renderBlock)}</div>;
});

function parseBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      const language = fence[1];
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', code: codeLines.join('\n'), language });
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', depth: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const headers = splitTableRow(lines[index]);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && looksLikeTableRow(lines[index])) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[2]);
      const items: string[] = [];
      while (index < lines.length) {
        const itemMatch = lines[index].match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
        if (!itemMatch || /\d/.test(itemMatch[2]) !== ordered) break;
        items.push(itemMatch[3].trim());
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', lines: quoteLines });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      if (/^```/.test(lines[index]) || /^(#{1,4})\s+/.test(lines[index]) || isTableStart(lines, index) || /^(\s*)([-*+]|\d+[.)])\s+/.test(lines[index]) || /^>\s?/.test(lines[index])) {
        break;
      }
      paragraphLines.push(lines[index].trimEnd());
      index += 1;
    }
    blocks.push({ type: 'paragraph', lines: paragraphLines });
  }

  return blocks;
}

function renderBlock(block: Block, index: number) {
  if (block.type === 'heading') {
    const children = renderInline(block.text);
    if (block.depth <= 1) return <h3 key={index}>{children}</h3>;
    if (block.depth === 2) return <h4 key={index}>{children}</h4>;
    if (block.depth === 3) return <h5 key={index}>{children}</h5>;
    return <h6 key={index}>{children}</h6>;
  }
  if (block.type === 'paragraph') {
    return <p key={index}>{renderInlineLines(block.lines)}</p>;
  }
  if (block.type === 'blockquote') {
    return <blockquote key={index}>{renderInlineLines(block.lines)}</blockquote>;
  }
  if (block.type === 'code') {
    return renderCodeBlock(block, index);
  }
  if (block.type === 'list') {
    const ListTag = block.ordered ? 'ol' : 'ul';
    return (
      <ListTag key={index}>
        {block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}
      </ListTag>
    );
  }
  return (
    <div className="markdown-table-wrap" key={index}>
      <table>
        <thead>
          <tr>{block.headers.map((header, cellIndex) => <th key={cellIndex}>{renderInline(header)}</th>)}</tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {block.headers.map((_, cellIndex) => <td key={cellIndex}>{renderInline(row[cellIndex] || '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderCodeBlock(block: Extract<Block, { type: 'code' }>, index: number) {
  const lineCount = block.code ? block.code.split('\n').length : 0;
  const code = (
    <pre className="markdown-code-block" data-language={block.language || undefined}>
      <code>{block.code}</code>
    </pre>
  );
  const isLong = lineCount > LONG_CODE_LINE_THRESHOLD || block.code.length > LONG_CODE_CHARACTER_THRESHOLD;
  if (!isLong) return <div className="markdown-code-block-inline" key={index}>{code}</div>;
  return (
    <details className="markdown-code-disclosure" key={index}>
      <summary>
        <span>代码</span>
        <small>{block.language ? `${block.language} · ` : ''}{lineCount} 行</small>
      </summary>
      {code}
    </details>
  );
}

function renderInlineLines(lines: string[]) {
  return lines.flatMap((line, index) => (
    index === 0 ? renderInline(line) : [<br key={`br-${index}`} />, ...renderInline(line)]
  ));
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(inlinePattern)) {
    if (match.index === undefined) continue;
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    nodes.push(renderInlineToken(match[0], nodes.length));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function renderInlineToken(token: string, key: number): ReactNode {
  if (token.startsWith('`') && token.endsWith('`')) {
    return <code key={key}>{token.slice(1, -1)}</code>;
  }
  if (token.startsWith('**') && token.endsWith('**')) {
    return <strong key={key}>{renderInline(token.slice(2, -2))}</strong>;
  }
  if (token.startsWith('*') && token.endsWith('*')) {
    return <em key={key}>{renderInline(token.slice(1, -1))}</em>;
  }
  const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (link) {
    const href = safeHref(link[2].trim());
    if (href) {
      return <a href={href} key={key} rel="noreferrer" target="_blank">{renderInline(link[1])}</a>;
    }
  }
  return token;
}

function safeHref(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function isTableStart(lines: string[], index: number) {
  return looksLikeTableRow(lines[index]) && index + 1 < lines.length && /^(\s*\|?)\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
}

function looksLikeTableRow(line: string) {
  return line.includes('|') && splitTableRow(line).length > 1;
}

function splitTableRow(line: string) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}
