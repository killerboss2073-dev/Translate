import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { UniversalCommunicate } from 'edge-tts-universal';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Route: Edge TTS
  app.post('/api/tts', async (req, res) => {
    try {
      const { text, voice = 'my-MM-NilarNeural', rate = '+0%', pitch = '+0Hz', volume = '+0%' } = req.body;
      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'စာသား ထည့်သွင်းရန် လိုအပ်ပါသည် (Text is required)' });
      }

      const comm = new UniversalCommunicate(text.trim(), {
        voice,
        rate,
        pitch,
        volume,
      });

      const chunks: Buffer[] = [];
      for await (const chunk of comm.stream()) {
        if (chunk.type === 'audio' && chunk.data) {
          chunks.push(Buffer.from(chunk.data));
        }
      }

      if (chunks.length === 0) {
        return res.status(500).json({ error: 'အသံဖိုင် ဖန်တီးမရပါ (No audio generated)' });
      }

      const audioBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audioBuffer.length);
      res.setHeader('Accept-Ranges', 'bytes');
      return res.end(audioBuffer);
    } catch (err: any) {
      console.error('Edge TTS Error:', err);
      return res.status(500).json({ error: err.message || 'Edge TTS failed' });
    }
  });

  // API Route: Server-side Gemini proxy (optional fallback if user doesn't provide client key)
  app.post('/api/gemini/translate', async (req, res) => {
    try {
      const { batch, lang, model = 'gemini-2.5-flash', clientKey } = req.body;
      const key = clientKey || process.env.GEMINI_API_KEY;
      if (!key) {
        return res.status(400).json({ error: 'Gemini API key is required' });
      }

      const numberedList = (batch || []).map((s: any, idx: number) => `${idx + 1}. ${s.text}`).join('\n');
      const prompt = `Translate each numbered line below into ${lang}. Preserve meaning and natural tone; keep it concise like spoken dialogue. Respond with ONLY a raw JSON array of strings, same length and same order as the input, no markdown, no code fences, no numbering in the output strings.\n\n${numberedList}`;

      const apiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              maxOutputTokens: 8192,
            },
          }),
        }
      );

      if (!apiRes.ok) {
        const errText = await apiRes.text();
        return res.status(apiRes.status).json({ error: `Gemini API error: ${errText}` });
      }

      const data = await apiRes.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
      const cleaned = rawText.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
      const translations = JSON.parse(cleaned);
      return res.json({ translations });
    } catch (err: any) {
      console.error('Gemini error:', err);
      return res.status(500).json({ error: err.message || 'Translation failed' });
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
