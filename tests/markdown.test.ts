import { describe, expect, it } from 'vitest';
import { markdownToHtml } from '@/lib/markdown';

describe('markdownToHtml (U12)', () => {
  it('renders paragraphs, bold, italic, and inline code', () => {
    expect(markdownToHtml('A **bold** and *italic* `code` line')).toBe(
      '<p>A <strong>bold</strong> and <em>italic</em> <code>code</code> line</p>',
    );
  });

  it('renders headings, lists, and blockquotes', () => {
    const html = markdownToHtml('# Title\n- one\n- two\n\n1. first\n\n> quoted');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<ol><li>first</li></ol>');
    expect(html).toContain('<blockquote>quoted</blockquote>');
  });

  it('renders fenced code blocks verbatim', () => {
    expect(markdownToHtml('```\nconst x = 1 < 2;\n```')).toBe(
      '<pre><code>const x = 1 &lt; 2;</code></pre>',
    );
  });

  it('renders only http(s) links', () => {
    expect(markdownToHtml('[ok](https://example.com)')).toContain(
      '<a href="https://example.com" target="_blank" rel="noreferrer noopener">ok</a>',
    );
    expect(markdownToHtml('[bad](javascript:alert(1))')).not.toContain('<a ');
  });

  it('escapes raw HTML — never a script injection vector', () => {
    const html = markdownToHtml('<img src=x onerror=alert(1)> **b**');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('<strong>b</strong>');
  });
});
