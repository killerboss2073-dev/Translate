// Cloudflare Worker entry point
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
          return new Response(JSON.stringify({ error: 'Text is required' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }

        const TRUSTED_TOKEN = '6A5AA1D4EA6540818367A6888D30C3FD';
        // Note: fetch() with Upgrade: websocket requires https:// in Cloudflare Workers
        const wsUrl = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_TOKEN}`;

        const resp = await fetch(wsUrl, {
          headers: {
            Upgrade: 'websocket',
            Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
            Pragma: 'no-cache',
            'Cache-Control': 'no-cache',
          },
        });

        const webSocket = (resp as any).webSocket;
        if (!webSocket) {
          return new Response(
            JSON.stringify({ error: 'Failed to establish WebSocket connection with Edge TTS' }),
            {
              status: 502,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            }
          );
        }

        webSocket.accept();

        const date = new Date().toUTCString();
        const requestId = crypto.randomUUID().replace(/-/g, '');

        // 1. Send speech config
        webSocket.send(
          `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`
        );

        // Escape XML for SSML
        const safeText = text
          .trim()
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');

        const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='my-MM'><voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>${safeText}</prosody></voice></speak>`;

        // 2. Send SSML request
        webSocket.send(
          `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${date}Z\r\nPath:ssml\r\n\r\n${ssml}`
        );

        const audioChunks: Uint8Array[] = [];

        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            try {
              webSocket.close();
            } catch {}
            resolve();
          }, 25000);

          webSocket.addEventListener('message', (event: any) => {
            if (typeof event.data === 'string') {
              if (event.data.includes('Path:turn.end')) {
                clearTimeout(timer);
                try {
                  webSocket.close();
                } catch {}
                resolve();
              }
            } else if (event.data instanceof ArrayBuffer) {
              const buffer = new Uint8Array(event.data);
              if (buffer.length > 2) {
                const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
                const headerLength = dataView.getUint16(0);
                if (headerLength > 0 && 2 + headerLength < buffer.length) {
                  const audioData = buffer.slice(2 + headerLength);
                  if (audioData.length > 0) {
                    audioChunks.push(audioData);
                  }
                } else {
                  // Fallback: search for \r\n\r\n
                  for (let i = 0; i < Math.min(buffer.length - 3, 400); i++) {
                    if (
                      buffer[i] === 13 &&
                      buffer[i + 1] === 10 &&
                      buffer[i + 2] === 13 &&
                      buffer[i + 3] === 10
                    ) {
                      const audioData = buffer.slice(i + 4);
                      if (audioData.length > 0) {
                        audioChunks.push(audioData);
                      }
                      break;
                    }
                  }
                }
              }
            }
          });

          webSocket.addEventListener('close', () => {
            clearTimeout(timer);
            resolve();
          });

          webSocket.addEventListener('error', () => {
            clearTimeout(timer);
            resolve();
          });
        });

        const totalLength = audioChunks.reduce((acc, c) => acc + c.length, 0);
        if (totalLength === 0) {
          return new Response(
            JSON.stringify({ error: 'No audio received from Edge TTS service' }),
            {
              status: 500,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            }
          );
        }

        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of audioChunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }

        return new Response(result, {
          headers: {
            'Content-Type': 'audio/mpeg',
            'Content-Length': String(totalLength),
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
