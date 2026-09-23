// Cloudflare Worker entry point
import { UniversalEdgeTTS as EdgeTTS } from 'edge-tts-universal';

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // 1. Text-to-Speech endpoint (Edge TTS)
    if (url.pathname === '/api/tts' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const {
          text,
          voice = 'my-MM-NilarNeural',
          rate = '+0%',
          pitch = '+0Hz',
          volume = '+0%',
        } = body;

        if (!text || typeof text !== 'string' || !text.trim()) {
          return new Response(JSON.stringify({ error: 'စာသား ထည့်သွင်းပေးပါ (Text is required)' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }

        const tts = new EdgeTTS(text.trim(), voice, {
          rate: rate || '+0%',
          pitch: pitch || '+0Hz',
          volume: volume || '+0%',
        });

        const result = await tts.synthesize();
        const audioBuffer = await result.audio.arrayBuffer();

        if (!audioBuffer || audioBuffer.byteLength === 0) {
          return new Response(JSON.stringify({ error: 'အသံဖိုင် မရရှိပါ (Empty audio received)' }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }

        return new Response(audioBuffer, {
          headers: {
            'Content-Type': 'audio/mpeg',
            'Content-Length': String(audioBuffer.byteLength),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=3600',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message || 'TTS Error' }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    }

    // 2. Gemini Translation Proxy endpoint
    if (url.pathname === '/api/gemini/translate' && request.method === 'POST') {
      try {
        const { batch, lang, model = 'gemini-2.5-flash', clientKey } = await request.json();
        const key = clientKey || env.GEMINI_API_KEY;
        if (!key) {
          return new Response(JSON.stringify({ error: 'Gemini API key is required' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
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
          return new Response(JSON.stringify({ error: `Gemini API error: ${errText}` }), {
            status: apiRes.status,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }

        const data: any = await apiRes.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
        const cleaned = rawText.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
        const translations = JSON.parse(cleaned);

        return new Response(JSON.stringify({ translations }), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message || 'Translation failed' }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    }

    // 3. Static assets fallback
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
