import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { UniversalCommunicate } from 'edge-tts-universal';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { convertNumbersInTextToBurmese, safeParseTranslations } from './src/utils/burmeseNumbers';
import { splitIntoBurmeseCues, formatBurmeseTwoLines, fmtSrtTime, getMp3DurationMs, hasPronounceableText } from './src/utils/burmeseSubtitles';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '50mb' }));

  // Helper function to synthesize a section of text continuously while extracting real-time WordBoundaries
  async function synthesizeContinuousSection(
    textSection: string,
    options: { voice: string; rate: string; pitch: string; volume: string }
  ): Promise<{
    buffer: Buffer;
    durationMs: number;
    boundaries: Array<{ text: string; startMs: number; endMs: number }>;
  }> {
    if (!textSection || !hasPronounceableText(textSection)) {
      return { buffer: Buffer.alloc(0), durationMs: 0, boundaries: [] };
    }

    try {
      const comm = new UniversalCommunicate(textSection, options);
      const audioBuffers: Buffer[] = [];
      const boundaries: Array<{ text: string; startMs: number; endMs: number }> = [];

      for await (const chunk of comm.stream()) {
        if (chunk.type === 'audio' && chunk.data) {
          audioBuffers.push(Buffer.from(chunk.data));
        } else if (chunk.type === 'WordBoundary') {
          // offset and duration in 100ns ticks -> convert to ms (/ 10000)
          const offset = (chunk as any).offset ?? 0;
          const duration = (chunk as any).duration ?? 0;
          const textStr = (chunk as any).text || '';
          const startMs = Math.round(offset / 10000);
          const durationMs = Math.round(duration / 10000);
          if (textStr) {
            boundaries.push({
              text: textStr,
              startMs,
              endMs: startMs + Math.max(10, durationMs),
            });
          }
        }
      }

      const merged = Buffer.concat(audioBuffers);
      // Edge TTS standard MP3 output is CBR 48kbps (6000 bytes per second)
      const durationMs = Math.round((merged.length / 6000) * 1000);

      return {
        buffer: merged,
        durationMs,
        boundaries,
      };
    } catch (err: any) {
      console.warn(`[TTS Notice] Error in section synthesis:`, err.message || err);
      return { buffer: Buffer.alloc(0), durationMs: 0, boundaries: [] };
    }
  }

  // API Route: Edge TTS with Zero-Drift Subtitle Timing & Natural Continuous Cadence
  app.post('/api/tts', async (req, res) => {
    try {
      const {
        text,
        voice = 'my-MM-NilarNeural',
        rate = '+0%',
        pitch = '+0Hz',
        volume = '+0%',
        returnJson = false,
      } = req.body;

      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'စာသား ထည့်သွင်းရန် လိုအပ်ပါသည် (Text is required)' });
      }

      const formatRate = (r: any) => {
        if (typeof r === 'number') return `${r >= 0 ? '+' : ''}${r}%`;
        if (typeof r === 'string' && r.trim()) {
          const s = r.trim();
          if (!s.endsWith('%')) return `${!s.startsWith('-') && !s.startsWith('+') ? '+' : ''}${s}%`;
          if (!s.startsWith('-') && !s.startsWith('+')) return `+${s}`;
          return s;
        }
        return '+0%';
      };

      const formatPitch = (p: any) => {
        if (typeof p === 'number') return `${p >= 0 ? '+' : ''}${p}Hz`;
        if (typeof p === 'string' && p.trim()) {
          const s = p.trim();
          if (!s.endsWith('Hz')) return `${!s.startsWith('-') && !s.startsWith('+') ? '+' : ''}${s}Hz`;
          if (!s.startsWith('-') && !s.startsWith('+')) return `+${s}`;
          return s;
        }
        return '+0Hz';
      };

      const formatVolume = (v: any) => {
        if (typeof v === 'number') return `${v >= 0 ? '+' : ''}${v}%`;
        if (typeof v === 'string' && v.trim()) {
          const s = v.trim();
          if (!s.endsWith('%')) return `${!s.startsWith('-') && !s.startsWith('+') ? '+' : ''}${s}%`;
          if (!s.startsWith('-') && !s.startsWith('+')) return `+${s}`;
          return s;
        }
        return '+0%';
      };

      // 1. Convert numbers to natural spoken Burmese words
      const textToSpeak = convertNumbersInTextToBurmese(text.trim());

      const ttsOptions = {
        voice,
        rate: formatRate(rate),
        pitch: formatPitch(pitch),
        volume: formatVolume(volume),
      };

      // 2. Split large text into natural paragraph/scene sections (up to ~1500 chars each) to guarantee fluid speech
      const rawSections = textToSpeak
        .split(/\n\s*\n|\n/)
        .map((s) => s.trim())
        .filter((s) => hasPronounceableText(s));

      const sections: string[] = [];
      let curSec = '';
      for (const raw of rawSections) {
        if (curSec.length + raw.length > 1500 && curSec.length > 0) {
          sections.push(curSec.trim());
          curSec = raw;
        } else {
          curSec = curSec ? `${curSec} ${raw}` : raw;
        }
      }
      if (curSec) sections.push(curSec.trim());

      if (sections.length === 0) {
        sections.push(textToSpeak);
      }

      // 3. Synthesize sections continuously in parallel
      const sectionPromises = sections.map((sec) => synthesizeContinuousSection(sec, ttsOptions));
      const rawSectionResults = await Promise.all(sectionPromises);
      const sectionResults = rawSectionResults.filter((s) => s.buffer.length > 0);

      if (sectionResults.length === 0) {
        return res.status(500).json({ error: 'အသံဖိုင် ဖန်တီးမရပါ (No audio generated from Edge TTS)' });
      }

      const mergedAudioBuffer = Buffer.concat(sectionResults.map((s) => s.buffer));
      const totalAudioDurationMs = Math.round((mergedAudioBuffer.length / 6000) * 1000);

      // 4. Generate balanced subtitle cues from real-time WordBoundaries
      const timedCues: Array<{ index: number; startMs: number; endMs: number; text: string }> = [];
      let baseOffsetMs = 0;

      sectionResults.forEach((sec) => {
        const secAudioDur = sec.durationMs;

        if (sec.boundaries.length > 0) {
          // Scale raw boundary ticks to match the exact section audio duration
          const lastRawEnd = sec.boundaries[sec.boundaries.length - 1].endMs;
          const scale = lastRawEnd > 0 ? secAudioDur / lastRawEnd : 1.0;

          let currentGroup: Array<{ text: string; startMs: number; endMs: number }> = [];
          let currentLen = 0;

          for (let i = 0; i < sec.boundaries.length; i++) {
            const b = sec.boundaries[i];
            currentGroup.push(b);
            currentLen += b.text.length + 1;

            const isPunct =
              b.text.endsWith('။') ||
              b.text.endsWith('၊') ||
              b.text.endsWith('?') ||
              b.text.endsWith('!');
            const isLongEnough = currentLen >= 32;
            const isMax = currentLen >= 58;

            if (isMax || (isLongEnough && isPunct) || i === sec.boundaries.length - 1) {
              const cueText = currentGroup.map((g) => g.text).join(' ');
              const scaledStart = Math.round(currentGroup[0].startMs * scale);
              const scaledEnd = Math.round(currentGroup[currentGroup.length - 1].endMs * scale);

              const startMs = baseOffsetMs + scaledStart;
              let endMs = baseOffsetMs + scaledEnd;

              if (i === sec.boundaries.length - 1) {
                endMs = baseOffsetMs + secAudioDur;
              } else {
                endMs = Math.min(endMs, baseOffsetMs + secAudioDur);
              }

              timedCues.push({
                index: timedCues.length + 1,
                startMs,
                endMs: Math.max(startMs + 200, endMs),
                text: formatBurmeseTwoLines(cueText),
              });
              currentGroup = [];
              currentLen = 0;
            }
          }
        } else {
          // Fallback if boundaries not emitted
          const fallbackCues = splitIntoBurmeseCues(sec.buffer.length > 0 ? textToSpeak : '');
          const perCueDuration = Math.round(secAudioDur / Math.max(1, fallbackCues.length));
          fallbackCues.forEach((fc, idx) => {
            timedCues.push({
              index: timedCues.length + 1,
              startMs: baseOffsetMs + idx * perCueDuration,
              endMs: baseOffsetMs + (idx === fallbackCues.length - 1 ? secAudioDur : Math.min(secAudioDur, (idx + 1) * perCueDuration)),
              text: formatBurmeseTwoLines(fc),
            });
          });
        }
        baseOffsetMs += secAudioDur;
      });

      // Clamp the final cue precisely to the total audio duration
      if (timedCues.length > 0) {
        timedCues[timedCues.length - 1].endMs = totalAudioDurationMs;
      }

      // 5. Generate pristine .SRT content
      const srtContent = timedCues
        .map((c) => `${c.index}\n${fmtSrtTime(c.startMs)} --> ${fmtSrtTime(c.endMs)}\n${c.text}\n`)
        .join('\n');

      if (returnJson) {
        return res.json({
          audioBase64: mergedAudioBuffer.toString('base64'),
          durationMs: totalAudioDurationMs,
          srt: srtContent,
          timedCues,
          cueCount: timedCues.length,
          textSpoken: textToSpeak,
        });
      }

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', mergedAudioBuffer.length);
      res.setHeader('Accept-Ranges', 'bytes');
      return res.end(mergedAudioBuffer);
    } catch (err: any) {
      console.error('Edge TTS Error:', err);
      return res.status(500).json({ error: err.message || 'Edge TTS failed' });
    }
  });

  // API Route: Server-side Gemini proxy (supports both clientKey and process.env.GEMINI_API_KEY)
  app.post('/api/gemini/translate', async (req, res) => {
    try {
      const { batch, lang, model = 'gemini-3.6-flash', clientKey } = req.body;
      const key = (clientKey || process.env.GEMINI_API_KEY || '').trim().replace(/[\r\n\t\s]/g, '');
      if (!key) {
        return res.status(400).json({ error: 'Gemini API key ထည့်သွင်းပေးပါ (CH.01 တွင် API Key ထည့်ပါ)' });
      }

      const numberedList = (batch || []).map((s: any, idx: number) => `${idx + 1}. ${s.text}`).join('\n');
      const isBurmese = (lang || '').toLowerCase().includes('burmese') || (lang || '').toLowerCase().includes('myanmar');
      const numberRule = isBurmese
        ? ' Important Burmese number rule: Always convert large numbers and English digits into natural spoken Burmese number terms (e.g. 70000 or 70,000 -> ၇ သောင်း, 10000 or 10,000 -> ၁ သောင်း, 80000 -> ၈ သောင်း, 7000 or 7,000 -> ၇ ထောင်, 8000 or 8,000 -> ၈ ထောင်, 100000 -> ၁ သိန်း, 1000000 -> ၁၀ သိန်း သို့မဟုတ် ၁ သန်း, 500 -> ၅ ရာ). Do NOT output raw multi-zero English digits like 70000 or 10000 in Burmese text.'
        : '';
      const prompt = `Translate each numbered line below into ${lang}. CRITICAL REQUIREMENT: Every single line MUST be translated completely into natural, spoken ${lang}. Even if the input line is in English or mixed English, translate ALL words into ${lang} with zero English text left untranslated. Preserve natural dialogue tone and keep it concise.${numberRule} Respond with ONLY a raw JSON array of strings, same length and same order as the input, no markdown, no code fences, no numbering in the output strings.\n\n${numberedList}`;

      const ai = new GoogleGenAI({ apiKey: key });
      const requestedModel = model && model !== '__custom__' && !model.includes('2.5') && !model.includes('2.0') && !model.includes('1.5')
        ? model
        : 'gemini-3.1-flash-lite';

      // Most resilient active model hierarchy with high-quota candidates first
      const modelCandidates = Array.from(new Set([
        requestedModel,
        'gemini-3.1-flash-lite',
        'gemini-3.5-flash',
        'gemini-3.6-flash',
      ]));

      let rawText = '';
      let lastError: any = null;

      for (const m of modelCandidates) {
        let modelSuccess = false;
        // Try up to 3 attempts per model for temporary 503 spikes
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const aiResponse = await ai.models.generateContent({
              model: m,
              contents: prompt,
              config: {
                responseMimeType: 'application/json',
                maxOutputTokens: 8192,
              },
            });
            rawText = aiResponse.text || '';
            if (rawText && rawText.trim()) {
              modelSuccess = true;
              break;
            }
          } catch (err: any) {
            lastError = err;
            // Progressive delay for temporary demand spike
            await new Promise((r) => setTimeout(r, attempt * 750));
          }
        }
        if (modelSuccess) {
          break;
        }
      }

      if (!rawText && lastError) {
        throw lastError;
      }

      let translations = safeParseTranslations(rawText, (batch || []).length);

      if (isBurmese && Array.isArray(translations)) {
        translations = translations.map((t: string) => convertNumbersInTextToBurmese(t));
      }

      return res.json({ translations });
    } catch (err: any) {
      console.error('Gemini error:', err);
      let errMsg = err.message || 'Translation failed';
      try {
        const parsed = JSON.parse(errMsg);
        if (parsed.error && parsed.error.message) {
          errMsg = parsed.error.message;
        }
      } catch {}
      return res.status(500).json({ error: errMsg });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
