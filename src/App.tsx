/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Key,
  UploadCloud,
  FileText,
  Languages,
  Volume2,
  Play,
  Pause,
  Download,
  Copy,
  Trash2,
  RefreshCw,
  Sparkles,
  Check,
  Send,
  Square,
  FastForward,
  User,
  Sliders,
  Radio,
  ExternalLink,
  MessageCircle,
  HelpCircle,
  AlertCircle
} from 'lucide-react';

interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
  translated: string | null;
  hasTimestamp: boolean;
}

const STORAGE_KEY = 'signalpath_settings_v2';

const BURMESE_VOICES = [
  {
    id: 'my-MM-NilarNeural',
    name: 'နီလာ (Nilar)',
    gender: 'Female (အမျိုးသမီး)',
    desc: 'ကြည်လင်ပျော့ပျောင်းသော သဘာဝအမျိုးသမီးအသံ',
    badge: 'Female',
  },
  {
    id: 'my-MM-ThihaNeural',
    name: 'သီဟ (Thiha)',
    gender: 'Male (အမျိုးသား)',
    desc: 'တည်ကြည်ပြတ်သားသော သဘာဝအမျိုးသားအသံ',
    badge: 'Male',
  },
];

const OTHER_VOICES = [
  { id: 'en-US-JennyNeural', name: 'English (US) - Jenny (Female)', lang: 'English' },
  { id: 'en-US-GuyNeural', name: 'English (US) - Guy (Male)', lang: 'English' },
  { id: 'th-TH-PremwadeeNeural', name: 'Thai (ไทย) - Premwadee (Female)', lang: 'Thai' },
  { id: 'th-TH-NiwatNeural', name: 'Thai (ไทย) - Niwat (Male)', lang: 'Thai' },
  { id: 'zh-CN-XiaoxiaoNeural', name: 'Chinese (中文) - Xiaoxiao (Female)', lang: 'Chinese' },
  { id: 'ja-JP-NanamiNeural', name: 'Japanese (日本語) - Nanami (Female)', lang: 'Japanese' },
];

function fmtTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtSrtTime(ms: number): string {
  const totalMs = Math.max(0, Math.floor(ms));
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const msPart = totalMs % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(msPart).padStart(3, '0')}`;
}

function srtTimeToMs(t: string): number {
  const m = t.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
  if (!m) return 0;
  const [, h, mi, s, ms] = m;
  return +h * 3600000 + +mi * 60000 + +s * 1000 + +ms;
}

function looksLikeSrt(raw: string): boolean {
  return /^\s*\d+\s*[\r\n]+\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/m.test(raw);
}

function parseSrt(raw: string): Segment[] {
  const blocks = raw.replace(/\r\n/g, '\n').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const out: Segment[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split('\n');
    let idx = 0;
    if (/^\d+$/.test(lines[0].trim())) idx = 1;
    const timeLine = lines[idx] || '';
    const tm = timeLine.match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/);
    if (!tm) continue;
    const start = srtTimeToMs(tm[1]);
    const end = srtTimeToMs(tm[2]);
    const text = lines.slice(idx + 1).join(' ').trim();
    if (!text) continue;
    out.push({
      id: 'seg-' + (i + 1),
      start,
      end,
      text,
      translated: null,
      hasTimestamp: true
    });
  }
  return out;
}

function splitTextToSegments(raw: string): Segment[] {
  if (looksLikeSrt(raw)) {
    const parsed = parseSrt(raw);
    if (parsed.length > 0) return parsed;
  }

  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let pieces: string[] = [];
  if (lines.length > 1) {
    pieces = lines;
  } else {
    const single = lines[0] || '';
    pieces = single
      .split(/(?<=[။၊.!?])\s+/)
      .map(s => s.trim())
      .filter(Boolean);
    if (pieces.length === 0 && single) pieces = [single];
  }

  const SPACING_MS = 3000;
  return pieces.map((text, idx) => ({
    id: 'seg-' + (idx + 1),
    start: idx * SPACING_MS,
    end: idx * SPACING_MS + SPACING_MS - 200,
    text,
    translated: null,
    hasTimestamp: false
  }));
}

export default function App() {
  // CH.01 Keys & Models
  const [assemblyKey, setAssemblyKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash');
  const [customModel, setCustomModel] = useState('');

  // CH.02 Source Audio
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [transStatus, setTransStatus] = useState<'IDLE' | 'UPLOADING' | 'QUEUED' | 'TRANSCRIBING' | 'DONE' | 'ERROR'>('IDLE');
  const [transProgress, setTransProgress] = useState('');
  const [transErr, setTransErr] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // CH.03 Paste Text
  const [pasteText, setPasteText] = useState('');
  const [pasteErr, setPasteErr] = useState('');
  const [pasteStatus, setPasteStatus] = useState<'IDLE' | 'LOADED'>('IDLE');

  // CH.04 Transcript
  const [segments, setSegments] = useState<Segment[]>([]);

  // CH.05 Translate
  const [targetLang, setTargetLang] = useState('Burmese (Myanmar)');
  const [customLang, setCustomLang] = useState('');
  const [translateStatus, setTranslateStatus] = useState<'IDLE' | 'WAITING' | 'READY' | 'TRANSLATING' | 'DONE' | 'ERROR'>('IDLE');
  const [translateProgress, setTranslateProgress] = useState('');
  const [translateErr, setTranslateErr] = useState('');
  const [copiedStatus, setCopiedStatus] = useState(false);

  // CH.06 Edge TTS
  const [ttsVoice, setTtsVoice] = useState<'my-MM-NilarNeural' | 'my-MM-ThihaNeural' | string>('my-MM-NilarNeural');
  const [ttsSourceMode, setTtsSourceMode] = useState<'transcript' | 'custom'>('transcript');
  const [customTtsText, setCustomTtsText] = useState('မင်္ဂလာပါရှင်။ Translate Tool မှ ကြိုဆိုပါတယ်။');
  const [ttsRate, setTtsRate] = useState(0); // -50 to +50 percent
  const [ttsPitch, setTtsPitch] = useState(0); // -50 to +50 Hz
  const [ttsVolume, setTtsVolume] = useState(0); // -50 to +50 percent
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsErr, setTtsErr] = useState('');
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const [ttsAudioBlob, setTtsAudioBlob] = useState<Blob | null>(null);
  const [activeSegmentTtsId, setActiveSegmentTtsId] = useState<string | null>(null);

  // Audio player state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);

  // Load saved settings
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (data.assemblyKey) setAssemblyKey(data.assemblyKey);
        if (data.geminiKey) setGeminiKey(data.geminiKey);
        if (data.geminiModel) setGeminiModel(data.geminiModel);
        if (data.customModel) setCustomModel(data.customModel);
        if (data.targetLang) setTargetLang(data.targetLang);
        if (data.customLang) setCustomLang(data.customLang);
        if (data.ttsVoice) setTtsVoice(data.ttsVoice);
      }
    } catch {
      // ignore
    }
  }, []);

  // Save settings on change
  useEffect(() => {
    try {
      const data = {
        assemblyKey,
        geminiKey,
        geminiModel,
        customModel,
        targetLang,
        customLang,
        ttsVoice,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // ignore
    }
  }, [assemblyKey, geminiKey, geminiModel, customModel, targetLang, customLang, ttsVoice]);

  // Audio player event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setAudioCurrentTime(0);
    };
    const onTimeUpdate = () => setAudioCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => setAudioDuration(audio.duration || 0);

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [ttsAudioUrl]);

  // Handle file select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setSelectedFile(f);
    setTransErr('');
    setTransStatus('IDLE');
  };

  // CH.03 Use Pasted Text
  const handleUsePastedText = () => {
    setPasteErr('');
    if (!pasteText.trim()) {
      setPasteErr('ဘာသာပြန်ချင်သော စာသားကို အရင်ဆုံး ထည့်သွင်းပေးပါ။');
      return;
    }
    const parsed = splitTextToSegments(pasteText);
    setSegments(parsed);
    setPasteStatus('LOADED');
    setTranslateStatus('READY');
  };

  const handleClearPastedText = () => {
    setPasteText('');
    setPasteStatus('IDLE');
    setPasteErr('');
  };

  // CH.02 AssemblyAI Transcription
  const handleTranscribe = async () => {
    setTransErr('');
    const key = assemblyKey.trim();
    if (!key) {
      setTransErr('CH.01 တွင် AssemblyAI API Key ကို အရင်ဖြည့်သွင်းပေးပါ။');
      return;
    }
    if (!selectedFile) {
      setTransErr('အသံ သို့မဟုတ် ဗီဒီယို ဖိုင်ကို အရင်ရွေးချယ်ပေးပါ။');
      return;
    }

    setTransStatus('UPLOADING');
    setTransProgress('ဖိုင်ကို AssemblyAI သို့ upload ပြုလုပ်နေပါသည်…');

    try {
      // 1. Upload
      const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
        method: 'POST',
        headers: { authorization: key },
        body: selectedFile,
      });
      if (!uploadRes.ok) {
        throw new Error(`Upload မအောင်မြင်ပါ (${uploadRes.status}): ${await uploadRes.text()}`);
      }
      const uploadData = await uploadRes.json();
      const audioUrl = uploadData.upload_url;

      // 2. Submit transcription job
      setTransStatus('QUEUED');
      setTransProgress('Transcription စတင်ရန် အချက်အလက်ပို့ဆောင်နေပါသည်…');
      const createRes = await fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'POST',
        headers: {
          authorization: key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audio_url: audioUrl,
          punctuate: true,
          format_text: true,
        }),
      });
      if (!createRes.ok) {
        throw new Error(`Job စတင်၍ မရပါ (${createRes.status}): ${await createRes.text()}`);
      }
      const createData = await createRes.json();
      const transcriptId = createData.id;

      // 3. Poll for result
      setTransStatus('TRANSCRIBING');
      let status = createData.status;
      let pollData = createData;
      let dots = 0;

      while (status !== 'completed' && status !== 'error') {
        await new Promise((r) => setTimeout(r, 3000));
        dots = (dots + 1) % 4;
        setTransProgress(`အသံဖိုင်ကို စာသားပြောင်းနေပါသည်${'.'.repeat(dots)} (ခဏစောင့်ဆိုင်းပါ)`);
        const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
          headers: { authorization: key },
        });
        if (!pollRes.ok) throw new Error(`Polling မအောင်မြင်ပါ (${pollRes.status})`);
        pollData = await pollRes.json();
        status = pollData.status;
      }

      if (status === 'error') {
        throw new Error(`AssemblyAI Error: ${pollData.error || 'အသံဖိုင် စာသားပြောင်းမရပါ'}`);
      }

      // 4. Fetch sentences
      setTransProgress('Timestamp စာကြောင်းများ ရယူနေပါသည်…');
      const sentRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}/sentences`, {
        headers: { authorization: key },
      });
      let sentences: any[] = [];
      if (sentRes.ok) {
        const sentData = await sentRes.json();
        sentences = sentData.sentences || [];
      }
      if (sentences.length === 0 && pollData.text) {
        sentences = [{ start: 0, end: pollData.audio_duration ? pollData.audio_duration * 1000 : 0, text: pollData.text }];
      }

      const parsedSegs: Segment[] = sentences.map((s, idx) => ({
        id: `seg-${idx + 1}`,
        start: s.start,
        end: s.end,
        text: s.text,
        translated: null,
        hasTimestamp: true,
      }));

      setSegments(parsedSegs);
      setTransStatus('DONE');
      setTransProgress(`ပြီးပါပြီ — စာကြောင်းပေါင်း ${parsedSegs.length} ခု ရရှိပါသည်။`);
      setTranslateStatus('READY');
    } catch (err: any) {
      setTransStatus('ERROR');
      setTransErr(err.message || String(err));
    }
  };

  // CH.05 Gemini Translation Helper
  const currentLangName = targetLang === '__custom__' ? (customLang.trim() || 'Burmese') : targetLang;
  const currentModelName = geminiModel === '__custom__' ? (customModel.trim() || 'gemini-2.5-flash') : geminiModel;

  const handleTranslate = async () => {
    setTranslateErr('');
    if (segments.length === 0) {
      setTranslateErr('ဘာသာပြန်ရန် စာသား (Segments) မရှိသေးပါ။ CH.02 သို့မဟုတ် CH.03 တွင် စာသားအရင်ထည့်ပါ။');
      return;
    }

    setTranslateStatus('TRANSLATING');
    const BATCH = 15;
    const updatedSegments = [...segments];

    try {
      for (let i = 0; i < updatedSegments.length; i += BATCH) {
        const batch = updatedSegments.slice(i, i + BATCH);
        setTranslateProgress(`စာကြောင်း ${i + 1} မှ ${Math.min(i + BATCH, updatedSegments.length)} အထိ ${currentLangName} သို့ ဘာသာပြန်နေပါသည်…`);

        // Try backend route first
        let translations: string[] = [];
        try {
          const res = await fetch('/api/gemini/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              batch,
              lang: currentLangName,
              model: currentModelName,
              clientKey: geminiKey.trim(),
            }),
          });
          if (res.ok) {
            const data = await res.json();
            translations = data.translations || [];
          } else {
            throw new Error(await res.text());
          }
        } catch (backendErr) {
          // If backend fails or client has direct key, call direct
          const key = geminiKey.trim();
          if (!key) throw new Error('Gemini API key is required. Please add your key in CH.01.');

          const numberedList = batch.map((s, idx) => `${idx + 1}. ${s.text}`).join('\n');
          const prompt = `Translate each numbered line below into ${currentLangName}. Preserve natural tone and spoken nuances. Return ONLY a valid JSON array of strings in the exact same length and order as input.\n\n${numberedList}`;

          const directRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(currentModelName)}:generateContent?key=${encodeURIComponent(key)}`,
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
          if (!directRes.ok) throw new Error(`Gemini Error: ${await directRes.text()}`);
          const dData = await directRes.json();
          const rawText = dData?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
          const cleaned = rawText.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
          translations = JSON.parse(cleaned);
        }

        // Apply translations
        for (let j = 0; j < batch.length; j++) {
          if (translations[j]) {
            updatedSegments[i + j].translated = translations[j];
          }
        }
        setSegments([...updatedSegments]);
      }

      setTranslateStatus('DONE');
      setTranslateProgress(`ဘာသာပြန်ခြင်း ပြီးစီးပါပြီ (${currentLangName}) ✓`);
    } catch (err: any) {
      setTranslateStatus('ERROR');
      setTranslateErr(err.message || String(err));
    }
  };

  // Export functions
  const downloadFile = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportSrt = () => {
    const lines = segments
      .map((s, idx) => {
        const text = s.translated || s.text;
        return `${idx + 1}\n${fmtSrtTime(s.start)} --> ${fmtSrtTime(s.end)}\n${text}\n`;
      })
      .join('\n');
    downloadFile('subtitles.srt', lines, 'application/x-subrip');
  };

  const handleExportTxt = () => {
    const lines = segments
      .map((s) => `${s.hasTimestamp ? `[${fmtTime(s.start)}] ` : ''}${s.text}${s.translated ? '\n       → ' + s.translated : ''}`)
      .join('\n\n');
    downloadFile('transcript.txt', lines, 'text/plain');
  };

  const handleCopyTranslation = async () => {
    const text = segments.map((s) => s.translated || s.text).join('\n');
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedStatus(true);
      setTimeout(() => setCopiedStatus(false), 2500);
    } catch {
      // fallback
    }
  };

  // CH.06 Edge TTS Core Generator
  const generateSpeech = async (textToSpeak: string, customVoice?: string): Promise<Blob> => {
    const voiceToUse = customVoice || ttsVoice;
    const rateStr = `${ttsRate >= 0 ? '+' : ''}${ttsRate}%`;
    const pitchStr = `${ttsPitch >= 0 ? '+' : ''}${ttsPitch}Hz`;
    const volumeStr = `${ttsVolume >= 0 ? '+' : ''}${ttsVolume}%`;

    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: textToSpeak,
        voice: voiceToUse,
        rate: rateStr,
        pitch: pitchStr,
        volume: volumeStr,
      }),
    });

    const contentType = res.headers.get('content-type') || '';

    if (!res.ok || !contentType.includes('audio')) {
      let errMsg = 'အသံဖိုင် ဖန်တီးမရပါ';
      try {
        const textData = await res.text();
        try {
          const json = JSON.parse(textData);
          errMsg = json.error || errMsg;
        } catch {
          if (textData && !textData.includes('<!doctype') && !textData.includes('<html') && textData.length < 200) {
            errMsg = textData;
          } else {
            errMsg = `Server Error (${res.status}): ကျေးဇူးပြု၍ ပြန်လည်ကြိုးစားပါ`;
          }
        }
      } catch {
        errMsg = `Request failed with status ${res.status}`;
      }
      throw new Error(errMsg);
    }

    return await res.blob();
  };

  // Handle Full TTS Generate
  const handleGenerateTTS = async () => {
    setTtsErr('');
    let textToSpeak = '';

    if (ttsSourceMode === 'transcript') {
      const translatedLines = segments.map((s) => s.translated || s.text).filter(Boolean);
      if (translatedLines.length === 0) {
        setTtsErr('အသံထုတ်ရန် စာသား မရှိသေးပါ။ CH.04 သို့မဟုတ် CH.05 တွင် ဘာသာပြန်ပါ သို့မဟုတ် "စာသားတိုက်ရိုက်ရိုက်ထည့်ရန်" ကို ရွေးချယ်ပါ။');
        return;
      }
      textToSpeak = translatedLines.join(' ။ ');
    } else {
      if (!customTtsText.trim()) {
        setTtsErr('အသံထုတ်ချင်သော စာသားကို ရိုက်ထည့်ပေးပါ။');
        return;
      }
      textToSpeak = customTtsText.trim();
    }

    setTtsLoading(true);

    try {
      const blob = await generateSpeech(textToSpeak);
      const url = URL.createObjectURL(blob);

      if (ttsAudioUrl) {
        URL.revokeObjectURL(ttsAudioUrl);
      }

      setTtsAudioBlob(blob);
      setTtsAudioUrl(url);

      // Auto play
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      setTtsErr(err.message || String(err));
    } finally {
      setTtsLoading(false);
    }
  };

  // Play individual segment TTS
  const handleSpeakSegment = async (seg: Segment) => {
    const text = seg.translated || seg.text;
    if (!text.trim()) return;

    setActiveSegmentTtsId(seg.id);
    try {
      const blob = await generateSpeech(text);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => {
        setActiveSegmentTtsId(null);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        setActiveSegmentTtsId(null);
      };
      await audio.play();
    } catch (err: any) {
      alert(`TTS အမှား: ${err.message || err}`);
      setActiveSegmentTtsId(null);
    }
  };

  // Audio Player Controls
  const togglePlayPause = () => {
    if (!audioRef.current || !ttsAudioUrl) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    const target = Number(e.target.value);
    audioRef.current.currentTime = target;
    setAudioCurrentTime(target);
  };

  const handleDownloadTTS = () => {
    if (!ttsAudioBlob) return;
    const voiceLabel = ttsVoice === 'my-MM-NilarNeural' ? 'nilar' : ttsVoice === 'my-MM-ThihaNeural' ? 'thiha' : 'voice';
    const filename = `edge-tts-${voiceLabel}-${Date.now()}.mp3`;
    const url = URL.createObjectURL(ttsAudioBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const isReady = (assemblyKey.trim() && geminiKey.trim()) || segments.length > 0;
  const isBusy = transStatus === 'TRANSCRIBING' || transStatus === 'UPLOADING' || translateStatus === 'TRANSLATING' || ttsLoading;

  return (
    <div className="min-h-screen bg-[#0B0E11] text-[#EDF2F5] pb-24 px-4 sm:px-6 pt-6 font-['Inter','Noto_Sans_Myanmar',sans-serif]">
      {/* Hidden audio element for global playback */}
      <audio ref={audioRef} preload="metadata" />

      <div className="max-w-[920px] mx-auto">
        {/* ===== Nameplate Header ===== */}
        <header className="flex items-center justify-between pb-5 mb-7 border-b border-[#2A323C]">
          <div className="flex items-baseline gap-3">
            <h1 className="font-['Space_Grotesk'] text-2xl font-bold tracking-wide">
              Translate<span className="text-[#3ED6B5]">Tool</span>
            </h1>
            <span className="font-['JetBrains_Mono'] text-[11px] text-[#5C6672] uppercase tracking-wider hidden sm:inline">
              Transcribe · Translate · Edge TTS
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-['JetBrains_Mono'] text-[#9AA7B2] hidden md:inline">
              {segments.length > 0 ? `${segments.length} Segments` : 'Ready'}
            </span>
            <div
              className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                isBusy
                  ? 'bg-[#F2A93B] shadow-[0_0_10px_2px_#F2A93B] animate-pulse-dot'
                  : isReady
                  ? 'bg-[#3ED6B5] shadow-[0_0_8px_1px_#3ED6B5]'
                  : 'bg-[#5C6672]'
              }`}
              title={isBusy ? 'Busy Processing' : isReady ? 'System Ready' : 'Idle'}
            />
          </div>
        </header>

        {/* ===== CH.01 — API KEYS ===== */}
        <section className="bg-[#141920] border border-[#2A323C] rounded-lg mb-5 overflow-hidden shadow-lg">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[#2A323C] bg-gradient-to-b from-white/[0.03] to-transparent">
            <span className="font-['JetBrains_Mono'] text-[11px] font-bold px-2 py-0.5 rounded bg-[#3ED6B5] text-[#0B0E11]">
              CH.01
            </span>
            <div className="flex items-center gap-2 font-['Space_Grotesk'] font-semibold text-[15px] flex-1">
              <Key className="w-4 h-4 text-[#3ED6B5]" />
              API Keys & Settings
            </div>
            <div className="font-['JetBrains_Mono'] text-[10px] tracking-wider uppercase font-semibold">
              {assemblyKey.trim() || geminiKey.trim() ? (
                <span className="text-[#3ED6B5]">CONFIGURED</span>
              ) : (
                <span className="text-[#5C6672]">OPTIONAL / DEFAULT</span>
              )}
            </div>
          </div>

          <div className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block font-['JetBrains_Mono'] text-[10px] text-[#9AA7B2] uppercase tracking-wider mb-1.5">
                  AssemblyAI API Key (အသံဖိုင် စာသားပြောင်းရန်)
                </label>
                <input
                  type="password"
                  value={assemblyKey}
                  onChange={(e) => setAssemblyKey(e.target.value)}
                  placeholder="••••••••••••••••••••••••••"
                  className="w-full bg-[#0B0E11] border border-[#2A323C] text-[#EDF2F5] px-3 py-2 rounded font-['JetBrains_Mono'] text-xs focus:border-[#3ED6B5] outline-none transition"
                />
                <div className="text-[11px] text-[#5C6672] mt-1 flex items-center justify-between">
                  <span>Audio/Video transcribe အတွက် လိုအပ်ပါသည်</span>
                  <a
                    href="https://www.assemblyai.com/dashboard"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#3ED6B5] hover:underline flex items-center gap-1"
                  >
                    Get Key <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              <div>
                <label className="block font-['JetBrains_Mono'] text-[10px] text-[#9AA7B2] uppercase tracking-wider mb-1.5">
                  Gemini API Key (ဘာသာပြန်ရန်)
                </label>
                <input
                  type="password"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="AI Studio API Key"
                  className="w-full bg-[#0B0E11] border border-[#2A323C] text-[#EDF2F5] px-3 py-2 rounded font-['JetBrains_Mono'] text-xs focus:border-[#3ED6B5] outline-none transition"
                />
                <div className="text-[11px] text-[#5C6672] mt-1 flex items-center justify-between">
                  <span>ထည့်မထားပါက Built-in Server AI ဖြင့် ဘာသာပြန်ပါမည်</span>
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#3ED6B5] hover:underline flex items-center gap-1"
                  >
                    Get Key <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-4 items-center">
              <div className="w-full sm:w-auto min-w-[240px]">
                <label className="block font-['JetBrains_Mono'] text-[10px] text-[#9AA7B2] uppercase tracking-wider mb-1">
                  Gemini Model
                </label>
                <select
                  value={geminiModel}
                  onChange={(e) => setGeminiModel(e.target.value)}
                  className="w-full bg-[#0B0E11] border border-[#2A323C] text-[#EDF2F5] px-3 py-2 rounded font-['JetBrains_Mono'] text-xs focus:border-[#3ED6B5] outline-none cursor-pointer"
                >
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash (မြန်ဆန်တိကျ)</option>
                  <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                  <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                  <option value="__custom__">Custom Model ID…</option>
                </select>
              </div>

              {geminiModel === '__custom__' && (
                <div className="w-full sm:w-auto flex-1">
                  <label className="block font-['JetBrains_Mono'] text-[10px] text-[#9AA7B2] uppercase tracking-wider mb-1">
                    Custom Model Name
                  </label>
                  <input
                    type="text"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder="e.g. gemini-2.5-flash"
                    className="w-full bg-[#0B0E11] border border-[#2A323C] text-[#EDF2F5] px-3 py-2 rounded font-['JetBrains_Mono'] text-xs focus:border-[#3ED6B5] outline-none"
                  />
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ===== CH.02 — SOURCE AUDIO / VIDEO ===== */}
        <section className="bg-[#141920] border border-[#2A323C] rounded-lg mb-5 overflow-hidden shadow-lg">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[#2A323C] bg-gradient-to-b from-white/[0.03] to-transparent">
            <span className="font-['JetBrains_Mono'] text-[11px] font-bold px-2 py-0.5 rounded bg-[#3ED6B5] text-[#0B0E11]">
              CH.02
            </span>
            <div className="flex items-center gap-2 font-['Space_Grotesk'] font-semibold text-[15px] flex-1">
              <UploadCloud className="w-4 h-4 text-[#3ED6B5]" />
              Source Audio / Video (အသံဖိုင် စာသားပြောင်းရန်)
            </div>
            <span className="font-['JetBrains_Mono'] text-[10px] tracking-wider uppercase text-[#9AA7B2]">
              {transStatus}
            </span>
          </div>

          <div className="p-5">
            {/* File Dropzone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all duration-200 relative ${
                selectedFile
                  ? 'border-[#3ED6B5] bg-[#3ED6B5]/5'
                  : 'border-[#2A323C] hover:border-[#3ED6B5]/50 hover:bg-[#3ED6B5]/[0.02]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,video/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <UploadCloud className="w-8 h-8 text-[#3ED6B5] mx-auto mb-2 opacity-80" />
              <div className="font-['Space_Grotesk'] text-sm font-medium text-[#EDF2F5]">
                {selectedFile ? selectedFile.name : 'ကလစ်နှိပ်၍ အသံဖိုင် သို့မဟုတ် ဗီဒီယို ရွေးချယ်ပါ'}
              </div>
              <div className="font-['JetBrains_Mono'] text-xs text-[#5C6672] mt-1">
                {selectedFile
                  ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB · ${selectedFile.type || 'Media File'}`
                  : 'MP3, WAV, M4A, MP4, MOV, FLAC, AAC စသည်ဖြင့် ထောက်ပံ့ပါသည်'}
              </div>
            </div>

            {/* Waveform indicator */}
            <div className="flex items-center justify-center gap-1.5 h-10 my-3">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((i) => (
                <div
                  key={i}
                  className={`w-1 rounded-full transition-all duration-200 ${
                    transStatus === 'TRANSCRIBING' || transStatus === 'UPLOADING'
                      ? 'bg-[#3ED6B5] wave-bar-anim'
                      : selectedFile
                      ? 'bg-[#3ED6B5]/40 h-4'
                      : 'bg-[#2A323C] h-1.5'
                  }`}
                  style={{ animationDelay: `${i * 0.08}s` }}
                />
              ))}
            </div>

            {transProgress && (
              <div className="font-['JetBrains_Mono'] text-xs text-[#F2A93B] text-center mb-3">
                {transProgress}
              </div>
            )}

            {transErr && (
              <div className="bg-[#E8604C]/10 border border-[#E8604C] text-[#F5B8AD] px-3.5 py-2.5 rounded text-xs font-['JetBrains_Mono'] mb-3">
                {transErr}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleTranscribe}
                disabled={!selectedFile || transStatus === 'TRANSCRIBING' || transStatus === 'UPLOADING'}
                className="bg-[#3ED6B5] hover:bg-[#3ED6B5]/90 disabled:bg-[#1B222B] disabled:text-[#5C6672] text-[#08211B] font-['Space_Grotesk'] font-semibold text-xs px-5 py-2.5 rounded flex items-center gap-2 transition cursor-pointer disabled:cursor-not-allowed"
              >
                <Radio className="w-3.5 h-3.5" />
                Run Transcription (စာသားထုတ်မည်)
              </button>
            </div>
          </div>
        </section>

        {/* ===== CH.03 — PASTE TEXT (SKIP TRANSCRIPTION) ===== */}
        <section className="bg-[#141920] border border-[#2A323C] rounded-lg mb-5 overflow-hidden shadow-lg">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[#2A323C] bg-gradient-to-b from-white/[0.03] to-transparent">
            <span className="font-['JetBrains_Mono'] text-[11px] font-bold px-2 py-0.5 rounded bg-[#3ED6B5] text-[#0B0E11]">
              CH.03
            </span>
            <div className="flex items-center gap-2 font-['Space_Grotesk'] font-semibold text-[15px] flex-1">
              <FileText className="w-4 h-4 text-[#3ED6B5]" />
              Paste Text / SRT (စာသားတိုက်ရိုက်ကူးထည့်ရန်)
            </div>
            <span className="font-['JetBrains_Mono'] text-[10px] tracking-wider uppercase text-[#9AA7B2]">
              {pasteStatus}
            </span>
          </div>

          <div className="p-5">
            <label className="block font-['JetBrains_Mono'] text-[10px] text-[#9AA7B2] uppercase tracking-wider mb-2">
              Text or SRT Subtitles to Translate
            </label>
            <textarea
              rows={4}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="အသံဖိုင်မရှိပါက စာသား သို့မဟုတ် .srt စာတန်းထိုးများကို ဤနေရာတွင် တိုက်ရိုက်ကူးထည့်၍ ဘာသာပြန်ခြင်း/TTS ပြုလုပ်နိုင်ပါသည်…"
              className="w-full bg-[#0B0E11] border border-[#2A323C] text-[#EDF2F5] p-3 rounded text-xs focus:border-[#3ED6B5] outline-none resize-y leading-relaxed transition"
            />

            {pasteErr && (
              <div className="bg-[#E8604C]/10 border border-[#E8604C] text-[#F5B8AD] px-3.5 py-2.5 rounded text-xs font-['JetBrains_Mono'] mt-2">
                {pasteErr}
              </div>
            )}

            <div className="flex gap-2 mt-3">
              <button
                onClick={handleUsePastedText}
                className="bg-[#3ED6B5] hover:bg-[#3ED6B5]/90 text-[#08211B] font-['Space_Grotesk'] font-semibold text-xs px-4 py-2 rounded flex items-center gap-2 transition cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                Transcript (စာကြောင်းများ ခွဲထုတ်မည်)
              </button>
              <button
                onClick={handleClearPastedText}
                className="border border-[#2A323C] hover:border-[#3ED6B5] text-[#9AA7B2] hover:text-[#3ED6B5] font-['Space_Grotesk'] text-xs px-4 py-2 rounded flex items-center gap-2 transition cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </button>
            </div>
          </div>
        </section>

        {/* ===== CH.04 — TRANSCRIPT (TIMESTAMPED) ===== */}
        <section className="bg-[#141920] border border-[#2A323C] rounded-lg mb-5 overflow-hidden shadow-lg">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[#2A323C] bg-gradient-to-b from-white/[0.03] to-transparent">
            <span className="font-['JetBrains_Mono'] text-[11px] font-bold px-2 py-0.5 rounded bg-[#3ED6B5] text-[#0B0E11]">
              CH.04
            </span>
            <div className="flex items-center gap-2 font-['Space_Grotesk'] font-semibold text-[15px] flex-1">
              <Sliders className="w-4 h-4 text-[#3ED6B5]" />
              Transcript (Timestamped စာကြောင်းများ)
            </div>
            <span className="font-['JetBrains_Mono'] text-[10px] tracking-wider uppercase text-[#3ED6B5] font-bold">
              {segments.length} SEGMENTS
            </span>
          </div>

          <div className="p-5">
            {segments.length === 0 ? (
              <div className="text-center py-8 text-[#5C6672] text-xs font-['Inter'] italic">
                အသံဖိုင်ကို transcribe လုပ်ပြီးမှ သို့မဟုတ် CH.03 တွင် စာသားထည့်ပြီးမှ စာကြောင်းများ timestamp
                နှင့်တကွ ဤနေရာတွင် ပေါ်လာပါမည်။
              </div>
            ) : (
              <div className="max-h-[380px] overflow-y-auto pr-2 divide-y divide-[#2A323C]/60">
                {segments.map((seg, idx) => (
                  <div key={seg.id} className="py-3 flex items-start gap-3 group">
                    <span className="font-['JetBrains_Mono'] text-[11px] text-[#F2A93B] bg-[#0B0E11] border border-[#F2A93B]/30 px-2 py-0.5 rounded whitespace-nowrap mt-0.5">
                      {seg.hasTimestamp ? fmtTime(seg.start) : `#${idx + 1}`}
                    </span>
                    <div className="flex-1">
                      <div className="text-xs text-[#EDF2F5] leading-relaxed select-text">{seg.text}</div>
                      {seg.translated && (
                        <div className="text-xs text-[#3ED6B5] leading-relaxed font-['Noto_Sans_Myanmar'] mt-1.5 bg-[#3ED6B5]/5 p-2 rounded border border-[#3ED6B5]/20 select-text">
                          {seg.translated}
                        </div>
                      )}
                    </div>
                    {/* Instant TTS per segment */}
                    <button
                      onClick={() => handleSpeakSegment(seg)}
                      disabled={activeSegmentTtsId === seg.id}
                      title="ဒီစာကြောင်းကို Edge TTS ဖြင့် ချက်ချင်း အသံနားထောင်မည်"
                      className="opacity-70 group-hover:opacity-100 p-1.5 rounded hover:bg-[#3ED6B5]/10 text-[#9AA7B2] hover:text-[#3ED6B5] transition cursor-pointer"
                    >
                      {activeSegmentTtsId === seg.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#3ED6B5]" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ===== CH.05 — TRANSLATE ===== */}
        <section className="bg-[#141920] border border-[#2A323C] rounded-lg mb-5 overflow-hidden shadow-lg">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[#2A323C] bg-gradient-to-b from-white/[0.03] to-transparent">
            <span className="font-['JetBrains_Mono'] text-[11px] font-bold px-2 py-0.5 rounded bg-[#3ED6B5] text-[#0B0E11]">
              CH.05
            </span>
            <div className="flex items-center gap-2 font-['Space_Grotesk'] font-semibold text-[15px] flex-1">
              <Languages className="w-4 h-4 text-[#3ED6B5]" />
              Translate (ဘာသာပြန်ဆိုခြင်း)
            </div>
            <span className="font-['JetBrains_Mono'] text-[10px] tracking-wider uppercase text-[#9AA7B2]">
              {translateStatus}
            </span>
          </div>

          <div className="p-5">
            <div className="flex flex-wrap gap-4 items-center mb-4">
              <div className="min-w-[220px]">
                <label className="block font-['JetBrains_Mono'] text-[10px] text-[#9AA7B2] uppercase tracking-wider mb-1">
                  Target Language (ပြောင်းလဲလိုသော ဘာသာစကား)
                </label>
                <select
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value)}
                  className="w-full bg-[#0B0E11] border border-[#2A323C] text-[#EDF2F5] px-3 py-2 rounded font-['JetBrains_Mono'] text-xs focus:border-[#3ED6B5] outline-none cursor-pointer"
                >
                  <option value="Burmese (Myanmar)">မြန်မာ (Burmese)</option>
                  <option value="English">English</option>
                  <option value="Thai">ไทย (Thai)</option>
                  <option value="Chinese (Simplified)">中文 (Chinese)</option>
                  <option value="Japanese">日本語 (Japanese)</option>
                  <option value="Korean">한국어 (Korean)</option>
                  <option value="French">Français</option>
                  <option value="Spanish">Español</option>
                  <option value="__custom__">Custom Language…</option>
                </select>
              </div>

              {targetLang === '__custom__' && (
                <div className="flex-1 min-w-[180px]">
                  <label className="block font-['JetBrains_Mono'] text-[10px] text-[#9AA7B2] uppercase tracking-wider mb-1">
                    Custom Language Name
                  </label>
                  <input
                    type="text"
                    value={customLang}
                    onChange={(e) => setCustomLang(e.target.value)}
                    placeholder="e.g. Vietnamese"
                    className="w-full bg-[#0B0E11] border border-[#2A323C] text-[#EDF2F5] px-3 py-2 rounded font-['JetBrains_Mono'] text-xs focus:border-[#3ED6B5] outline-none"
                  />
                </div>
              )}
            </div>

            {translateProgress && (
              <div className="font-['JetBrains_Mono'] text-xs text-[#F2A93B] mb-3">{translateProgress}</div>
            )}

            {translateErr && (
              <div className="bg-[#E8604C]/10 border border-[#E8604C] text-[#F5B8AD] px-3.5 py-2.5 rounded text-xs font-['JetBrains_Mono'] mb-3">
                {translateErr}
              </div>
            )}

            <div className="flex flex-wrap gap-2.5 items-center">
              <button
                onClick={handleTranslate}
                disabled={segments.length === 0 || translateStatus === 'TRANSLATING'}
                className="bg-[#F2A93B] hover:bg-[#F2A93B]/90 disabled:bg-[#1B222B] disabled:text-[#5C6672] text-[#2E1D06] font-['Space_Grotesk'] font-semibold text-xs px-4 py-2.5 rounded flex items-center gap-2 transition cursor-pointer disabled:cursor-not-allowed"
              >
                {translateStatus === 'TRANSLATING' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Translating…
                  </>
                ) : (
                  <>
                    <Languages className="w-3.5 h-3.5" />
                    Translate Transcript (ဘာသာပြန်မည်)
                  </>
                )}
              </button>

              <button
                onClick={handleExportSrt}
                disabled={segments.length === 0}
                className="border border-[#2A323C] hover:border-[#3ED6B5] disabled:border-[#2A323C]/40 text-[#9AA7B2] hover:text-[#3ED6B5] disabled:text-[#5C6672] font-['Space_Grotesk'] text-xs px-3.5 py-2.5 rounded flex items-center gap-1.5 transition cursor-pointer disabled:cursor-not-allowed"
              >
                <Download className="w-3.5 h-3.5" />
                Download .srt
              </button>

              <button
                onClick={handleExportTxt}
                disabled={segments.length === 0}
                className="border border-[#2A323C] hover:border-[#3ED6B5] disabled:border-[#2A323C]/40 text-[#9AA7B2] hover:text-[#3ED6B5] disabled:text-[#5C6672] font-['Space_Grotesk'] text-xs px-3.5 py-2.5 rounded flex items-center gap-1.5 transition cursor-pointer disabled:cursor-not-allowed"
              >
                <Download className="w-3.5 h-3.5" />
                Download .txt
              </button>

              <button
                onClick={handleCopyTranslation}
                disabled={segments.length === 0}
                className="border border-[#2A323C] hover:border-[#3ED6B5] disabled:border-[#2A323C]/40 text-[#9AA7B2] hover:text-[#3ED6B5] disabled:text-[#5C6672] font-['Space_Grotesk'] text-xs px-3.5 py-2.5 rounded flex items-center gap-1.5 transition cursor-pointer disabled:cursor-not-allowed"
              >
                {copiedStatus ? <Check className="w-3.5 h-3.5 text-[#3ED6B5]" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedStatus ? 'Copied ✓' : 'Copy Translation'}
              </button>
            </div>
          </div>
        </section>

        {/* ===== CH.06 — TEXT TO TTS (EDGE TTS) သီဟ၊ နီလာ ===== */}
        <section className="bg-[#141920] border-2 border-[#3ED6B5]/60 rounded-lg mb-6 overflow-hidden shadow-2xl relative">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-[#2A323C] bg-gradient-to-r from-[#3ED6B5]/10 via-transparent to-transparent">
            <span className="font-['JetBrains_Mono'] text-[12px] font-bold px-2.5 py-0.5 rounded bg-[#3ED6B5] text-[#0B0E11] shadow">
              CH.06
            </span>
            <div className="flex items-center gap-2 font-['Space_Grotesk'] font-bold text-base text-[#EDF2F5] flex-1">
              <Volume2 className="w-5 h-5 text-[#3ED6B5]" />
              Text to TTS (Edge TTS) — သီဟ၊ နီလာ အသံဖိုင် စာသားကနေ ထုတ်ယူခြင်း
            </div>
            <span className="font-['JetBrains_Mono'] text-[10px] tracking-wider uppercase text-[#3ED6B5] bg-[#3ED6B5]/10 px-2 py-0.5 rounded border border-[#3ED6B5]/20 font-semibold">
              EDGE NEURAL TTS
            </span>
          </div>

          <div className="p-5 sm:p-6 space-y-6">
            {/* Voice Cards: Thiha & Nilar */}
            <div>
              <label className="block font-['JetBrains_Mono'] text-[11px] text-[#3ED6B5] uppercase tracking-wider mb-2.5 font-semibold">
                ၁။ အသံရွေးချယ်ပါ (Select Neural Voice)
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {BURMESE_VOICES.map((v) => {
                  const isSelected = ttsVoice === v.id;
                  return (
                    <div
                      key={v.id}
                      onClick={() => setTtsVoice(v.id)}
                      className={`p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 flex items-start gap-3.5 ${
                        isSelected
                          ? 'border-[#3ED6B5] bg-[#3ED6B5]/10 shadow-[0_0_15px_rgba(62,214,181,0.15)]'
                          : 'border-[#2A323C] bg-[#0B0E11] hover:border-[#3ED6B5]/50'
                      }`}
                    >
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                          isSelected ? 'bg-[#3ED6B5] text-[#0B0E11]' : 'bg-[#1B222B] text-[#9AA7B2]'
                        }`}
                      >
                        {v.name.includes('နီလာ') ? '👩' : '👨'}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-['Space_Grotesk'] font-bold text-sm text-[#EDF2F5]">
                            {v.name}
                          </span>
                          <span
                            className={`text-[10px] font-['JetBrains_Mono'] px-2 py-0.5 rounded uppercase font-semibold ${
                              isSelected
                                ? 'bg-[#3ED6B5] text-[#0B0E11]'
                                : 'bg-[#1B222B] text-[#9AA7B2]'
                            }`}
                          >
                            {v.badge}
                          </span>
                        </div>
                        <p className="text-xs text-[#9AA7B2] font-['Noto_Sans_Myanmar'] mt-1 leading-relaxed">
                          {v.desc}
                        </p>
                        <div className="font-['JetBrains_Mono'] text-[10px] text-[#5C6672] mt-1.5">
                          ID: {v.id}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Extra voices dropdown (if translated to other languages) */}
              <div className="mt-3 flex items-center gap-3">
                <span className="text-xs font-['JetBrains_Mono'] text-[#5C6672]">
                  အခြားဘာသာစကားအသံများ လိုအပ်ပါက:
                </span>
                <select
                  value={ttsVoice}
                  onChange={(e) => setTtsVoice(e.target.value)}
                  className="bg-[#0B0E11] border border-[#2A323C] text-[#9AA7B2] text-xs px-2.5 py-1 rounded font-['JetBrains_Mono'] outline-none focus:border-[#3ED6B5] cursor-pointer"
                >
                  <optgroup label="🇲🇲 မြန်မာ အသံများ (Burmese Neural Voices)">
                    <option value="my-MM-NilarNeural">နီလာ (Nilar - Female)</option>
                    <option value="my-MM-ThihaNeural">သီဟ (Thiha - Male)</option>
                  </optgroup>
                  <optgroup label="🌐 အခြားနိုင်ငံတကာ အသံများ">
                    {OTHER_VOICES.map((ov) => (
                      <option key={ov.id} value={ov.id}>
                        {ov.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
            </div>

            {/* Source Text Selection */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="font-['JetBrains_Mono'] text-[11px] text-[#3ED6B5] uppercase tracking-wider font-semibold">
                  ၂။ အသံထုတ်ယူမည့် စာသား ရွေးချယ်ပါ (Text Source)
                </label>
                <div className="flex rounded bg-[#0B0E11] p-0.5 border border-[#2A323C]">
                  <button
                    onClick={() => setTtsSourceMode('transcript')}
                    className={`px-3 py-1 text-xs font-['Space_Grotesk'] rounded transition cursor-pointer ${
                      ttsSourceMode === 'transcript'
                        ? 'bg-[#3ED6B5] text-[#0B0E11] font-semibold'
                        : 'text-[#9AA7B2] hover:text-[#EDF2F5]'
                    }`}
                  >
                    ဘာသာပြန်ထားသော စာသား ({segments.length} Segments)
                  </button>
                  <button
                    onClick={() => setTtsSourceMode('custom')}
                    className={`px-3 py-1 text-xs font-['Space_Grotesk'] rounded transition cursor-pointer ${
                      ttsSourceMode === 'custom'
                        ? 'bg-[#3ED6B5] text-[#0B0E11] font-semibold'
                        : 'text-[#9AA7B2] hover:text-[#EDF2F5]'
                    }`}
                  >
                    စာသားတိုက်ရိုက်ရိုက်ထည့်ရန် (Custom Text)
                  </button>
                </div>
              </div>

              {ttsSourceMode === 'transcript' ? (
                <div className="bg-[#0B0E11] border border-[#2A323C] rounded-lg p-3.5 max-h-36 overflow-y-auto">
                  {segments.length > 0 ? (
                    <div className="text-xs text-[#EDF2F5] leading-relaxed font-['Noto_Sans_Myanmar']">
                      {segments.map((s) => s.translated || s.text).join(' ။ ')}
                    </div>
                  ) : (
                    <div className="text-xs text-[#5C6672] italic">
                      အထက်တွင် ဘာသာပြန်ထားသော စာသားမရှိသေးပါ။ အသံစမ်းသပ်ရန် "စာသားတိုက်ရိုက်ရိုက်ထည့်ရန်"
                      ခလုတ်ကို ရွေးချယ်နိုင်ပါသည်။
                    </div>
                  )}
                </div>
              ) : (
                <textarea
                  rows={3}
                  value={customTtsText}
                  onChange={(e) => setCustomTtsText(e.target.value)}
                  placeholder="အသံထုတ်လိုသော မြန်မာစာသား သို့မဟုတ် အင်္ဂလိပ်စာသားကို ဤနေရာတွင် ရိုက်ထည့်ပါ…"
                  className="w-full bg-[#0B0E11] border border-[#2A323C] text-[#EDF2F5] p-3 rounded text-xs focus:border-[#3ED6B5] outline-none resize-y leading-relaxed font-['Noto_Sans_Myanmar'] transition"
                />
              )}
            </div>

            {/* Voice Adjustments: Speed, Pitch, Volume */}
            <div className="bg-[#0B0E11]/70 border border-[#2A323C] rounded-lg p-4">
              <div className="font-['JetBrains_Mono'] text-[10px] text-[#9AA7B2] uppercase tracking-wider mb-3 font-semibold flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-[#3ED6B5]" />
                အသံ ထိန်းညှိမှုများ (Speech Parameters)
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Rate */}
                <div>
                  <div className="flex justify-between text-xs font-['JetBrains_Mono'] mb-1">
                    <span className="text-[#9AA7B2]">Speed (အမြန်နှုန်း)</span>
                    <span className="text-[#3ED6B5] font-bold">{ttsRate >= 0 ? `+${ttsRate}%` : `${ttsRate}%`}</span>
                  </div>
                  <input
                    type="range"
                    min={-50}
                    max={50}
                    step={5}
                    value={ttsRate}
                    onChange={(e) => setTtsRate(Number(e.target.value))}
                    className="w-full accent-[#3ED6B5] cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-[#5C6672] mt-0.5 font-['JetBrains_Mono']">
                    <span>0.5x</span>
                    <span
                      onClick={() => setTtsRate(0)}
                      className="cursor-pointer hover:text-[#3ED6B5]"
                      title="Reset to 1.0x Normal"
                    >
                      1.0x (Normal)
                    </span>
                    <span>1.5x</span>
                  </div>
                </div>

                {/* Pitch */}
                <div>
                  <div className="flex justify-between text-xs font-['JetBrains_Mono'] mb-1">
                    <span className="text-[#9AA7B2]">Pitch (အသံ အနိမ့်အမြင့်)</span>
                    <span className="text-[#3ED6B5] font-bold">{ttsPitch >= 0 ? `+${ttsPitch}Hz` : `${ttsPitch}Hz`}</span>
                  </div>
                  <input
                    type="range"
                    min={-50}
                    max={50}
                    step={5}
                    value={ttsPitch}
                    onChange={(e) => setTtsPitch(Number(e.target.value))}
                    className="w-full accent-[#3ED6B5] cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-[#5C6672] mt-0.5 font-['JetBrains_Mono']">
                    <span>Deep</span>
                    <span
                      onClick={() => setTtsPitch(0)}
                      className="cursor-pointer hover:text-[#3ED6B5]"
                      title="Reset to Default"
                    >
                      Default
                    </span>
                    <span>High</span>
                  </div>
                </div>

                {/* Volume */}
                <div>
                  <div className="flex justify-between text-xs font-['JetBrains_Mono'] mb-1">
                    <span className="text-[#9AA7B2]">Volume (အသံ အကျယ်)</span>
                    <span className="text-[#3ED6B5] font-bold">{ttsVolume >= 0 ? `+${ttsVolume}%` : `${ttsVolume}%`}</span>
                  </div>
                  <input
                    type="range"
                    min={-50}
                    max={50}
                    step={5}
                    value={ttsVolume}
                    onChange={(e) => setTtsVolume(Number(e.target.value))}
                    className="w-full accent-[#3ED6B5] cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-[#5C6672] mt-0.5 font-['JetBrains_Mono']">
                    <span>50%</span>
                    <span
                      onClick={() => setTtsVolume(0)}
                      className="cursor-pointer hover:text-[#3ED6B5]"
                      title="Reset to 100%"
                    >
                      100%
                    </span>
                    <span>150%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Error Message */}
            {ttsErr && (
              <div className="bg-[#E8604C]/10 border border-[#E8604C] text-[#F5B8AD] px-3.5 py-2.5 rounded text-xs font-['JetBrains_Mono'] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-[#E8604C]" />
                <span>{ttsErr}</span>
              </div>
            )}

            {/* Action Button: Generate Audio */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleGenerateTTS}
                disabled={ttsLoading}
                className="bg-[#3ED6B5] hover:bg-[#3ED6B5]/90 disabled:bg-[#1B222B] disabled:text-[#5C6672] text-[#08211B] font-['Space_Grotesk'] font-bold text-sm px-6 py-3 rounded-lg flex items-center gap-2.5 shadow-lg shadow-[#3ED6B5]/15 transition cursor-pointer disabled:cursor-not-allowed"
              >
                {ttsLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    အသံဖိုင် ဖန်တီးနေပါသည် (Generating Audio)…
                  </>
                ) : (
                  <>
                    <Volume2 className="w-4 h-4" />
                    စာသားကနေ အသံဖိုင် ထုတ်ယူမည် (Generate Audio)
                  </>
                )}
              </button>

              {/* Sample phrases */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[#5C6672] font-['JetBrains_Mono'] text-[11px]">စမ်းသပ်ရန် စာသား:</span>
                <button
                  type="button"
                  onClick={() => {
                    setTtsSourceMode('custom');
                    setCustomTtsText('မင်္ဂလာပါရှင်။ အသံဖိုင် စာသားကနေ ထုတ်ယူခြင်း စနစ်မှ ကြိုဆိုပါတယ်။');
                  }}
                  className="px-2 py-1 rounded bg-[#1B222B] text-[#9AA7B2] hover:text-[#3ED6B5] text-[11px] font-['Noto_Sans_Myanmar'] cursor-pointer border border-[#2A323C]"
                >
                  "မင်္ဂလာပါရှင်…"
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTtsSourceMode('custom');
                    setCustomTtsText('သီဟနှင့် နီလာ အသံဖိုင်ကို စမ်းသပ်နားထောင်ခြင်း ဖြစ်ပါသည်။ ကျေးဇူးတင်ပါသည်။');
                  }}
                  className="px-2 py-1 rounded bg-[#1B222B] text-[#9AA7B2] hover:text-[#3ED6B5] text-[11px] font-['Noto_Sans_Myanmar'] cursor-pointer border border-[#2A323C]"
                >
                  "သီဟနှင့် နီလာ…"
                </button>
              </div>
            </div>

            {/* ===== AUDIO PLAYER PANEL ===== */}
            {ttsAudioUrl && (
              <div className="mt-4 bg-[#0B0E11] border border-[#3ED6B5]/40 rounded-xl p-4.5 shadow-inner">
                <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-[#2A323C]">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#3ED6B5] animate-ping" />
                    <span className="font-['Space_Grotesk'] text-sm font-semibold text-[#EDF2F5]">
                      {ttsVoice === 'my-MM-NilarNeural' ? 'နီလာ (Nilar)' : ttsVoice === 'my-MM-ThihaNeural' ? 'သီဟ (Thiha)' : ttsVoice} — Edge TTS အသံဖိုင် အဆင်သင့်ဖြစ်ပါပြီ
                    </span>
                  </div>
                  <span className="font-['JetBrains_Mono'] text-[11px] text-[#3ED6B5] bg-[#3ED6B5]/10 px-2 py-0.5 rounded">
                    MP3 Audio
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-4">
                  {/* Play / Pause button */}
                  <button
                    onClick={togglePlayPause}
                    className="w-12 h-12 rounded-full bg-[#3ED6B5] text-[#08211B] flex items-center justify-center hover:scale-105 transition cursor-pointer shadow-md shrink-0"
                  >
                    {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-0.5" />}
                  </button>

                  {/* Scrubber and Time */}
                  <div className="flex-1 w-full">
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={audioDuration || 100}
                        step={0.1}
                        value={audioCurrentTime}
                        onChange={handleSeek}
                        className="w-full accent-[#3ED6B5] cursor-pointer"
                      />
                    </div>
                    <div className="flex justify-between font-['JetBrains_Mono'] text-[11px] text-[#9AA7B2] mt-1">
                      <span>{fmtTime(audioCurrentTime * 1000)}</span>
                      <span>{fmtTime((audioDuration || 0) * 1000)}</span>
                    </div>
                  </div>

                  {/* Download MP3 Button */}
                  <button
                    onClick={handleDownloadTTS}
                    className="w-full sm:w-auto bg-[#1B222B] hover:bg-[#3ED6B5] text-[#3ED6B5] hover:text-[#08211B] border border-[#3ED6B5]/50 font-['Space_Grotesk'] font-semibold text-xs px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition cursor-pointer shrink-0"
                  >
                    <Download className="w-4 h-4" />
                    Download MP3 (ဒေါင်းလုဒ်)
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ===== TELEGRAM LINKS ===== */}
        <section className="bg-[#141920] border border-[#2A323C] rounded-lg p-5">
          <div className="font-['Space_Grotesk'] font-semibold text-[15px] mb-3 text-[#EDF2F5]">
            Telegram Community
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <a
              href="https://t.me/linlinzawofficial"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 min-h-[44px] px-3.5 py-2.5 rounded bg-[#229ED9] hover:bg-[#229ED9]/90 text-white font-['Space_Grotesk'] font-semibold text-xs transition cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>Telegram Channel Join</span>
            </a>
            <a
              href="https://t.me/buemeserecapview"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 min-h-[44px] px-3.5 py-2.5 rounded bg-[#229ED9] hover:bg-[#229ED9]/90 text-white font-['Space_Grotesk'] font-semibold text-xs transition cursor-pointer"
            >
              <MessageCircle className="w-4 h-4" />
              <span>စကားပြော Group Chat</span>
            </a>
            <a
              href="https://t.me/Smile_p2"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 min-h-[44px] px-3.5 py-2.5 rounded bg-[#1B222B] hover:border-[#3ED6B5] border border-[#2A323C] text-[#3ED6B5] font-['Space_Grotesk'] font-semibold text-xs transition cursor-pointer"
            >
              <User className="w-4 h-4" />
              <span>Admin ဆက်သွယ်ရန်</span>
            </a>
          </div>
        </section>

        <footer className="text-center mt-9 font-['JetBrains_Mono'] text-[11px] text-[#5C6672]">
          SIGNAL PATH · TRANSLATE TOOL &amp; EDGE TTS CONSOLE
        </footer>
      </div>
    </div>
  );
}
