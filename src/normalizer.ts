// ─────────────────────────────────────────────────────────────
// normalizer.ts — Converts log-style objects into valid JSON.
//
// Logs almost never produce valid JSON.  Keys are unquoted,
// string values are unquoted, empty values appear as bare
// commas, and Python-style True/False/None may be present.
//
// This module uses a **recursive-descent parser** that walks
// the raw text character-by-character and emits valid JSON.
// ─────────────────────────────────────────────────────────────

/**
 * Normalizes a raw log-style body string into pretty-printed JSON.
 *
 * Tries, in order:
 *   1. `JSON.parse` the raw string (already valid).
 *   2. `JSON.parse` after replacing single → double quotes.
 *   3. Full recursive-descent normalization.
 *
 * Throws if none of the above succeed.
 */
export function normalizeBody(raw: string): string {
  const trimmed = raw.trim();

  // 1. Already valid JSON?
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch { /* continue */ }

  // 2. Single-quoted JSON? (Python / Ruby logs)
  try {
    const swapped = swapSingleToDoubleQuotes(trimmed);
    return JSON.stringify(JSON.parse(swapped), null, 2);
  } catch { /* continue */ }

  // 3. Full normalization via recursive descent
  const parser = new LogBodyParser(trimmed);
  const jsonStr = parser.parse();
  // Validate the output
  const parsed = JSON.parse(jsonStr);
  return JSON.stringify(parsed, null, 2);
}

// ──────────────────────── Helpers ────────────────────────

/**
 * Naively swap single-quoted strings to double-quoted strings.
 * Handles escaped quotes inside strings.
 */
function swapSingleToDoubleQuotes(text: string): string {
  const out: string[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] === "'") {
      out.push('"');
      i++;
      while (i < text.length && text[i] !== "'") {
        if (text[i] === '\\' && i + 1 < text.length) {
          out.push(text[i], text[i + 1]);
          i += 2;
        } else if (text[i] === '"') {
          out.push('\\"'); // escape inner double quotes
          i++;
        } else {
          out.push(text[i]);
          i++;
        }
      }
      out.push('"');
      if (i < text.length) { i++; } // skip closing '
    } else {
      out.push(text[i]);
      i++;
    }
  }
  return out.join('');
}

// ──────────────────── Recursive-Descent Parser ────────────────────

class LogBodyParser {
  private pos = 0;
  private readonly text: string;

  constructor(text: string) {
    // Strip lines that are purely comments
    this.text = text
      .split('\n')
      .filter(l => {
        const t = l.trimStart();
        return !(t.startsWith('//') || t.startsWith('#'));
      })
      .join('\n');
  }

  /** Entry point — parses one value and returns a JSON string. */
  parse(): string {
    this.skipWhitespace();
    const result = this.parseValue();
    return result;
  }

  // ──────── Value dispatch ────────

  private parseValue(): string {
    this.skipWhitespace();
    const ch = this.peek();

    if (ch === '{') { return this.parseObject(); }
    if (ch === '[') { return this.parseArray(); }
    if (ch === '"') { return this.parseDoubleQuotedString(); }
    if (ch === "'") { return this.parseSingleQuotedString(); }

    return this.parseUnquotedValue();
  }

  // ──────── Object ────────

  private parseObject(): string {
    this.expect('{');
    this.skipWhitespace();

    const entries: string[] = [];

    while (this.peek() !== '}' && !this.eof()) {
      // Separator: comma is optional (handles log-style line breaks)
      if (entries.length > 0) {
        if (this.peek() === ',') { this.advance(); }
        this.skipWhitespace();
        if (this.peek() === '}') { break; } // trailing comma
      }

      const key = this.parseKey();
      this.skipWhitespace();
      this.expect(':');
      this.skipWhitespace();

      // Empty value → null  (e.g. "key: , next:")
      let value: string;
      if (this.peek() === ',' || this.peek() === '}') {
        value = 'null';
      } else {
        value = this.parseValue();
      }

      entries.push(`${key}: ${value}`);
      this.skipWhitespace();
    }

    if (!this.eof()) { this.expect('}'); }
    return `{${entries.join(', ')}}`;
  }

  // ──────── Array ────────

  private parseArray(): string {
    this.expect('[');
    this.skipWhitespace();

    const elements: string[] = [];

    while (this.peek() !== ']' && !this.eof()) {
      if (elements.length > 0) {
        if (this.peek() === ',') { this.advance(); }
        this.skipWhitespace();
        if (this.peek() === ']') { break; }
      }

      elements.push(this.parseValue());
      this.skipWhitespace();
    }

    if (!this.eof()) { this.expect(']'); }
    return `[${elements.join(', ')}]`;
  }

  // ──────── Key ────────

  private parseKey(): string {
    this.skipWhitespace();
    const ch = this.peek();

    if (ch === '"') {
      return this.parseDoubleQuotedString();
    }
    if (ch === "'") {
      return this.parseSingleQuotedString();
    }

    // Unquoted key — read identifier chars
    const start = this.pos;
    while (!this.eof() && /[\w\-.$]/.test(this.peek())) {
      this.advance();
    }
    const key = this.text.substring(start, this.pos);
    if (!key) {
      throw new Error(
        `Expected key at position ${this.pos}, got '${this.peek()}'`
      );
    }
    return `"${key}"`;
  }

  // ──────── Strings ────────

  private parseDoubleQuotedString(): string {
    this.expect('"');
    let content = '';
    while (!this.eof() && this.peek() !== '"') {
      if (this.peek() === '\\') {
        this.advance();
        if (!this.eof()) {
          const esc = this.peek();
          // Preserve standard JSON escapes
          if ('"\\/bfnrt'.includes(esc)) {
            content += '\\' + esc;
          } else if (esc === 'u') {
            content += '\\u';
          } else {
            content += esc; // drop unknown backslash
          }
          this.advance();
        }
      } else {
        content += this.peek();
        this.advance();
      }
    }
    if (!this.eof()) { this.advance(); } // closing "
    return `"${content}"`;
  }

  private parseSingleQuotedString(): string {
    this.expect("'");
    let content = '';
    while (!this.eof() && this.peek() !== "'") {
      if (this.peek() === '\\') {
        this.advance();
        if (!this.eof()) {
          content += this.peek();
          this.advance();
        }
      } else {
        if (this.peek() === '"') {
          content += '\\"'; // escape for JSON output
        } else {
          content += this.peek();
        }
        this.advance();
      }
    }
    if (!this.eof()) { this.advance(); } // closing '
    return `"${content}"`;
  }

  // ──────── Unquoted value ────────

  private parseUnquotedValue(): string {
    this.skipWhitespace();
    const rest = this.text.substring(this.pos);

    // null / None
    if (/^null\b/i.test(rest) || /^None\b/.test(rest)) {
      this.pos += rest.match(/^(null|None)/i)![0].length;
      return 'null';
    }
    // true / True
    if (/^true\b/i.test(rest) || /^True\b/.test(rest)) {
      this.pos += rest.match(/^(true|True)/i)![0].length;
      return 'true';
    }
    // false / False
    if (/^false\b/i.test(rest) || /^False\b/.test(rest)) {
      this.pos += rest.match(/^(false|False)/i)![0].length;
      return 'false';
    }
    // Number
    const numMatch = rest.match(
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?(?=[,\s}\]\n]|$)/
    );
    if (numMatch) {
      this.pos += numMatch[0].length;
      return numMatch[0];
    }

    // Unquoted string — read until a structural delimiter at depth 0,
    // or until a newline followed by what looks like a new key.
    const start = this.pos;
    while (!this.eof()) {
      const ch = this.peek();

      // Hard terminators
      if (ch === ',' || ch === '}' || ch === ']') { break; }

      // Newline: stop if next non-blank line starts a new key or closing brace
      if (ch === '\n') {
        const ahead = this.text.substring(this.pos + 1).trimStart();
        if (/^[\w"'][\w\-.$]*["']?\s*:/.test(ahead) || /^[}\]]/.test(ahead)) {
          break;
        }
      }

      this.advance();
    }

    const raw = this.text.substring(start, this.pos).trim();
    if (!raw) { return 'null'; }

    // Escape for JSON
    const escaped = raw
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `"${escaped}"`;
  }

  // ──────── Primitives ────────

  private peek(): string {
    return this.text[this.pos] ?? '';
  }

  private advance(): void {
    this.pos++;
  }

  private eof(): boolean {
    return this.pos >= this.text.length;
  }

  private expect(ch: string): void {
    if (this.peek() !== ch) {
      throw new Error(
        `Expected '${ch}' at position ${this.pos}, got '${this.peek()}'`
      );
    }
    this.advance();
  }

  private skipWhitespace(): void {
    while (!this.eof() && /\s/.test(this.peek())) {
      this.advance();
    }
  }
}
