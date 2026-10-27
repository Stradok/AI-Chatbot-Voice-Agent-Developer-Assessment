"use client";
import { useEffect, useRef } from "react";

const BARS = 48;

// WhatsApp-style scrolling bars: one bar per ~55 ms, height = loudness of the
// given audio track (your microphone, or the agent's voice).
export function Waveform({ track, tone, label }: { track: MediaStreamTrack | null; tone: "you" | "agent"; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !track) return;
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    const color = getComputedStyle(canvas).getPropertyValue("--wave").trim() || "#14a3a0";

    const audio = new AudioContext();
    void audio.resume();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 512;
    audio.createMediaStreamSource(new MediaStream([track])).connect(analyser); // not routed to speakers
    const samples = new Uint8Array(analyser.fftSize);
    const levels: number[] = new Array(BARS).fill(0);

    let raf = 0, last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 55) return;
      last = t;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += ((s - 128) / 128) ** 2;
      levels.push(Math.min(1, Math.sqrt(sum / samples.length) * 4));
      levels.shift();
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      const step = w / BARS, bw = Math.max(2, step * 0.55);
      levels.forEach((l, i) => {
        const bh = Math.max(3, l * h), x = i * step + (step - bw) / 2, y = (h - bh) / 2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, bw / 2);
        else ctx.rect(x, y, bw, bh);
        ctx.fill();
      });
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      void audio.close();
    };
  }, [track]);

  return <canvas ref={ref} className={`wave ${tone}`} role="img" aria-label={label} />;
}
