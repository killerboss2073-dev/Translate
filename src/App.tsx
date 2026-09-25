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
  AlertCircle,
  History,
  RotateCcw,
  Search,
  Clock,
  ArrowUpRight,
  Hash,
  Subtitles
} from 'lucide-react';
import { convertNumbersInTextToBurmese, safeParseTranslations } from './utils/burmeseNumbers';
import { splitIntoBurmeseCues, formatBurmeseTwoLines, fmtSrtTime } from './utils/burmeseSubtitles';

interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
  translated: string | null;
  hasTimestamp: boolean;
}

interface HistoryItem {
  id: string;
  timestamp: number;
  formattedTime: string;
  sourceText?: string;
  translatedText: string;
  targetLang: string;
  geminiModel: string;
  voiceId: string;
  voiceName: string;
  speed: number;
  pitch: number;
  volume: number;
  audioBase64?: string;
  hasAudio: boolean;
  segmentCount?: number;
  srtContent?: string;
}

const STORAGE_KEY = 'signalpath_settings_v3';
const HISTORY_STORAGE_KEY = 'signalpath_history_v3';

const PRIMARY_VOICES = [
  {
    id: 'my-MM-NilarNeural',
    name: 'နီလာ (Nilar)',
    gender: 'Female (အမျိုးသမီး)',
    desc: 'ကြည်လင်ပျော့ပျောင်းသော သဘာဝအမျိုးသမီးအသံ',
    badge: 'Female • မြန်မာ',
    icon: '👩',
    speedPreset: 0,
  },
  {
    id: 'my-MM-ThihaNeural',
    name: 'သီဟ (Thiha)',
    gender: 'Male (အမျိုးသား)',
    desc: 'တည်ကြည်ပြတ်သားသော သဘာဝအမျိုးသားအသံ',
    badge: 'Male • မြန်မာ',
    icon: '👨',
    speedPreset: 0,
  },
  {
    id: 'it-IT-GiuseppeMultilingualNeural',
    name: 'မောင်ကျော်သူ (Giuseppe Fast Vibe ⚡ - Speed 1.3)',
    gender: 'it-IT (Multilingual)',
    desc: 'ရယ်မောပျော်ရွှင်ဖွယ် သွက်လက်သောအသံ',
    badge: '⚡ Speed 1.3x • Multilingual',
    icon: '⚡',
    speedPreset: 30, // +30% is 1.3x speed
  },
];

const OTHER_VOICES = [
  { id: 'it-IT-GiuseppeMultilingualNeural', name: 'Italian/Multilingual - Giuseppe (မောင်ကျော်သူ ⚡ Fast Vibe)', lang: 'Multilingual' },
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

  const initialLines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rawPieces: string[] = [];

  for (const line of initialLines) {
    const splitByPunct = line
      .split(/(?<=[။!?])|(?<=[.])\s+|(?<=(?:တယ်|ပါ|တာ|လဲ|နော်|ပဲ|လို့|မို့|ပြီး|ဟုတ်|ရယ်|စမ်း|ပါဘူး))\s+/)
      .map(s => s.trim())
      .filter(Boolean);
    rawPieces.push(...splitByPunct);
  }

  // Chunk long segments (>140 chars) by commas, clauses, or words so Gemini never skips translation
  const pieces: string[] = [];
  const MAX_CHUNK_LEN = 140;

  for (const part of rawPieces) {
    if (part.length <= MAX_CHUNK_LEN) {
      pieces.push(part);
    } else {
      const subParts = part.split(/(?<=[,၊;:])\s+/).map(s => s.trim()).filter(Boolean);
      let current = '';
      for (const sub of subParts) {
        if ((current + ' ' + sub).trim().length <= MAX_CHUNK_LEN) {
          current = (current + ' ' + sub).trim();
        } else {
          if (current) pieces.push(current);
          if (sub.length <= MAX_CHUNK_LEN) {
            current = sub;
          } else {
            const words = sub.split(/\s+/);
            let wCurrent = '';
            for (const w of words) {
              if ((wCurrent + ' ' + w).trim().length <= MAX_CHUNK_LEN) {
                wCurrent = (wCurrent + ' ' + w).trim();
              } else {
                if (wCurrent) pieces.push(wCurrent);
                wCurrent = w;
              }
            }
            current = wCurrent;
          }
        }
      }
      if (current) pieces.push(current);
    }
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

function safeBase64ToBlob(base64: string, mimeType = 'audio/mpeg'): Blob {
  if (!base64) return new Blob([], { type: mimeType });
  try {
    const clean = base64.replace(/[\s\r\n]/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = clean.padEnd(clean.length + ((4 - (clean.length % 4)) % 4), '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes.buffer], { type: mimeType });
  } catch {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
    const len = clean.length;
    const bytes: number[] = [];
    for (let i = 0; i < len; i += 4) {
      const b1 = chars.indexOf(clean[i]);
      const b2 = chars.indexOf(clean[i + 1] || 'A');
      const b3 = chars.indexOf(clean[i + 2] || 'A');
      const b4 = chars.indexOf(clean[i + 3] || 'A');
      bytes.push((b1 << 2) | (b2 >> 4));
      if (clean[i + 2] && clean[i + 2] !== '=') bytes.push(((b2 & 15) << 4) | (b3 >> 2));
      if (clean[i + 3] && clean[i + 3] !== '=') bytes.push(((b3 & 3) << 6) | b4);
    }
    return new Blob([new Uint8Array(bytes)], { type: mimeType });
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => {
      resolve('');
    };
    reader.readAsDataURL(blob);
  });
}

export default function App() {
  // CH.01 Keys & Models
  const [assemblyKey, setAssemblyKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-3.6-flash');
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
  const [ttsVoice, setTtsVoice] = useState<string>('my-MM-NilarNeural');
  const [ttsSourceMode, setTtsSourceMode] = useState<'transcript' | 'custom'>('transcript');
  const [customTtsText, setCustomTtsText] = useState('မင်္ဂလာပါရှင်။ Translate Tool မှ ကြိုဆိုပါတယ်။');
  const [ttsRate, setTtsRate] = useState(0); // -50 to +50 percent
  const [ttsPitch, setTtsPitch] = useState(0); // -50 to +50 Hz
  const [ttsVolume, setTtsVolume] = useState(0); // -50 to +50 percent
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsErr, setTtsErr] = useState('');
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const [ttsAudioBlob, setTtsAudioBlob] = useState<Blob | null>(null);
  const [currentTtsSrt, setCurrentTtsSrt] = useState<string>('');
  const [activeSegmentTtsId, setActiveSegmentTtsId] = useState<string | null>(null);

  // Audio player state for main player
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);

  // CH.07 History State
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [copiedHistId, setCopiedHistId] = useState<string | null>(null);
  const [activeHistoryAudioId, setActiveHistoryAudioId] = useState<string | null>(null);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const historyAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isHistPlaying, setIsHistPlaying] = useState(false);
  const [histAudioProgress, setHistAudioProgress] = useState(0);
  const [histAudioDuration, setHistAudioDuration] = useState(0);

  // Load saved settings & history
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
        if (typeof data.ttsRate === 'number') setTtsRate(data.ttsRate);
      }
    } catch {
      // ignore
    }

    try {
      const histSaved = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (histSaved) {
        const parsed = JSON.parse(histSaved);
        if (Array.isArray(parsed)) {
          setHistory(parsed);
        }
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
        ttsRate,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // ignore
    }
  }, [assemblyKey, geminiKey, geminiModel, customModel, targetLang, customLang, ttsVoice, ttsRate]);

  // Main Audio player event listeners
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

  // History Audio player event listeners
  useEffect(() => {
    const histAudio = historyAudioRef.current;
    if (!histAudio) return;

    const onPlay = () => setIsHistPlaying(true);
    const onPause = () => setIsHistPlaying(false);
    const onEnded = () => {
      setIsHistPlaying(false);
      setHistAudioProgress(0);
      setActiveHistoryAudioId(null);
    };
    const onTimeUpdate = () => setHistAudioProgress(histAudio.currentTime);
    const onLoadedMetadata = () => setHistAudioDuration(histAudio.duration || 0);

    histAudio.addEventListener('play', onPlay);
    histAudio.addEventListener('pause', onPause);
    histAudio.addEventListener('ended', onEnded);
    histAudio.addEventListener('timeupdate', onTimeUpdate);
    histAudio.addEventListener('loadedmetadata', onLoadedMetadata);

    return () => {
      histAudio.removeEventListener('play', onPlay);
      histAudio.removeEventListener('pause', onPause);
      histAudio.removeEventListener('ended', onEnded);
      histAudio.removeEventListener('timeupdate', onTimeUpdate);
      histAudio.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, []);

  // Helper to add item to History
  const saveToHistory = (item: Omit<HistoryItem, 'id' | 'timestamp' | 'formattedTime'>) => {
    const now = new Date();
    const formattedTime = now.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const newItem: HistoryItem = {
      ...item,
      id: 'hist-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      timestamp: Date.now(),
      formattedTime,
    };

    setHistory((prev) => {
      const updated = [newItem, ...prev.slice(0, 39)];
      try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // In case localStorage is full, remove heavy audioBase64 from items older than top 5
        const lean = updated.map((h, idx) => (idx < 5 ? h : { ...h, audioBase64: undefined }));
        try {
          localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(lean));
        } catch {}
      }
      return updated;
    });
  };

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

      if (sentences.length > 0) {
        const segs: Segment[] = sentences.map((s: any, idx: number) => ({
          id: 'seg-' + (idx + 1),
          start: s.start,
          end: s.end,
          text: s.text,
          translated: null,
          hasTimestamp: true,
        }));
        setSegments(segs);
      } else if (pollData.text) {
        const segs = splitTextToSegments(pollData.text);
        setSegments(segs);
      } else {
        throw new Error('စာသား မတွေ့ရှိပါ။');
      }

      setTransStatus('DONE');
      setTransProgress('စာသား အောင်မြင်စွာ ပြောင်းလဲပြီးပါပြီ ✓');
      setTranslateStatus('READY');
    } catch (err: any) {
      setTransStatus('ERROR');
      setTransErr(err.message || String(err));
    }
  };

  // CH.05 Gemini Translation
  const handleTranslate = async () => {
    setTranslateErr('');
    if (segments.length === 0) {
      setTranslateErr('ဘာသာပြန်ရန် Transcript စာကြောင်းများ မရှိသေးပါ။ CH.02 သို့မဟုတ် CH.03 တွင် စာသား အရင်ထည့်ပါ။');
      return;
    }

    const currentLangName = targetLang === '__custom__' ? customLang.trim() || 'Burmese' : targetLang;
    const modelToUse = geminiModel === '__custom__' ? customModel.trim() || 'gemini-3.6-flash' : geminiModel;
    const cleanKey = geminiKey.trim().replace(/[\r\n\t\s]/g, '');

    setTranslateStatus('TRANSLATING');
    setTranslateProgress(`Gemini (${modelToUse}) ဖြင့် ${currentLangName} ဘာသာသို့ ပြန်ဆိုနေပါသည်…`);

    try {
      const BATCH_SIZE = 15;
      const newSegments = [...segments];

      for (let i = 0; i < newSegments.length; i += BATCH_SIZE) {
        const batch = newSegments.slice(i, i + BATCH_SIZE);
        setTranslateProgress(`စာကြောင်း (${i + 1} မှ ${Math.min(i + BATCH_SIZE, newSegments.length)}) / ${newSegments.length} ဘာသာပြန်နေပါသည်…`);

        let translations: string[] = [];

        // Server-side route with multi-model fallback and smart retry
        const res = await fetch('/api/gemini/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batch,
            lang: currentLangName,
            model: modelToUse,
            clientKey: cleanKey || undefined,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `ဘာသာပြန်ဆိုခြင်း မအောင်မြင်ပါ (${res.status})`);
        }

        const data = await res.json();
        translations = data.translations || [];

        const isBurmese = currentLangName.toLowerCase().includes('burmese') || currentLangName.toLowerCase().includes('myanmar');

        for (let j = 0; j < batch.length; j++) {
          if (translations[j]) {
            const finalTranslated = isBurmese ? convertNumbersInTextToBurmese(translations[j]) : translations[j];
            newSegments[i + j].translated = finalTranslated;
          }
        }

        setSegments([...newSegments]);
      }

      setTranslateStatus('DONE');
      setTranslateProgress(`ဘာသာပြန်ခြင်း ပြီးစီးပါပြီ (${currentLangName}) ✓`);

      // Record translation history
      const originalJoined = newSegments.map((s) => s.text).filter(Boolean).join(' ');
      const translatedJoined = newSegments.map((s) => s.translated || s.text).filter(Boolean).join(' ');
      const voiceObj = PRIMARY_VOICES.find((v) => v.id === ttsVoice) || OTHER_VOICES.find((v) => v.id === ttsVoice);
      const srtBurmese2Lines = generateBurmeseTwoLineSrt(newSegments, translatedJoined);

      saveToHistory({
        sourceText: originalJoined,
        translatedText: translatedJoined,
        targetLang: currentLangName,
        geminiModel: modelToUse,
        voiceId: ttsVoice,
        voiceName: voiceObj ? voiceObj.name : ttsVoice,
        speed: ttsRate,
        pitch: ttsPitch,
        volume: ttsVolume,
        hasAudio: false,
        segmentCount: newSegments.length,
        srtContent: srtBurmese2Lines,
      });
    } catch (err: any) {
      setTranslateStatus('ERROR');
      setTranslateErr(err.message || String(err));
    }
  };

  // Extract exact audio duration in ms using Web Audio API
  const getExactAudioDurationMs = async (blob: Blob): Promise<number> => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const arrayBuffer = await blob.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
        ctx.close().catch(() => {});
        if (decoded && decoded.duration > 0) {
          return Math.round(decoded.duration * 1000);
        }
      }
    } catch (e) {
      console.warn('AudioContext decode fallback:', e);
    }
    return 0;
  };

  // Burmese 2-line SRT generator for transcript segments or fallback
  const generateBurmeseTwoLineSrt = (
    segs: Segment[],
    fallbackTranslated?: string,
    totalDurationMs?: number
  ): string => {
    // 1. If generated from custom text / text input or TTS audio with known duration
    const raw = convertNumbersInTextToBurmese((fallbackTranslated || '').trim());
    if (raw) {
      const pieces = splitIntoBurmeseCues(raw);
      const cueTwoLineTexts = pieces
        .map((p) => formatBurmeseTwoLines(p))
        .filter((t) => t.trim().length > 0);

      if (cueTwoLineTexts.length > 0) {
        let currentStart = 0;
        const dur = totalDurationMs && totalDurationMs > 500 ? totalDurationMs : cueTwoLineTexts.length * 3200;
        const totalChars = cueTwoLineTexts.reduce((acc, c) => acc + c.replace(/\s+/g, '').length, 0) || 1;

        return cueTwoLineTexts
          .map((twoLines, idx) => {
            const cueChars = twoLines.replace(/\s+/g, '').length || 1;
            const cueDuration = Math.round((cueChars / totalChars) * dur);
            const start = currentStart;
            const isLast = idx === cueTwoLineTexts.length - 1;
            const end = isLast ? Math.max(start + 400, Math.round(dur)) : start + Math.max(400, cueDuration);
            currentStart = end;
            return `${idx + 1}\n${fmtSrtTime(start)} --> ${fmtSrtTime(end)}\n${twoLines}\n`;
          })
          .join('\n');
      }
    }

    // 2. If we have original video transcription segments (CH.04 / CH.05)
    if (segs && segs.length > 0) {
      const cues: Array<{ start: number; end: number; text: string }> = [];

      segs.forEach((s) => {
        const rawText = (s.translated || s.text || '').trim();
        if (!rawText) return;
        const spokenText = convertNumbersInTextToBurmese(rawText);
        const shortPieces = splitIntoBurmeseCues(spokenText);

        if (shortPieces.length > 1) {
          const totalDur = Math.max(1000, s.end - s.start);
          const chunkDur = totalDur / shortPieces.length;
          shortPieces.forEach((piece, i) => {
            const subStart = Math.round(s.start + i * chunkDur);
            const subEnd = Math.round(s.start + (i + 1) * chunkDur);
            cues.push({
              start: subStart,
              end: Math.max(subStart + 400, subEnd),
              text: formatBurmeseTwoLines(piece),
            });
          });
        } else {
          cues.push({
            start: s.start,
            end: s.end,
            text: formatBurmeseTwoLines(shortPieces[0] || spokenText),
          });
        }
      });

      return cues
        .map((c, idx) => `${idx + 1}\n${fmtSrtTime(c.start)} --> ${fmtSrtTime(c.end)}\n${c.text}\n`)
        .join('\n');
    }

    return '';
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

  const handleDownloadSrt = (srtText?: string, filename = 'subtitles_burmese_2lines.srt') => {
    const content = srtText || generateBurmeseTwoLineSrt(segments);
    if (!content) return;
    downloadFile(filename, content, 'application/x-subrip');
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

  interface TTSResult {
    blob: Blob;
    durationMs: number;
    srt?: string;
  }

  // CH.06 Edge TTS Core Generator
  const generateSpeech = async (textToSpeak: string, customVoice?: string): Promise<TTSResult> => {
    const voiceToUse = customVoice || ttsVoice;
    const normalizedText = convertNumbersInTextToBurmese(textToSpeak);
    const rateStr = `${ttsRate >= 0 ? '+' : ''}${ttsRate}%`;
    const pitchStr = `${ttsPitch >= 0 ? '+' : ''}${ttsPitch}Hz`;
    const volumeStr = `${ttsVolume >= 0 ? '+' : ''}${ttsVolume}%`;

    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: normalizedText,
        voice: voiceToUse,
        rate: rateStr,
        pitch: pitchStr,
        volume: volumeStr,
        returnJson: true,
      }),
    });

    if (!res.ok) {
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

    const data = await res.json();
    const blob = safeBase64ToBlob(data.audioBase64 || '', 'audio/mpeg');

    let exactDurationMs = await getExactAudioDurationMs(blob);
    if (!exactDurationMs || exactDurationMs <= 0) {
      exactDurationMs = data.durationMs || 0;
    }

    return {
      blob,
      durationMs: exactDurationMs,
      srt: data.srt || '',
    };
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
      const { blob, durationMs, srt } = await generateSpeech(textToSpeak);
      const url = URL.createObjectURL(blob);

      if (ttsAudioUrl) {
        URL.revokeObjectURL(ttsAudioUrl);
      }

      setTtsAudioBlob(blob);
      setTtsAudioUrl(url);

      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play().catch(() => {});
      }

      // Convert audio blob to base64 for persistent history playback
      const base64Audio = await blobToBase64(blob);
      const voiceObj = PRIMARY_VOICES.find((v) => v.id === ttsVoice) || OTHER_VOICES.find((v) => v.id === ttsVoice);
      const currentLangName = targetLang === '__custom__' ? customLang.trim() || 'Burmese' : targetLang;
      const modelToUse = geminiModel === '__custom__' ? customModel.trim() || 'gemini-3.8-flash' : geminiModel;
      const originalJoined = ttsSourceMode === 'transcript' ? segments.map((s) => s.text).filter(Boolean).join(' ') : undefined;

      // Use the server-computed zero-drift SRT (or fallback)
      const srtBurmese2Lines = srt || generateBurmeseTwoLineSrt([], textToSpeak, durationMs);
      setCurrentTtsSrt(srtBurmese2Lines);

      saveToHistory({
        sourceText: originalJoined,
        translatedText: textToSpeak,
        targetLang: currentLangName,
        geminiModel: modelToUse,
        voiceId: ttsVoice,
        voiceName: voiceObj ? voiceObj.name : ttsVoice,
        speed: ttsRate,
        pitch: ttsPitch,
        volume: ttsVolume,
        audioBase64: base64Audio,
        hasAudio: true,
        segmentCount: ttsSourceMode === 'transcript' ? segments.length : undefined,
        srtContent: srtBurmese2Lines,
      });
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
      const { blob } = await generateSpeech(text);
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

  // Voice Selection with auto-preset speed and pitch
  const handleSelectPrimaryVoice = (v: typeof PRIMARY_VOICES[0]) => {
    setTtsVoice(v.id);
    if (v.id.includes('Giuseppe')) {
      setTtsRate(30);
      setTtsPitch(10);
    } else if (v.speedPreset !== undefined && v.speedPreset !== 0) {
      setTtsRate(v.speedPreset);
    } else if (v.id.includes('Nilar') || v.id.includes('Thiha')) {
      if (ttsRate === 30 && ttsPitch === 10) {
        setTtsRate(0);
        setTtsPitch(0);
      }
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
    const val = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
      setAudioCurrentTime(val);
    }
  };

  const handleDownloadTTS = () => {
    if (!ttsAudioBlob) return;
    const url = URL.createObjectURL(ttsAudioBlob);
    const a = document.createElement('a');
    a.href = url;
    const voicePrefix = ttsVoice.includes('Giuseppe') ? 'giuseppe_fast' : ttsVoice.includes('Thiha') ? 'thiha' : 'nilar';
    a.download = `voice_${voicePrefix}_${Date.now()}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // CH.07 History Actions
  const handlePlayHistoryAudio = (item: HistoryItem) => {
    if (!historyAudioRef.current) return;

    if (activeHistoryAudioId === item.id) {
      if (isHistPlaying) {
        historyAudioRef.current.pause();
      } else {
        historyAudioRef.current.play().catch(() => {});
      }
      return;
    }

    if (item.audioBase64) {
      historyAudioRef.current.src = item.audioBase64;
      historyAudioRef.current.play().catch(() => {});
      setActiveHistoryAudioId(item.id);
      setIsHistPlaying(true);
    } else {
      // If no stored audioBase64, synthesize directly
      setActiveHistoryAudioId(item.id);
      setIsHistPlaying(true);
      generateSpeech(item.translatedText, item.voiceId)
        .then(({ blob }) => {
          const url = URL.createObjectURL(blob);
          if (historyAudioRef.current) {
            historyAudioRef.current.src = url;
            historyAudioRef.current.play().catch(() => {});
          }
        })
        .catch((err) => {
          alert(`အသံဖိုင်ဖွင့်မရပါ: ${err.message || err}`);
          setIsHistPlaying(false);
          setActiveHistoryAudioId(null);
        });
    }
  };

  const handleDownloadHistoryAudio = (item: HistoryItem) => {
    if (item.audioBase64) {
      const a = document.createElement('a');
      a.href = item.audioBase64;
      a.download = `history_audio_${item.voiceId}_${item.id}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      generateSpeech(item.translatedText, item.voiceId)
        .then(({ blob }) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `history_audio_${item.voiceId}_${item.id}.mp3`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        })
        .catch((err) => {
          alert(`ဒေါင်းလုဒ် မအောင်မြင်ပါ: ${err.message || err}`);
        });
    }
  };

  const handleCopyHistoryText = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedHistId(id);
      setTimeout(() => setCopiedHistId(null), 2500);
    } catch {}
  };

  const handleLoadHistoryToEditor = (item: HistoryItem) => {
    setTtsSourceMode('custom');
    setCustomTtsText(item.translatedText);
    setTtsVoice(item.voiceId);
    setTtsRate(item.speed);
    setTtsPitch(item.pitch);
    setTtsVolume(item.volume);

    // Scroll to CH.06
    const ch6 = document.getElementById('ch-06-tts');
    if (ch6) {
      ch6.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleDeleteHistoryItem = (id: string) => {
    if (activeHistoryAudioId === id && historyAudioRef.current) {
      historyAudioRef.current.pause();
      setActiveHistoryAudioId(null);
      setIsHistPlaying(false);
    }
    const updated = history.filter((h) => h.id !== id);
    setHistory(updated);
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
    } catch {}
  };

  const handleClearAllHistory = () => {
    if (historyAudioRef.current) {
      historyAudioRef.current.pause();
    }
    setActiveHistoryAudioId(null);
    setIsHistPlaying(false);
    setHistory([]);
    setConfirmClearHistory(false);
    try {
      localStorage.removeItem(HISTORY_STORAGE_KEY);
    } catch {}
  };

  // Filtered history list
  const filteredHistory = history.filter((h) => {
    if (!historySearch.trim()) return true;
    const q = historySearch.toLowerCase();
    return (
      h.translatedText.toLowerCase().includes(q) ||
      (h.sourceText && h.sourceText.toLowerCase().includes(q)) ||
      h.voiceName.toLowerCase().includes(q) ||
      h.targetLang.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-[#0B0E11] text-[#EDF2F5] selection:bg-[#3ED6B5]/30 font-sans pb-16">
      {/* Hidden Audio Elements for Playback */}
      <audio ref={audioRef} className="hidden" />
      <audio ref={historyAudioRef} className="hidden" />

      {/* Top Banner Header */}
      <header className="border-b border-[#2A323C] bg-[#141920]/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-[#3ED6B5] to-[#229ED9] flex items-center justify-center text-[#0B0E11] font-bold shadow-md shadow-[#3ED6B5]/20">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-['Space_Grotesk'] font-bold text-base sm:text-lg tracking-tight flex items-center gap-2">
                <span>SIGNAL PATH</span>
                <span className="text-[10px] font-['JetBrains_Mono'] px-2 py-0.5 rounded bg-[#3ED6B5]/15 text-[#3ED6B5] border border-[#3ED6B5]/30 font-normal">
                  v3.0 PRO
                </span>
              </h1>
              <p className="text-[11px] text-[#9AA7B2] font-['JetBrains_Mono']">
                Universal AI Translate &amp; Edge Neural TTS Engine
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="#ch-07-history"
              className="text-xs font-['JetBrains_Mono'] text-[#9AA7B2] hover:text-[#3ED6B5] flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#1B222B] border border-[#2A323C] transition"
            >
              <History className="w-3.5 h-3.5 text-[#3ED6B5]" />
              <span>မှတ်တမ်း ({history.length})</span>
            </a>
            <a
              href="https://t.me/linlinzawofficial"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 text-xs font-['Space_Grotesk'] font-medium text-white bg-[#229ED9] hover:bg-[#229ED9]/90 px-3 py-1.5 rounded transition"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Telegram</span>
            </a>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6">
        {/* ===== CH.01 — API KEYS & MODEL CONFIGURATION ===== */}
        <section className="bg-[#141920] border border-[#2A323C] rounded-lg mb-5 overflow-hidden shadow-lg">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[#2A323C] bg-gradient-to-b from-white/[0.03] to-transparent">
            <span className="font-['JetBrains_Mono'] text-[11px] font-bold px-2 py-0.5 rounded bg-[#3ED6B5] text-[#0B0E11]">
              CH.01
            </span>
            <div className="flex items-center gap-2 font-['Space_Grotesk'] font-semibold text-[15px] flex-1">
              <Key className="w-4 h-4 text-[#3ED6B5]" />
              API Keys &amp; Model Configuration
            </div>
            <span className="font-['JetBrains_Mono'] text-[10px] tracking-wider uppercase text-[#9AA7B2]">
              SETTINGS
            </span>
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
              <div className="w-full sm:w-auto min-w-[260px]">
                <label className="block font-['JetBrains_Mono'] text-[10px] text-[#9AA7B2] uppercase tracking-wider mb-1">
                  Gemini Translation Model (ဘာသာပြန် Model)
                </label>
                <select
                  value={geminiModel}
                  onChange={(e) => setGeminiModel(e.target.value)}
                  className="w-full bg-[#0B0E11] border border-[#2A323C] text-[#EDF2F5] px-3 py-2 rounded font-['JetBrains_Mono'] text-xs focus:border-[#3ED6B5] outline-none cursor-pointer"
                >
                  <option value="gemini-3.8-flash">Gemini 3.8 Flash (အဆင့်မြင့်ဆုံး စာသား 🎯)</option>
                  <option value="gemini-3.7-flash">Gemini 3.7 Flash (နောက်ဆုံးပေါ် AI အမြန် 🚀)</option>
                  <option value="gemini-3.6-flash">Gemini 3.6 Flash (အကြံပြုချက် - အတည်ငြိမ်ဆုံး ⚡)</option>
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
                    placeholder="e.g. gemini-3.6-flash"
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
                {selectedFile ? selectedFile.name : 'အသံဖိုင် သို့မဟုတ် ဗီဒီယိုဖိုင် ရွေးချယ်ရန် ဤနေရာကို နှိပ်ပါ'}
              </div>
              <p className="text-xs text-[#9AA7B2] font-['JetBrains_Mono'] mt-1">
                {selectedFile
                  ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB · Click to change`
                  : 'MP3, WAV, M4A, MP4, MKV ဖိုင်များ ထည့်သွင်းနိုင်ပါသည်'}
              </p>
            </div>

            {transProgress && (
              <div className="font-['JetBrains_Mono'] text-xs text-[#3ED6B5] mt-3">{transProgress}</div>
            )}

            {transErr && (
              <div className="bg-[#E8604C]/10 border border-[#E8604C] text-[#F5B8AD] px-3.5 py-2.5 rounded text-xs font-['JetBrains_Mono'] mt-3">
                {transErr}
              </div>
            )}

            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={handleTranscribe}
                disabled={!selectedFile || transStatus === 'UPLOADING' || transStatus === 'TRANSCRIBING'}
                className="bg-[#3ED6B5] hover:bg-[#3ED6B5]/90 disabled:bg-[#1B222B] disabled:text-[#5C6672] text-[#08211B] font-['Space_Grotesk'] font-bold text-xs px-4 py-2.5 rounded flex items-center gap-2 transition cursor-pointer disabled:cursor-not-allowed"
              >
                {transStatus === 'TRANSCRIBING' || transStatus === 'UPLOADING' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Transcribing…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    Start AssemblyAI Transcribe
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        {/* ===== CH.03 — PASTE TEXT / SRT / DIALOGUE ===== */}
        <section className="bg-[#141920] border border-[#2A323C] rounded-lg mb-5 overflow-hidden shadow-lg">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[#2A323C] bg-gradient-to-b from-white/[0.03] to-transparent">
            <span className="font-['JetBrains_Mono'] text-[11px] font-bold px-2 py-0.5 rounded bg-[#3ED6B5] text-[#0B0E11]">
              CH.03
            </span>
            <div className="flex items-center gap-2 font-['Space_Grotesk'] font-semibold text-[15px] flex-1">
              <FileText className="w-4 h-4 text-[#3ED6B5]" />
              Paste Text / SRT / Dialogue (စာသား တိုက်ရိုက်ထည့်ရန်)
            </div>
            <span className="font-['JetBrains_Mono'] text-[10px] tracking-wider uppercase text-[#9AA7B2]">
              {pasteStatus}
            </span>
          </div>

          <div className="p-5">
            <textarea
              rows={4}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="ဘာသာပြန်လိုသော အင်္ဂလိပ်စာသား၊ အခြားဘာသာစာသား သို့မဟုတ် SRT Subtitles များကို ဤနေရာတွင် Paste လုပ်ပါ…"
              className="w-full bg-[#0B0E11] border border-[#2A323C] text-[#EDF2F5] p-3 rounded font-['JetBrains_Mono'] text-xs focus:border-[#3ED6B5] outline-none resize-y leading-relaxed transition"
            />

            {pasteErr && (
              <div className="bg-[#E8604C]/10 border border-[#E8604C] text-[#F5B8AD] px-3.5 py-2 rounded text-xs font-['JetBrains_Mono'] mt-2">
                {pasteErr}
              </div>
            )}

            <div className="mt-3 flex items-center justify-between">
              <div className="flex gap-2">
                <button
                  onClick={handleUsePastedText}
                  className="bg-[#1B222B] hover:bg-[#3ED6B5] text-[#3ED6B5] hover:text-[#08211B] border border-[#3ED6B5]/50 font-['Space_Grotesk'] font-semibold text-xs px-3.5 py-2 rounded transition cursor-pointer"
                >
                  Use This Text (စာသား ထည့်သွင်းမည်)
                </button>
                <button
                  onClick={handleClearPastedText}
                  className="text-[#9AA7B2] hover:text-[#EDF2F5] font-['Space_Grotesk'] text-xs px-3 py-2 rounded transition cursor-pointer"
                >
                  Clear
                </button>
              </div>

              <div className="text-[11px] text-[#5C6672] font-['JetBrains_Mono']">
                Auto-splits by sentences or SRT timestamps
              </div>
            </div>
          </div>
        </section>

        {/* ===== CH.04 — TRANSCRIPT SEGMENTS ===== */}
        <section className="bg-[#141920] border border-[#2A323C] rounded-lg mb-5 overflow-hidden shadow-lg">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[#2A323C] bg-gradient-to-b from-white/[0.03] to-transparent">
            <span className="font-['JetBrains_Mono'] text-[11px] font-bold px-2 py-0.5 rounded bg-[#3ED6B5] text-[#0B0E11]">
              CH.04
            </span>
            <div className="flex items-center gap-2 font-['Space_Grotesk'] font-semibold text-[15px] flex-1">
              <FileText className="w-4 h-4 text-[#3ED6B5]" />
              Transcript Segments ({segments.length} Lines)
            </div>
            {segments.length > 0 && (
              <button
                onClick={() => {
                  setSegments([]);
                  setTranslateProgress('');
                  setTranslateErr('');
                }}
                className="text-[#9AA7B2] hover:text-[#E8604C] hover:bg-[#E8604C]/10 px-2.5 py-1 rounded border border-[#2A323C] hover:border-[#E8604C]/30 text-xs font-['JetBrains_Mono'] flex items-center gap-1.5 transition cursor-pointer"
                title="Clear all segments"
              >
                <Trash2 className="w-3.5 h-3.5 text-[#E8604C]" />
                <span>Clear All</span>
              </button>
            )}
          </div>

          <div className="p-5">
            {segments.length === 0 ? (
              <div className="text-center py-8 text-[#5C6672] font-['Space_Grotesk'] text-xs">
                စာသား မရှိသေးပါ။ CH.02 တွင် အသံဖိုင် စာသားပြောင်းပါ သို့မဟုတ် CH.03 တွင် စာသား ကူးထည့်ပါ။
              </div>
            ) : (
              <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                {segments.map((seg, idx) => (
                  <div
                    key={seg.id}
                    className="p-3 rounded bg-[#0B0E11] border border-[#2A323C] text-xs space-y-1.5 hover:border-[#3ED6B5]/40 transition"
                  >
                    <div className="flex items-center justify-between text-[#5C6672] font-['JetBrains_Mono'] text-[10px]">
                      <span>
                        #{idx + 1} {seg.hasTimestamp && `[${fmtTime(seg.start)} → ${fmtTime(seg.end)}]`}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleSpeakSegment(seg)}
                          disabled={activeSegmentTtsId === seg.id}
                          className="text-[#3ED6B5] hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          {activeSegmentTtsId === seg.id ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <Volume2 className="w-3 h-3" />
                          )}
                          <span>Speak</span>
                        </button>
                      </div>
                    </div>

                    <div className="text-[#9AA7B2] font-['JetBrains_Mono']">{seg.text}</div>

                    {seg.translated && (
                      <div className="text-[#3ED6B5] font-['Noto_Sans_Myanmar'] text-[13px] pt-1 border-t border-[#2A323C]/50 leading-relaxed">
                        → {seg.translated}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ===== CH.05 — GEMINI TRANSLATE ===== */}
        <section className="bg-[#141920] border border-[#2A323C] rounded-lg mb-5 overflow-hidden shadow-lg">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[#2A323C] bg-gradient-to-b from-white/[0.03] to-transparent">
            <span className="font-['JetBrains_Mono'] text-[11px] font-bold px-2 py-0.5 rounded bg-[#F2A93B] text-[#2E1D06]">
              CH.05
            </span>
            <div className="flex items-center gap-2 font-['Space_Grotesk'] font-semibold text-[15px] flex-1">
              <Languages className="w-4 h-4 text-[#F2A93B]" />
              Gemini AI Translate (ဘာသာပြန်စနစ်)
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
                  <option value="Burmese (Myanmar)">မြန်မာစာ (Burmese)</option>
                  <option value="English">English</option>
                  <option value="Thai">ภาษาไทย (Thai)</option>
                  <option value="Chinese (Simplified)">中文 (Chinese Simplified)</option>
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

            <div className="flex flex-wrap gap-2.5 items-center justify-between">
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
                  onClick={handleCopyTranslation}
                  disabled={segments.length === 0}
                  className="border border-[#2A323C] hover:border-[#3ED6B5] disabled:border-[#2A323C]/40 text-[#9AA7B2] hover:text-[#3ED6B5] disabled:text-[#5C6672] font-['Space_Grotesk'] text-xs px-3.5 py-2.5 rounded flex items-center gap-1.5 transition cursor-pointer disabled:cursor-not-allowed"
                >
                  {copiedStatus ? <Check className="w-3.5 h-3.5 text-[#3ED6B5]" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedStatus ? 'Copied ✓' : 'Copy Translation'}
                </button>
              </div>

              <span className="text-[11px] text-[#5C6672] font-['Noto_Sans_Myanmar'] flex items-center gap-1">
                <Subtitles className="w-3.5 h-3.5 text-[#3ED6B5]" />
                အသံဖိုင်ထုတ်ယူသည့်အခါ မြန်မာ ၂ ကြောင်း စာတန်းထိုး .SRT ဖိုင်ကို CH.07 History တွင် သိမ်းဆည်းပေးမည်
              </span>
            </div>
          </div>
        </section>

        {/* ===== CH.06 — TEXT TO TTS (EDGE TTS) နီလာ၊ သီဟ၊ မောင်ကျော်သူ ===== */}
        <section id="ch-06-tts" className="bg-[#141920] border-2 border-[#3ED6B5]/60 rounded-lg mb-6 overflow-hidden shadow-2xl relative">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-[#2A323C] bg-gradient-to-r from-[#3ED6B5]/10 via-transparent to-transparent">
            <span className="font-['JetBrains_Mono'] text-[12px] font-bold px-2.5 py-0.5 rounded bg-[#3ED6B5] text-[#0B0E11] shadow">
              CH.06
            </span>
            <div className="flex items-center gap-2 font-['Space_Grotesk'] font-bold text-base text-[#EDF2F5] flex-1">
              <Volume2 className="w-5 h-5 text-[#3ED6B5]" />
              Text to TTS (Edge TTS) — နီလာ၊ သီဟ၊ မောင်ကျော်သူ အသံဖိုင် စာသားကနေ ထုတ်ယူခြင်း
            </div>
            <span className="font-['JetBrains_Mono'] text-[10px] tracking-wider uppercase text-[#3ED6B5] bg-[#3ED6B5]/10 px-2 py-0.5 rounded border border-[#3ED6B5]/20 font-semibold">
              EDGE NEURAL TTS
            </span>
          </div>

          <div className="p-5 sm:p-6 space-y-6">
            {/* Voice Cards: Nilar, Thiha, Giuseppe (မောင်ကျော်သူ) */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <label className="font-['JetBrains_Mono'] text-[11px] text-[#3ED6B5] uppercase tracking-wider font-semibold">
                  ၁။ အသံရွေးချယ်ပါ (Select Neural Voice)
                </label>
                <span className="text-[11px] font-['JetBrains_Mono'] text-[#9AA7B2]">
                  ရွေးချယ်ထားသော အသံ: <span className="text-[#3ED6B5] font-bold">{ttsVoice}</span>
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                {PRIMARY_VOICES.map((v) => {
                  const isSelected = ttsVoice === v.id;
                  return (
                    <div
                      key={v.id}
                      onClick={() => handleSelectPrimaryVoice(v)}
                      className={`p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 flex flex-col justify-between ${
                        isSelected
                          ? 'border-[#3ED6B5] bg-[#3ED6B5]/10 shadow-[0_0_15px_rgba(62,214,181,0.15)] ring-1 ring-[#3ED6B5]'
                          : 'border-[#2A323C] bg-[#0B0E11] hover:border-[#3ED6B5]/50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-base shrink-0 shadow-inner ${
                            isSelected ? 'bg-[#3ED6B5] text-[#0B0E11]' : 'bg-[#1B222B] text-[#9AA7B2]'
                          }`}
                        >
                          {v.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-['Space_Grotesk'] font-bold text-sm text-[#EDF2F5] truncate">
                              {v.name}
                            </span>
                          </div>
                          <div className="text-[10px] font-['JetBrains_Mono'] text-[#3ED6B5] font-semibold mt-0.5">
                            {v.gender}
                          </div>
                        </div>
                      </div>

                      <p className="text-xs text-[#9AA7B2] font-['Noto_Sans_Myanmar'] mt-2.5 leading-relaxed">
                        {v.desc}
                      </p>

                      <div className="mt-3 pt-2.5 border-t border-[#2A323C]/50 flex items-center justify-between">
                        <span
                          className={`text-[10px] font-['JetBrains_Mono'] px-2 py-0.5 rounded font-semibold ${
                            isSelected
                              ? 'bg-[#3ED6B5] text-[#0B0E11]'
                              : 'bg-[#1B222B] text-[#9AA7B2]'
                          }`}
                        >
                          {v.badge}
                        </span>

                        {v.id.includes('Giuseppe') && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTtsVoice(v.id);
                              setTtsRate(30);
                            }}
                            className="text-[10px] font-['JetBrains_Mono'] px-2 py-0.5 rounded bg-[#3ED6B5]/20 text-[#3ED6B5] hover:bg-[#3ED6B5] hover:text-[#0B0E11] transition"
                            title="Set Speed to 1.3x (+30%)"
                          >
                            ⚡ Apply 1.3x Speed
                          </button>
                        )}
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
                  <optgroup label="🌟 Featured Neural Voices (အဓိက အသံများ)">
                    <option value="my-MM-NilarNeural">နီလာ (Nilar - Female မြန်မာ)</option>
                    <option value="my-MM-ThihaNeural">သီဟ (Thiha - Male မြန်မာ)</option>
                    <option value="it-IT-GiuseppeMultilingualNeural">မောင်ကျော်သူ (Giuseppe Fast Vibe ⚡ - Multilingual)</option>
                  </optgroup>
                  <optgroup label="🌐 Global Voices (အခြားနိုင်ငံတကာ အသံများ)">
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
                <div className="space-y-1.5">
                  <textarea
                    rows={3}
                    value={customTtsText}
                    onChange={(e) => setCustomTtsText(e.target.value)}
                    placeholder="အသံထုတ်လိုသော မြန်မာစာသား သို့မဟုတ် အင်္ဂလိပ်စာသားကို ဤနေရာတွင် ရိုက်ထည့်ပါ… (ဥပမာ- 70000, 10000, ၇၀၀၀, ၈၀၀၀)"
                    className="w-full bg-[#0B0E11] border border-[#2A323C] text-[#EDF2F5] p-3 rounded text-xs focus:border-[#3ED6B5] outline-none resize-y leading-relaxed font-['Noto_Sans_Myanmar'] transition"
                  />
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setCustomTtsText(convertNumbersInTextToBurmese(customTtsText))}
                      className="text-[11px] font-['Space_Grotesk'] text-[#3ED6B5] hover:underline flex items-center gap-1 cursor-pointer bg-[#3ED6B5]/10 hover:bg-[#3ED6B5]/20 px-2.5 py-1 rounded border border-[#3ED6B5]/30 transition"
                      title="Convert 70000 -> ၇ သောင်း, 10000 -> ၁ သောင်း, 7000 -> ၇ ထောင်, 8000 -> ၈ ထောင်"
                    >
                      <Hash className="w-3 h-3" />
                      <span>နံပါတ်များကို မြန်မာလို ပြောင်းမည် (၇ သောင်း၊ ၈ ထောင်…)</span>
                    </button>
                    <span className="text-[10px] text-[#5C6672] font-['JetBrains_Mono']">
                      Auto-converts 70000/10000/၇၀၀၀/၈၀၀၀ on TTS
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Voice Adjustments: Speed, Pitch, Volume */}
            <div className="bg-[#0B0E11]/70 border border-[#2A323C] rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="font-['JetBrains_Mono'] text-[10px] text-[#9AA7B2] uppercase tracking-wider font-semibold flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-[#3ED6B5]" />
                  အသံ ထိန်းညှိမှုများ (Speech Parameters)
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setTtsRate(30);
                      setTtsPitch(10);
                    }}
                    className={`text-[10px] font-['JetBrains_Mono'] px-2 py-0.5 rounded transition ${
                      ttsRate === 30 && ttsPitch === 10
                        ? 'bg-[#3ED6B5] text-[#0B0E11] font-bold'
                        : 'bg-[#1B222B] text-[#9AA7B2] hover:text-[#3ED6B5]'
                    }`}
                    title="Speed +30%, Pitch +10Hz"
                  >
                    ⚡ Fast Vibe 1.3x
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTtsRate(60);
                      setTtsPitch(12);
                    }}
                    className={`text-[10px] font-['JetBrains_Mono'] px-2 py-0.5 rounded transition ${
                      ttsRate === 60 && ttsPitch === 12
                        ? 'bg-[#3ED6B5] text-[#0B0E11] font-bold'
                        : 'bg-[#1B222B] text-[#9AA7B2] hover:text-[#3ED6B5]'
                    }`}
                    title="Speed +60%, Pitch +12Hz (Story mode: ~5-6 mins)"
                  >
                    🚀 Story Fast 1.6x
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTtsRate(0);
                      setTtsPitch(0);
                      setTtsVolume(0);
                    }}
                    className="text-[10px] font-['JetBrains_Mono'] px-2 py-0.5 rounded bg-[#1B222B] text-[#9AA7B2] hover:text-[#EDF2F5] transition"
                  >
                    Reset (1.0x)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Rate */}
                <div>
                  <div className="flex justify-between text-xs font-['JetBrains_Mono'] mb-1">
                    <span className="text-[#9AA7B2]">Speed (အမြန်နှုန်း)</span>
                    <span className="text-[#3ED6B5] font-bold">
                      {ttsRate >= 0 ? `+${ttsRate}%` : `${ttsRate}%`}
                      <span className="text-[10px] text-[#9AA7B2] ml-1 font-normal">
                        ({(1 + ttsRate / 100).toFixed(2)}x)
                      </span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-50}
                    max={100}
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
                      1.0x
                    </span>
                    <span
                      onClick={() => setTtsRate(60)}
                      className="cursor-pointer hover:text-[#3ED6B5]"
                      title="Story Fast 1.6x"
                    >
                      1.6x
                    </span>
                    <span>2.0x</span>
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
              <div className="flex items-center gap-2 text-xs flex-wrap">
                <span className="text-[#5C6672] font-['JetBrains_Mono'] text-[11px]">စမ်းသပ်ရန်:</span>
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
                    setTtsVoice('it-IT-GiuseppeMultilingualNeural');
                    setTtsRate(30);
                    setCustomTtsText('ဟိုင်း သူငယ်ချင်းတို့ရေ၊ မောင်ကျော်သူ Fast Vibe အသံနဲ့ ပျော်ရွှင်စွာ နားဆင်လိုက်ရအောင်နော်!');
                  }}
                  className="px-2 py-1 rounded bg-[#3ED6B5]/10 text-[#3ED6B5] hover:bg-[#3ED6B5]/20 text-[11px] font-['Noto_Sans_Myanmar'] cursor-pointer border border-[#3ED6B5]/30 font-medium"
                >
                  ⚡ "မောင်ကျော်သူ Fast Vibe…"
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
                      {PRIMARY_VOICES.find((v) => v.id === ttsVoice)?.name || ttsVoice} — Edge TTS အသံဖိုင် အဆင်သင့်ဖြစ်ပါပြီ
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

                  {/* Download Burmese 2-line SRT Button */}
                  <button
                    onClick={() => {
                      if (currentTtsSrt) {
                        handleDownloadSrt(currentTtsSrt, 'subtitles_burmese_2lines.srt');
                        return;
                      }
                      const durMs = audioDuration ? audioDuration * 1000 : undefined;
                      const textUsed = ttsSourceMode === 'transcript' ? segments.map((s) => s.translated || s.text).filter(Boolean).join(' ') : customTtsText;
                      const srtText = generateBurmeseTwoLineSrt(
                        [],
                        textUsed,
                        durMs
                      );
                      handleDownloadSrt(srtText, 'subtitles_burmese_2lines.srt');
                    }}
                    className="w-full sm:w-auto bg-[#1B222B] hover:bg-[#F2A93B] text-[#F2A93B] hover:text-[#2E1D06] border border-[#F2A93B]/50 font-['Space_Grotesk'] font-semibold text-xs px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition cursor-pointer shrink-0"
                    title="Download 2-line Burmese subtitles (.srt) synchronized with audio"
                  >
                    <Subtitles className="w-4 h-4" />
                    Download .SRT (အချိန်ကိုက် ၂ ကြောင်း)
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ===== CH.07 — GENERATION & TRANSLATION HISTORY ===== */}
        <section id="ch-07-history" className="bg-[#141920] border border-[#2A323C] rounded-lg mb-6 overflow-hidden shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[#2A323C] bg-gradient-to-b from-white/[0.03] to-transparent">
            <div className="flex items-center gap-3">
              <span className="font-['JetBrains_Mono'] text-[11px] font-bold px-2 py-0.5 rounded bg-[#3ED6B5] text-[#0B0E11]">
                CH.07
              </span>
              <div className="flex items-center gap-2 font-['Space_Grotesk'] font-semibold text-[15px] text-[#EDF2F5]">
                <History className="w-4 h-4 text-[#3ED6B5]" />
                History &amp; Saved Audio (ထုတ်ယူထားသော အသံဖိုင်နှင့် ဘာသာပြန် မှတ်တမ်းများ)
              </div>
              <span className="font-['JetBrains_Mono'] text-[11px] px-2 py-0.5 rounded-full bg-[#3ED6B5]/15 text-[#3ED6B5] border border-[#3ED6B5]/30 font-semibold">
                {history.length} ခု
              </span>
            </div>

            {history.length > 0 && (
              <div className="flex items-center gap-2">
                {confirmClearHistory ? (
                  <div className="flex items-center gap-1.5 bg-[#E8604C]/15 border border-[#E8604C] px-2.5 py-1 rounded animate-in fade-in duration-200">
                    <span className="text-[11px] font-['Space_Grotesk'] text-[#F5B8AD] font-medium">
                      မှတ်တမ်းအားလုံး ဖျက်မည်လား?
                    </span>
                    <button
                      onClick={handleClearAllHistory}
                      className="text-[11px] font-bold font-['Space_Grotesk'] bg-[#E8604C] hover:bg-[#E8604C]/90 text-white px-2.5 py-0.5 rounded cursor-pointer transition shadow-sm"
                    >
                      ဖျက်မည် (Confirm)
                    </button>
                    <button
                      onClick={() => setConfirmClearHistory(false)}
                      className="text-[11px] font-['Space_Grotesk'] bg-[#2A323C] hover:bg-[#3A4553] text-[#EDF2F5] px-2 py-0.5 rounded cursor-pointer transition"
                    >
                      မဖျက်ပါ (Cancel)
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmClearHistory(true)}
                    className="text-xs font-['JetBrains_Mono'] text-[#E8604C] hover:bg-[#E8604C]/10 px-2.5 py-1 rounded transition flex items-center gap-1.5 cursor-pointer border border-[#E8604C]/30"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear All (မှတ်တမ်းအားလုံးဖျက်မည်)</span>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="p-5">
            {/* History Search & Filter */}
            {history.length > 0 && (
              <div className="mb-4 relative">
                <Search className="w-4 h-4 text-[#5C6672] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="မှတ်တမ်းများထဲမှ စာသား၊ အသံနာမည် သို့မဟုတ် ဘာသာစကားဖြင့် ရှာဖွေပါ…"
                  className="w-full bg-[#0B0E11] border border-[#2A323C] text-[#EDF2F5] pl-9 pr-4 py-2 rounded-lg text-xs font-['JetBrains_Mono'] focus:border-[#3ED6B5] outline-none transition"
                />
              </div>
            )}

            {filteredHistory.length === 0 ? (
              <div className="text-center py-10 text-[#5C6672] space-y-2">
                <Clock className="w-8 h-8 text-[#5C6672]/60 mx-auto" />
                <div className="font-['Space_Grotesk'] text-sm text-[#9AA7B2]">
                  {historySearch ? 'ရှာဖွေမှုနှင့် ကိုက်ညီသော မှတ်တမ်းမရှိပါ' : 'မှတ်တမ်း မရှိသေးပါ'}
                </div>
                <p className="text-xs font-['JetBrains_Mono']">
                  CH.05 တွင် ဘာသာပြန်ခြင်း သို့မဟုတ် CH.06 တွင် အသံဖိုင် ထုတ်ယူသည့်အခါ ဤနေရာတွင် အလိုအလျောက် သိမ်းဆည်းပေးမည် ဖြစ်ပါသည်။
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredHistory.map((item) => {
                  const isItemPlaying = activeHistoryAudioId === item.id && isHistPlaying;

                  return (
                    <div
                      key={item.id}
                      className="bg-[#0B0E11] border border-[#2A323C] hover:border-[#3ED6B5]/50 rounded-xl p-4 sm:p-5 transition space-y-3.5 shadow-sm"
                    >
                      {/* Item Header */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#2A323C]/60 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-['JetBrains_Mono'] text-[11px] text-[#9AA7B2] flex items-center gap-1">
                            <Clock className="w-3 h-3 text-[#3ED6B5]" />
                            {item.formattedTime}
                          </span>

                          <span className="font-['Space_Grotesk'] text-[11px] px-2 py-0.5 rounded bg-[#3ED6B5]/15 text-[#3ED6B5] font-semibold border border-[#3ED6B5]/30">
                            {item.voiceName}
                          </span>

                          <span className="font-['JetBrains_Mono'] text-[11px] px-2 py-0.5 rounded bg-[#1B222B] text-[#EDF2F5] border border-[#2A323C]">
                            {item.targetLang}
                          </span>

                          {item.speed !== 0 && (
                            <span className="font-['JetBrains_Mono'] text-[10px] px-1.5 py-0.5 rounded bg-[#F2A93B]/15 text-[#F2A93B]">
                              Speed {item.speed >= 0 ? `+${item.speed}%` : `${item.speed}%`}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleLoadHistoryToEditor(item)}
                            className="text-xs font-['Space_Grotesk'] text-[#9AA7B2] hover:text-[#3ED6B5] flex items-center gap-1 transition cursor-pointer"
                            title="Load into Editor"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Load into Editor (အပေါ်သို့ တင်မည်)</span>
                          </button>

                          <button
                            onClick={() => handleDeleteHistoryItem(item.id)}
                            className="text-[#5C6672] hover:text-[#E8604C] transition p-1 cursor-pointer"
                            title="Delete this record"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Source Text (if exists) */}
                      {item.sourceText && (
                        <div className="bg-[#141920]/80 rounded-lg p-3 border border-[#2A323C]/50">
                          <div className="text-[10px] font-['JetBrains_Mono'] text-[#5C6672] uppercase tracking-wider mb-1">
                            မူရင်းစာသား (Original Text)
                          </div>
                          <div className="text-xs text-[#9AA7B2] font-['JetBrains_Mono'] leading-relaxed line-clamp-3">
                            {item.sourceText}
                          </div>
                        </div>
                      )}

                      {/* Translated Text */}
                      <div className="bg-[#141920] rounded-lg p-3.5 border border-[#3ED6B5]/30">
                        <div className="flex items-center justify-between text-[10px] font-['JetBrains_Mono'] text-[#3ED6B5] uppercase tracking-wider mb-1.5 font-semibold">
                          <span>ဘာသာပြန်စာသား (Translated Content)</span>
                          <span className="text-[#5C6672] font-normal">
                            {item.translatedText.length} characters
                          </span>
                        </div>
                        <div className="text-[13px] sm:text-sm text-[#EDF2F5] font-['Noto_Sans_Myanmar'] leading-relaxed">
                          {item.translatedText}
                        </div>
                      </div>

                      {/* History Audio Player & Action Toolbar */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                        {/* Audio Controls */}
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handlePlayHistoryAudio(item)}
                            className={`px-3.5 py-1.5 rounded-lg flex items-center gap-2 text-xs font-['Space_Grotesk'] font-bold transition cursor-pointer shadow ${
                              isItemPlaying
                                ? 'bg-[#E8604C] text-white animate-pulse'
                                : 'bg-[#3ED6B5] hover:bg-[#3ED6B5]/90 text-[#0B0E11]'
                            }`}
                          >
                            {isItemPlaying ? (
                              <>
                                <Pause className="w-3.5 h-3.5 fill-current" />
                                <span>ခေတ္တရပ်မည် (Pause)</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5 fill-current" />
                                <span>အသံနားထောင်မည် (Play Audio)</span>
                              </>
                            )}
                          </button>

                          <button
                            onClick={() => handleDownloadHistoryAudio(item)}
                            className="bg-[#1B222B] hover:bg-[#2A323C] text-[#3ED6B5] border border-[#2A323C] px-3 py-1.5 rounded-lg text-xs font-['Space_Grotesk'] flex items-center gap-1.5 transition cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download MP3</span>
                          </button>

                          {/* Download Burmese 2-line SRT from History */}
                          <button
                            onClick={() => {
                              const srtContent = item.srtContent || generateBurmeseTwoLineSrt([], item.translatedText);
                              handleDownloadSrt(srtContent, `subtitles_${item.id}.srt`);
                            }}
                            className="bg-[#1B222B] hover:bg-[#F2A93B]/20 text-[#F2A93B] border border-[#F2A93B]/40 hover:border-[#F2A93B] px-3 py-1.5 rounded-lg text-xs font-['Space_Grotesk'] flex items-center gap-1.5 transition cursor-pointer"
                            title="Download 2-line Burmese subtitles (.srt)"
                          >
                            <Subtitles className="w-3.5 h-3.5" />
                            <span>Download .SRT (မြန်မာ ၂ ကြောင်း)</span>
                          </button>
                        </div>

                        {/* Copy Translated Text Button */}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleCopyHistoryText(item.translatedText, item.id)}
                            className="text-xs font-['Space_Grotesk'] text-[#9AA7B2] hover:text-[#3ED6B5] bg-[#141920] border border-[#2A323C] px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                          >
                            {copiedHistId === item.id ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-[#3ED6B5]" />
                                <span className="text-[#3ED6B5]">Copied ✓</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copy Text (စာသားကူးယူရန်)</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
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
          SIGNAL PATH · TRANSLATE TOOL &amp; EDGE TTS CONSOLE · VERSION 3.0
        </footer>
      </div>
    </div>
  );
}
