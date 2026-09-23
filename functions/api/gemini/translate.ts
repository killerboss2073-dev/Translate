export const onRequestPost = async (context: any) => {
  try {
    const { batch, lang, model = 'gemini-2.5-flash', clientKey } = await context.request.json();
    const key = clientKey || context.env?.GEMINI_API_KEY;
    if (!key) {
      return new Response(JSON.stringify({ error: 'Gemini API key is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data: any = await apiRes.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
    const cleaned = rawText.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    const translations = JSON.parse(cleaned);

    return new Response(JSON.stringify({ translations }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Translation failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
