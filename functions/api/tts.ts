export const onRequestPost = async (context: any) => {
  try {
    const { text, voice = 'my-MM-NilarNeural', rate = '+0%', pitch = '+0Hz', volume = '+0%' } = await context.request.json();
    if (!text || typeof text !== 'string' || !text.trim()) {
      return new Response(JSON.stringify({ error: 'Text is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const TRUSTED_TOKEN = '6A5AA1D4EA6540818367A6888D30C3FD';
    const wsUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_TOKEN}`;

    const resp = await fetch(wsUrl, {
      headers: {
        Upgrade: 'websocket',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      },
    });

    const webSocket = (resp as any).webSocket;
    if (!webSocket) {
      return new Response(JSON.stringify({ error: 'Failed to establish WebSocket connection with Edge TTS' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    webSocket.accept();

    const date = new Date().toUTCString();
    const requestId = crypto.randomUUID().replace(/-/g, '');

    // Speech config
    webSocket.send(
      `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`
    );

    const safeText = text
      .trim()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='my-MM'><voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>${safeText}</prosody></voice></speak>`;

    webSocket.send(
      `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${date}Z\r\nPath:ssml\r\n\r\n${ssml}`
    );

    const audioChunks: Uint8Array[] = [];

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => resolve(), 20000);

      webSocket.addEventListener('message', (event: any) => {
        if (typeof event.data === 'string') {
          if (event.data.includes('Path:turn.end')) {
            clearTimeout(timer);
            resolve();
          }
        } else if (event.data instanceof ArrayBuffer) {
          const buffer = new Uint8Array(event.data);
          const headerString = new TextDecoder().decode(buffer.slice(0, 250));
          const headerEndIndex = headerString.indexOf('\r\n\r\n');
          if (headerEndIndex !== -1) {
            audioChunks.push(buffer.slice(headerEndIndex + 4));
          }
        }
      });

      webSocket.addEventListener('close', () => {
        clearTimeout(timer);
        resolve();
      });

      webSocket.addEventListener('error', (err: any) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    try {
      webSocket.close();
    } catch {}

    const totalLength = audioChunks.reduce((acc, c) => acc + c.length, 0);
    if (totalLength === 0) {
      return new Response(JSON.stringify({ error: 'No audio received from Edge TTS service' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
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
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'TTS Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
