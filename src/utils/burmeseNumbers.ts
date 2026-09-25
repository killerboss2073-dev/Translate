/**
 * Utility functions for formatting and converting numbers to spoken Burmese words.
 * Handles English digits (0-9) and Burmese digits (၀-၉).
 * Converts 70000 -> ၇ သောင်း, 10000 -> ၁ သောင်း, 7000 -> ၇ ထောင်, 8000 -> ၈ ထောင်, etc.
 */

const BURMESE_DIGITS = ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉'];

const DIGIT_MAP: Record<string, string> = {
  '0': '0', '1': '1', '2': '2', '3': '3', '4': '4',
  '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  '၀': '0', '၁': '1', '၂': '2', '၃': '3', '၄': '4',
  '၅': '5', '၆': '6', '၇': '7', '၈': '8', '၉': '9'
};

export function toBurmeseDigits(numStr: number | string): string {
  return String(numStr)
    .split('')
    .map(c => (c >= '0' && c <= '9' ? BURMESE_DIGITS[Number(c)] : c))
    .join('');
}

export function normalizeToStandardDigits(str: string): string {
  return String(str)
    .replace(/[၀-၉]/g, d => DIGIT_MAP[d] || d)
    .replace(/,/g, '')
    .trim();
}

/**
 * Converts any positive integer to spoken Burmese unit terms.
 * e.g. 70000 -> "၇ သောင်း", 10000 -> "၁ သောင်း", 7000 -> "၇ ထောင်", 8000 -> "၈ ထောင်", 100000 -> "၁ သိန်း"
 */
export function numberToBurmeseSpoken(num: number | string): string | null {
  if (typeof num === 'string') {
    num = Number(normalizeToStandardDigits(num));
  }
  if (isNaN(num) || num < 0 || !Number.isInteger(num)) return null;
  if (num === 0) return '၀';

  const parts: string[] = [];
  let n = num;

  // Millions / သန်း (>= 1,000,000)
  const than = Math.floor(n / 1000000);
  if (than > 0) {
    parts.push(toBurmeseDigits(than) + ' သန်း');
    n %= 1000000;
  }

  // Lakh / သိန်း (>= 100,000)
  const thein = Math.floor(n / 100000);
  if (thein > 0) {
    parts.push(toBurmeseDigits(thein) + ' သိန်း');
    n %= 100000;
  }

  // 10K / သောင်း (>= 10,000)
  const thaung = Math.floor(n / 10000);
  if (thaung > 0) {
    parts.push(toBurmeseDigits(thaung) + ' သောင်း');
    n %= 10000;
  }

  // 1K / ထောင် (>= 1,000)
  const htaung = Math.floor(n / 1000);
  if (htaung > 0) {
    parts.push(toBurmeseDigits(htaung) + ' ထောင်');
    n %= 1000;
  }

  // 100 / ရာ (>= 100)
  const yar = Math.floor(n / 100);
  if (yar > 0) {
    parts.push(toBurmeseDigits(yar) + ' ရာ');
    n %= 100;
  }

  // 10 / ဆယ် (>= 10)
  const sel = Math.floor(n / 10);
  if (sel > 0) {
    parts.push(toBurmeseDigits(sel) + ' ဆယ်');
    n %= 10;
  }

  // Single digit remainder
  if (n > 0) {
    parts.push(toBurmeseDigits(n));
  }

  return parts.join(' ');
}

/**
 * Searches for all numbers in a sentence and converts them into spoken Burmese words.
 * Works with:
 *  - 70000, 10000, 7000, 8000, 70,000, 10,000
 *  - ၇၀၀၀၀, ၁၀၀၀၀, ၇၀၀၀, ၈၀၀၀, ၇၀,၀၀၀
 */
export function convertNumbersInTextToBurmese(text: string): string {
  if (!text) return text;

  // Safe pattern to match numeric strings (both English & Burmese digits, with or without commas)
  return text.replace(/([0-9၀-၉]{1,3}(?:,[0-9၀-၉]{3})+|[0-9၀-၉]{2,})/g, (match) => {
    const rawVal = Number(normalizeToStandardDigits(match));
    if (!isNaN(rawVal) && rawVal >= 10) {
      const spoken = numberToBurmeseSpoken(rawVal);
      if (spoken) {
        return spoken;
      }
    }
    return match;
  });
}

/**
 * Resiliently parses Gemini JSON/text output into an array of strings.
 * Handles markdown backticks, JSON arrays, objects, numbered lists, or plain lines.
 */
export function safeParseTranslations(rawText: string, expectedCount: number): string[] {
  if (!rawText) return [];
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/g, '')
    .trim();

  // 1. Try standard JSON parse
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      const results = parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
      if (results.length > 0) return results;
    }
    if (parsed && typeof parsed === 'object') {
      const arr = (parsed as any).translations || (parsed as any).result || (parsed as any).data || Object.values(parsed);
      if (Array.isArray(arr)) {
        const results = arr.map((item) => String(item ?? '').trim()).filter(Boolean);
        if (results.length > 0) return results;
      }
    }
  } catch {}

  // 2. Extract bracketed string items if unescaped quotes broke JSON.parse
  try {
    const bracketMatch = cleaned.match(/\[\s*([\s\S]*)\s*\]/);
    if (bracketMatch) {
      const items: string[] = [];
      const itemRegex = /"((?:[^"\\]|\\.)*)"/g;
      let m;
      while ((m = itemRegex.exec(bracketMatch[1])) !== null) {
        const s = m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
        if (s) items.push(s);
      }
      if (items.length > 0) return items;
    }
  } catch {}

  // 3. Fallback: Parse line-by-line while stripping syntax tokens [ ] { }, quotes, and bullets
  const rawLines = cleaned.split('\n');
  const extracted: string[] = [];

  for (const line of rawLines) {
    let s = line.trim();
    if (!s || s === '[' || s === ']' || s === '{' || s === '}') continue;

    // Strip leading numbers / bullets (e.g. 1. or 1: or - or *)
    s = s.replace(/^\d+[\.\:\)\-]\s*/, '');

    // Strip outer JSON quotes and trailing commas
    s = s.replace(/^[",\s]+/, '').replace(/[",\s]+$/, '').trim();

    if (s && s !== '[' && s !== ']' && s !== '{' && s !== '}') {
      extracted.push(s);
    }
  }

  if (extracted.length > 0) return extracted;

  return [];
}
