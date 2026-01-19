/**
 * HTML Utilities Tests
 */

import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../src/utils/html.js';

describe('escapeHtml', () => {
  it('should_escapeAmpersand_when_present', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  it('should_escapeLessThan_when_present', () => {
    expect(escapeHtml('foo < bar')).toBe('foo &lt; bar');
  });

  it('should_escapeGreaterThan_when_present', () => {
    expect(escapeHtml('foo > bar')).toBe('foo &gt; bar');
  });

  it('should_escapeDoubleQuotes_when_present', () => {
    expect(escapeHtml('foo "bar" baz')).toBe('foo &quot;bar&quot; baz');
  });

  it('should_escapeSingleQuotes_when_present', () => {
    expect(escapeHtml("foo 'bar' baz")).toBe('foo &#039;bar&#039; baz');
  });

  it('should_escapeAllSpecialChars_when_combined', () => {
    const input = '<script>alert("XSS & attack\'s")</script>';
    const expected =
      '&lt;script&gt;alert(&quot;XSS &amp; attack&#039;s&quot;)&lt;/script&gt;';
    expect(escapeHtml(input)).toBe(expected);
  });

  it('should_returnEmptyString_when_inputEmpty', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('should_returnUnchanged_when_noSpecialChars', () => {
    expect(escapeHtml('Hello World 123')).toBe('Hello World 123');
  });

  it('should_handleUnicode_when_present', () => {
    expect(escapeHtml('Hello 世界 🌍')).toBe('Hello 世界 🌍');
  });

  it('should_escapeNestedTags_when_present', () => {
    const input = '<<script>>';
    const expected = '&lt;&lt;script&gt;&gt;';
    expect(escapeHtml(input)).toBe(expected);
  });
});
