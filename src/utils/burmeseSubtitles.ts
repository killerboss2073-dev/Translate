/**
 * Burmese Subtitle & Audio Timing Utilities
 * Provides exact subtitle splitting, 2-line formatting, and millisecond timecode conversion.
 */

// Helper to format ms to SRT timestamp 00:00:00,000
export function fmtSrtTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const millis = Math.max(0, Math.floor(ms % 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

// Check if string has at least one pronounceable alphanumeric or unicode character
export function hasPronounceableText(str: string): boolean {
  if (!str) return false;
  return /[a-zA-Z0-9\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]/.test(str);
}

// Split long text into balanced subtitle chunks (~40-75 characters per cue)
export function splitIntoBurmeseCues(text: string): string[] {
  if (!text || !text.trim()) return [];
  const TARGET_CUE_MAX = 75;

  // 1. Initial split by newlines, full stops (။), question marks, exclamation marks
  const initialSentences: string[] = [];
  const rawBlocks = text.trim().split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);

  rawBlocks.forEach((block) => {
    const sentences = block.split(/(?<=[။!?])\s*/).map((s) => s.trim()).filter(Boolean);
    if (sentences.length > 0) {
      initialSentences.push(...sentences);
    } else if (block) {
      initialSentences.push(block);
    }
  });

  const queue = [...initialSentences];
  const results: string[] = [];
  let safetyCounter = 0;
  const MAX_SAFETY_ITERATIONS = 500;

  while (queue.length > 0 && safetyCounter < MAX_SAFETY_ITERATIONS) {
    safetyCounter++;
    const current = queue.shift()!.trim();
    if (!current || !hasPronounceableText(current)) continue;

    if (current.length <= TARGET_CUE_MAX) {
      results.push(current);
      continue;
    }

    // If current exceeds TARGET_CUE_MAX, find best split point
    const mid = Math.floor(current.length / 2);
    let splitPos = -1;

    // Option A: Comma (၊) near center
    const commaIndices: number[] = [];
    for (let i = 0; i < current.length; i++) {
      if (current[i] === '၊') commaIndices.push(i + 1);
    }
    if (commaIndices.length > 0) {
      let minDiff = Infinity;
      for (const idx of commaIndices) {
        if (idx >= 15 && idx <= current.length - 15) {
          const diff = Math.abs(idx - mid);
          if (diff < minDiff) {
            minDiff = diff;
            splitPos = idx;
          }
        }
      }
    }

    // Option B: Grammatical pause markers
    if (splitPos === -1) {
      const pauseMarkers = [
        'ရူးပြီပြီး', 'သတိလစ်သွားခဲ့တယ်', 'ကြားလိုက်ရတယ်', 'တိုင်ပင်နေတာကို',
        'ပြီးတော့', 'ပြီးနောက်', 'ပြီး', 'လုပ်တုန်း', 'တုန်း', 'ချိန်မှာ', 'အခါ',
        'အမေကိုတော့', 'ကိုတော့', 'တော့', 'ပေမယ့်', 'ကြောင့်', 'လျက်', 'ရင်',
        'နှင့်', 'နဲ့', 'သို့', 'အား', 'ကို', 'က', 'မှာ', 'တွင်', 'ပါနော်', 'ပါ'
      ];
      let minMarkerDiff = Infinity;
      for (const marker of pauseMarkers) {
        let pos = current.indexOf(marker);
        while (pos !== -1) {
          const pt = pos + marker.length;
          if (pt >= 15 && pt <= current.length - 15) {
            const diff = Math.abs(pt - mid);
            if (diff < minMarkerDiff) {
              minMarkerDiff = diff;
              splitPos = pt;
            }
          }
          pos = current.indexOf(marker, pos + 1);
        }
      }
    }

    // Option C: Space
    if (splitPos === -1) {
      const spaceIdxs: number[] = [];
      for (let i = 0; i < current.length; i++) {
        if (current[i] === ' ') spaceIdxs.push(i);
      }
      if (spaceIdxs.length > 0) {
        let minDiff = Infinity;
        for (const sp of spaceIdxs) {
          if (sp >= 12 && sp <= current.length - 12) {
            const diff = Math.abs(sp - mid);
            if (diff < minDiff) {
              minDiff = diff;
              splitPos = sp;
            }
          }
        }
      }
    }

    // Option D: Syllable boundary near center
    if (splitPos === -1) {
      const isCombiningMark = (char: string) => {
        const code = char.charCodeAt(0);
        return (code >= 0x102b && code <= 0x103e) || (code >= 0x103a && code <= 0x1039);
      };
      for (let offset = 0; offset <= mid; offset++) {
        for (const sign of [1, -1]) {
          const idx = mid + offset * sign;
          if (idx >= 12 && idx <= current.length - 12) {
            const prevChar = current[idx - 1];
            const nextChar = current[idx];
            if (prevChar !== '္' && !isCombiningMark(nextChar)) {
              splitPos = idx;
              break;
            }
          }
        }
        if (splitPos !== -1) break;
      }
    }

    // If valid split point found and strictly divides the text into 2 smaller parts
    if (splitPos > 0 && splitPos < current.length) {
      const p1 = current.slice(0, splitPos).trim();
      const p2 = current.slice(splitPos).trim();
      if (p1 && p2 && p1.length < current.length && p2.length < current.length) {
        if (hasPronounceableText(p2)) queue.unshift(p2);
        if (hasPronounceableText(p1)) queue.unshift(p1);
        continue;
      }
    }

    // If no further split possible, push directly to results
    if (hasPronounceableText(current)) {
      results.push(current);
    }
  }

  const filtered = results.filter((r) => hasPronounceableText(r));
  return filtered.length > 0 ? filtered : (hasPronounceableText(text) ? [text.trim()] : []);
}

// Format a single subtitle cue into clean balanced 2 lines (avoiding lonely orphan words or 3+ lines)
export function formatBurmeseTwoLines(text: string): string {
  if (!text) return '';
  const str = text.trim();
  if (!str) return '';

  // If already contains newlines, clean and limit to max 2 lines
  if (str.includes('\n')) {
    const lines = str.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      return `${lines[0]}\n${lines.slice(1).join(' ')}`;
    }
  }

  // Short sentences (< 35 chars) can comfortably fit on a single clean line
  if (str.length < 35) {
    return str;
  }

  const mid = Math.floor(str.length / 2);

  const checkAndReturnSplit = (p1: string, p2: string): string | null => {
    const trimmed1 = p1.trim();
    const trimmed2 = p2.trim();
    if (trimmed1.length >= 4 && trimmed2.length >= 4) {
      return `${trimmed1}\n${trimmed2}`;
    }
    return null;
  };

  // Strategy 1: Split at space closest to midpoint
  const spaceIndices: number[] = [];
  for (let i = 0; i < str.length; i++) {
    if (str[i] === ' ') spaceIndices.push(i);
  }
  if (spaceIndices.length > 0) {
    let bestSpace = spaceIndices[0];
    let minDiff = Math.abs(bestSpace - mid);
    for (const sp of spaceIndices) {
      const diff = Math.abs(sp - mid);
      if (diff < minDiff) {
        minDiff = diff;
        bestSpace = sp;
      }
    }
    const splitResult = checkAndReturnSplit(str.slice(0, bestSpace), str.slice(bestSpace + 1));
    if (splitResult) return splitResult;
  }

  // Strategy 2: Split at comma (၊) closest to midpoint
  const commaIndices: number[] = [];
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '၊') commaIndices.push(i + 1);
  }
  if (commaIndices.length > 0) {
    let bestComma = commaIndices[0];
    let minDiff = Math.abs(bestComma - mid);
    for (const cm of commaIndices) {
      const diff = Math.abs(cm - mid);
      if (diff < minDiff) {
        minDiff = diff;
        bestComma = cm;
      }
    }
    const splitResult = checkAndReturnSplit(str.slice(0, bestComma), str.slice(bestComma));
    if (splitResult) return splitResult;
  }

  // Strategy 3: Split at Burmese particle connectors
  const particles = [
    'နဲ့', 'ရဲ့', 'က', 'ကို', 'မှာ', 'တွင်', 'များ', '၏', 'နှင့်',
    'ဖြင့်', 'ပြီးတော့', 'ပြီး', 'သော', 'သည်', '၍', 'အား',
    'အကြောင်း', 'အတွက်', 'ကြောင့်', 'ပါနော်', 'ပါ'
  ];
  let bestParticleIdx = -1;
  let minParticleDiff = Infinity;
  for (const p of particles) {
    let pos = str.indexOf(p);
    while (pos !== -1) {
      const splitPoint = pos + p.length;
      if (splitPoint >= 4 && splitPoint <= str.length - 4) {
        const diff = Math.abs(splitPoint - mid);
        if (diff < minParticleDiff) {
          const testP1 = str.slice(0, splitPoint).trim();
          const testP2 = str.slice(splitPoint).trim();
          if (testP1.length > 0 && testP2.length > 0) {
            minParticleDiff = diff;
            bestParticleIdx = splitPoint;
          }
        }
      }
      pos = str.indexOf(p, pos + 1);
    }
  }

  if (bestParticleIdx !== -1) {
    const splitResult = checkAndReturnSplit(str.slice(0, bestParticleIdx), str.slice(bestParticleIdx));
    if (splitResult) return splitResult;
  }

  // Strategy 4: Syllable boundary break near midpoint
  const isCombiningMark = (char: string) => {
    const code = char.charCodeAt(0);
    return (code >= 0x102b && code <= 0x103e) || (code >= 0x103a && code <= 0x1039);
  };

  for (let offset = 0; offset <= mid; offset++) {
    for (const sign of [1, -1]) {
      const idx = mid + offset * sign;
      if (idx >= 4 && idx <= str.length - 4) {
        const prevChar = str[idx - 1];
        const nextChar = str[idx];
        if (prevChar !== '္' && !isCombiningMark(nextChar)) {
          const splitResult = checkAndReturnSplit(str.slice(0, idx), str.slice(idx));
          if (splitResult) return splitResult;
        }
      }
    }
  }

  return str;
}

// Calculate exact duration in ms from MP3 frame headers (Supports MPEG 1, MPEG 2, MPEG 2.5 Layer III)
export function getMp3DurationMs(buffer: Buffer): number {
  if (!buffer || buffer.length < 4) return 0;

  const bitratesMPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const bitratesMPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

  const sampleRatesMPEG1 = [44100, 48000, 32000];
  const sampleRatesMPEG2 = [22050, 24000, 16000];
  const sampleRatesMPEG25 = [11025, 12000, 8000];

  let offset = 0;
  let totalDurationMs = 0;

  while (offset <= buffer.length - 4) {
    if (buffer[offset] === 0xFF && (buffer[offset + 1] & 0xE0) === 0xE0) {
      const versionId = (buffer[offset + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
      const layerId = (buffer[offset + 1] >> 1) & 3;   // 1 = Layer III
      const bitrateIdx = (buffer[offset + 2] >> 4) & 15;
      const srIdx = (buffer[offset + 2] >> 2) & 3;
      const padding = (buffer[offset + 2] >> 1) & 1;

      if (versionId !== 1 && layerId === 1 && bitrateIdx > 0 && bitrateIdx < 15 && srIdx < 3) {
        let sampleRate = 24000;
        let bitrate = 48000;
        let samplesPerFrame = 576;

        if (versionId === 3) {
          sampleRate = sampleRatesMPEG1[srIdx];
          bitrate = bitratesMPEG1_L3[bitrateIdx] * 1000;
          samplesPerFrame = 1152;
        } else if (versionId === 2) {
          sampleRate = sampleRatesMPEG2[srIdx];
          bitrate = bitratesMPEG2_L3[bitrateIdx] * 1000;
          samplesPerFrame = 576;
        } else if (versionId === 0) {
          sampleRate = sampleRatesMPEG25[srIdx];
          bitrate = bitratesMPEG2_L3[bitrateIdx] * 1000;
          samplesPerFrame = 576;
        }

        const frameSize = Math.floor((samplesPerFrame / 8 * bitrate) / sampleRate) + padding;
        if (frameSize >= 24 && offset + frameSize <= buffer.length + 4) {
          const frameDurMs = (samplesPerFrame / sampleRate) * 1000;
          totalDurationMs += frameDurMs;
          offset += frameSize;
          continue;
        }
      }
    }
    offset++;
  }

  if (totalDurationMs <= 0 && buffer.length > 0) {
    return Math.round((buffer.length / 6000) * 1000);
  }
  return Math.round(totalDurationMs);
}
