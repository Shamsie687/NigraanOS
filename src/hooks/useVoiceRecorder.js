import { useEffect, useRef, useState } from 'react';
import { AUDIO_LIMIT, AUDIO_TYPES } from '../utils/evidenceValidation';

export default function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [audio, setAudio] = useState(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const recorder = useRef(null);
  const stream = useRef(null);
  const mounted = useRef(true);
  const request = useRef(0);
  const supported = typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const release = () => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; request.current++;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      release();
    };
  }, []);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);
  function stop() {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }
  useEffect(() => { if (seconds >= 120) stop(); }, [seconds]);

  async function start() {
    if (!supported) { setError('Voice recording is unavailable in this browser. You can submit without voice.'); return; }
    setStarting(true); setError('');
    const version = ++request.current;
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || version !== request.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const mime = ['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      const instance = mime ? new MediaRecorder(media, { mimeType: mime }) : new MediaRecorder(media);
      recorder.current = instance;
      const chunks = [];
      let bytes = 0;
      let oversized = false;
      let failed = false;
      instance.ondataavailable = event => {
        if (!event.data.size) return;
        bytes += event.data.size;
        if (bytes > AUDIO_LIMIT) { oversized = true; stop(); }
        else chunks.push(event.data);
      };
      instance.onerror = () => { failed = true; setError('Recording failed. Please re-record or submit without voice.'); stop(); release(); };
      instance.onstop = () => {
        release();
        if (!mounted.current) return;
        setRecording(false);
        const blob = new Blob(chunks, { type: instance.mimeType || chunks[0]?.type || '' });
        if (failed || oversized || !blob.size || !AUDIO_TYPES.includes(blob.type.split(';')[0])) {
          setAudio(null); setError('The recording is empty, unsupported or too large. Try a shorter recording.'); return;
        }
        setAudio(blob);
      };
      setAudio(null); setSeconds(0); setRecording(true);
      instance.start(1000);
    } catch {
      release();
      if (mounted.current) setError('Microphone access failed. Allow microphone permission and try again, or submit without voice.');
    } finally { if (mounted.current) setStarting(false); }
  }
  function clear() { setAudio(null); setSeconds(0); setError(''); }
  return { recording, seconds, audio, error, starting, supported, start, stop, clear };
}

