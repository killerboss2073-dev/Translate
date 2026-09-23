import { UniversalEdgeTTS as EdgeTTS } from 'edge-tts-universal';

export const onRequestPost = async (context: any) => {
  try {
    const { text, voice = 'my-MM-NilarNeural', rate = '+0%', pitch = '+0Hz', volume = '+0%' } = await context.request.json();
    if (!text || typeof text !== 'string' || !text.trim()) {
      return new Response(JSON.stringify({ error: 'စာသား ထည့်သွင်းပေးပါ (Text is required)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
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
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
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
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};
