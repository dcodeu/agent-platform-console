// Oscilloscope — canvas-rendered live host signal for the NOC tab.
//
// CPU drives waveform frequency; RAM drives amplitude. The component keeps a
// small animation loop so the line feels alive between metric refetches while
// still being fully driven by real live percentages from the snapshot API.

import { useEffect, useRef } from "react";

export interface OscilloscopeProps {
  cpuPct: number | null;
  ramPct: number | null;
  cpuHistory?: number[];
  ramHistory?: number[];
  height?: number;
  className?: string;
}

function clampPct(value: number | null | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, value));
}

function drawTrace(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  phase: number,
  cpu: number,
  ram: number,
  cpuHistory: number[],
  ramHistory: number[],
) {
  const mid = height * 0.5;
  const amp = Math.max(14, (height * 0.14) + (ram / 100) * height * 0.22);
  const freq = 1.8 + (cpu / 100) * 7.4;
  const history = cpuHistory.length > 2 ? cpuHistory : [cpu];
  const ramTail = ramHistory.length > 2 ? ramHistory : [ram];

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowBlur = 18;
  ctx.shadowColor = "rgba(48, 255, 224, 0.68)";
  ctx.strokeStyle = "rgba(78, 255, 230, 0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();

  for (let x = 0; x <= width; x += 2) {
    const t = x / width;
    const hIndex = Math.min(history.length - 1, Math.floor(t * history.length));
    const rIndex = Math.min(ramTail.length - 1, Math.floor(t * ramTail.length));
    const localCpu = clampPct(history[hIndex], cpu);
    const localRam = clampPct(ramTail[rIndex], ram);
    const localAmp = amp * (0.72 + (localRam / 100) * 0.44);
    const harmonic = Math.sin(t * Math.PI * 2 * (freq * 0.48) + phase * 0.71) * 0.34;
    const carrier = Math.sin(t * Math.PI * 2 * freq + phase);
    const twitch = Math.sin(t * Math.PI * 2 * (15 + localCpu * 0.05) - phase * 1.8) * 0.08;
    const y = mid + (carrier + harmonic + twitch) * localAmp * 0.58;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.stroke();

  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = "rgba(179, 255, 242, 0.36)";
  ctx.lineWidth = 6;
  ctx.shadowBlur = 28;
  ctx.beginPath();
  for (let x = 0; x <= width; x += 6) {
    const t = x / width;
    const carrier = Math.sin(t * Math.PI * 2 * freq + phase);
    const y = mid + carrier * amp * 0.5;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

export function Oscilloscope({
  cpuPct,
  ramPct,
  cpuHistory = [],
  ramHistory = [],
  height = 260,
  className = "",
}: OscilloscopeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const metricsRef = useRef({ cpuPct, ramPct, cpuHistory, ramHistory });

  useEffect(() => {
    metricsRef.current = { cpuPct, ramPct, cpuHistory, ramHistory };
  }, [cpuPct, ramPct, cpuHistory, ramHistory]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let width = 0;
    let cssHeight = height;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      width = Math.max(320, Math.floor(rect.width));
      cssHeight = Math.max(180, Math.floor(rect.height || height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(cssHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const render = (now: number) => {
      const { cpuPct: cpuRaw, ramPct: ramRaw, cpuHistory: cHist, ramHistory: rHist } = metricsRef.current;
      const cpu = clampPct(cpuRaw, 18);
      const ram = clampPct(ramRaw, 48);
      const phase = now * 0.0032;

      ctx.clearRect(0, 0, width, cssHeight);
      const gradient = ctx.createLinearGradient(0, 0, 0, cssHeight);
      gradient.addColorStop(0, "rgba(4, 25, 28, 0.94)");
      gradient.addColorStop(0.5, "rgba(3, 13, 18, 0.98)");
      gradient.addColorStop(1, "rgba(0, 8, 12, 0.98)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, cssHeight);

      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = "rgba(50, 255, 224, 0.16)";
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, cssHeight);
        ctx.stroke();
      }
      for (let y = 0; y < cssHeight; y += 28) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
        ctx.stroke();
      }
      ctx.restore();

      drawTrace(ctx, width, cssHeight, phase, cpu, ram, cHist, rHist);

      const sweepX = (now * 0.035) % (width + 180) - 90;
      const sweep = ctx.createLinearGradient(sweepX - 42, 0, sweepX + 42, 0);
      sweep.addColorStop(0, "rgba(48, 255, 224, 0)");
      sweep.addColorStop(0.5, "rgba(157, 255, 242, 0.18)");
      sweep.addColorStop(1, "rgba(48, 255, 224, 0)");
      ctx.fillStyle = sweep;
      ctx.fillRect(sweepX - 42, 0, 84, cssHeight);

      raf = window.requestAnimationFrame(render);
    };

    raf = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [height]);

  return (
    <div className={`noc-scope ${className}`} style={{ minHeight: height }}>
      <canvas ref={canvasRef} aria-label="Live CPU and RAM oscilloscope" />
      <div className="noc-scope-scanlines" aria-hidden="true" />
    </div>
  );
}
