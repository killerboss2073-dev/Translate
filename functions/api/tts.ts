const WIN_EPOCH = 11644473600;
const S_TO_NS = 1e9;
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;

const BURMESE_DIGITS = ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉'];
const DIGIT_MAP: Record<string, string> = {
  '0': '0', '1': '1', '2': '2', '3': '3', '4': '4',
  '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  '၀': '0', '၁': '1', '၂': '2', '၃': '3', '၄': '4',
  '၅': '5', '၆': '6', '၇': '7', '၈': '8', '၉': '9',
};

function toBurmeseDigits(numStr: number | string): string {
  return String(numStr).split('').map((c) => (c >= '0' && c <= '9' ? BURMESE_DIGITS[Number(c)] : c)).join('');
}

function normalizeToStandardDigits(str: string): string {
  return String(str).replace(/[၀-၉]/g, (d) => DIGIT_MAP[d] || d).replace(/,/g, '').trim();
}

function numberToBurmeseSpoken(num: number | string): string | null {
  if (typeof num === 'string') {
    num = Number(normalizeToStandardDigits(num));
  }
  if (isNaN(num) || num < 0 || !Number.isInteger(num)) return null;
  if (num === 0) return '၀';

  const parts: string[] = [];
  let n = num;

  const than = Math.floor(n / 1000000);
  if (than > 0) {
    parts.push(toBurmeseDigits(than) + ' သန်း');
    n %= 1000000;
  }

  const thein = Math.floor(n / 100000);
  if (thein > 0) {
    parts.push(toBurmeseDigits(thein) + ' သိန်း');
    n %= 100000;
  }

  const thaung = Math.floor(n / 10000);
  if (thaung > 0) {
    parts.push(toBurmeseDigits(thaung) + ' သောင်း');
    n %= 10000;
  }

  const htaung = Math.floor(n / 1000);
  if (htaung > 0) {
    parts.push(toBurmeseDigits(htaung) + ' ထောင်');
    n %= 1000;
  }

  const yar = Math.floor(n / 100);
  if (yar > 0) {
    parts.push(toBurmeseDigits(yar) + ' ရာ');
    n %= 100;
  }

  const sel = Math.floor(n / 10);
  if (sel > 0) {
    parts.push(toBurmeseDigits(sel) + ' ဆယ်');
    n %= 10;
  }

  if (n > 0) {
    parts.push(toBurmeseDigits(n));
  }

  return parts.join(' ');
}

function convertNumbersInTextToBurmese(text: string): string {
  if (!text) return text;
  return text.replace(/(?:\b|\s|^|[^\w\d])([0-9၀-၉]{1,3}(?:,[0-9၀-၉]{3})+|[0-9၀-၉]{2,})(?=\b|\s|$|[^\w\d])/gu, (match, numGroup) => {
    const rawVal = Number(normalizeToStandardDigits(numGroup));
    if (!isNaN(rawVal) && rawVal >= 10) {
      const spoken = numberToBurmeseSpoken(rawVal);
      if (spoken) {
        return match.replace(numGroup, spoken);
      }
    }
    return match;
  });
}

async function generateSecMsGec(): Promise<string> {
  let ticks = Date.now() / 1000;
  ticks += WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= S_TO_NS / 100;
  const strToHash = `${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(strToHash));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function generateMuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export const onRequestPost = async (context: any) => {
  try {
    const { text, voice = 'my-MM-NilarNeural', rate = '+0%', pitch = '+0Hz', volume = '+0%' } = await context.request.json();
    if (!text || typeof text !== 'string' || !text.trim()) {
      return new Response(JSON.stringify({ error: 'စာသား ထည့်သွင်းပေးပါ (Text is required)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const secMsGec = await generateSecMsGec();
    const connectionId = crypto.randomUUID().replace(/-/g, '');
    const wsUrl = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${connectionId}`;

    const resp = await fetch(wsUrl, {
      headers: {
        Upgrade: 'websocket',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9',
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        Cookie: `muid=${generateMuid()};`,
      },
    });

    const webSocket = (resp as any).webSocket;
    if (!webSocket) {
      return new Response(
        JSON.stringify({ error: 'Edge TTS ဆာဗာ ချိတ်ဆက်မရပါ (Failed to establish WebSocket connection)' }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        }
      );
    }

    webSocket.accept();

    const date = new Date().toUTCString();
    const requestId = crypto.randomUUID().replace(/-/g, '');

    webSocket.send(
      `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`
    );

    const textToSynthesize = convertNumbersInTextToBurmese(text.trim());

    const safeText = textToSynthesize
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='my-MM'><voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>${safeText}</prosody></voice></speak>`;

    webSocket.send(
      `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${date}Z\r\nPath:ssml\r\n\r\n${ssml}`
    );

    const audioChunks: Uint8Array[] = [];

    await new Promise<void>((resolve) => {
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
        JSON.stringify({ error: 'အသံဖိုင်ဒေတာ မရရှိပါ (No audio received from Edge TTS service)' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
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
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};
