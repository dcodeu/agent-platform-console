// Oscilloscope — canvas-rendered live host signal for the NOC tab.
//
// CPU drives waveform frequency; RAM drives amplitude. Three rendering passes
// (grid → bloom halo → sharp trace) produce the CRT phosphor look. Scanline
// flicker is injected on the canvas itself so it's frame-accurate rather than
// CSS-approximate.

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

function tracePoints(
  width: number,
  height: number,
  phase: number,
  cpu: number,
  ram: number,
  cpuHistory: number[],
  ramHistory: number[],
  step = 2,
): Array<[number, number]> {
  const mid = height * 0.5;
  const amp = Math.max(14, height * 0.14 + (ram / 100) * height * 0.22);
  const freq = 1.8 + (cpu / 100) * 7.4;
  const history = cpuHistory.length > 2 ? cpuHistory : [cpu];
  const ramTail = ramHistory.length > 2 ? ramHistory : [ram];
  const pts: Array<[number, number]> = [];
  for (let x = 0; x <= width; x += step) {
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
    pts.push([x, y]);
  }
  return pts;
}

function strokePath(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
    else ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.stroke();
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

    let lastFlicker = 0;
    let flickerBands: Array<{ y: number; h: number; a: number }> = [];

    const render = (now: number) => {
      const { cpuPct: cpuRaw, ramPct: ramRaw, cpuHistory: cHist, ramHistory: rHist } = metricsRef.current;
      const cpu = clampPct(cpuRaw, 18);
      const ram = clampPct(ramRaw, 48);
      const phase = now * 0.0032;

      // ── background ──────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, width, cssHeight);
      const bg = ctx.createLinearGradient(0, 0, 0, cssHeight);
      bg.addColorStop(0, "rgba(4, 25, 28, 0.97)");
      bg.addColorStop(0.5, "rgba(3, 13, 18, 0.99)");
      bg.addColorStop(1, "rgba(0, 8, 12, 0.99)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, cssHeight);

      // ── glowing terminal grid ────────────────────────────────────────────────
      ctx.save();
      ctx.lineWidth = 0.5;
      ctx.globalAlpha = 0.34;
      ctx.shadowBlur = 4;
      ctx.shadowColor = "rgba(50, 255, 224, 0.72)";
      ctx.strokeStyle = "rgba(50, 255, 224, 0.28)";
      for (let x = 0; x < width; x += 32) {
        ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, cssHeight); ctx.stroke();
      }
      for (let y = 0; y < cssHeight; y += 28) {
        ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); ctx.stroke();
      }
      // bright dots at intersections
      ctx.shadowBlur = 7;
      ctx.fillStyle = "rgba(48, 255, 224, 0.28)";
      for (let x = 0; x < width; x += 32) {
        for (let y = 0; y < cssHeight; y += 28) {
          ctx.beginPath(); ctx.arc(x, y, 0.7, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();

      // ── compute trace points once, reuse across all passes ───────────────────
      const pts = tracePoints(width, cssHeight, phase, cpu, ram, cHist, rHist, 2);

      // pass 1 — ultra-wide phosphor halo
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 18;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowBlur = 48;
      ctx.shadowColor = "rgba(48, 255, 224, 0.14)";
      ctx.strokeStyle = "rgba(48, 255, 224, 0.06)";
      strokePath(ctx, pts);
      ctx.restore();

      // pass 2 — mid bloom
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 7;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowBlur = 28;
      ctx.shadowColor = "rgba(179, 255, 242, 0.52)";
      ctx.strokeStyle = "rgba(179, 255, 242, 0.22)";
      strokePath(ctx, pts);
      ctx.restore();

      // pass 3 — sharp phosphor trace
      ctx.save();
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowBlur = 16;
      ctx.shadowColor = "rgba(48, 255, 224, 0.78)";
      ctx.strokeStyle = "rgba(78, 255, 230, 0.96)";
      strokePath(ctx, pts);
      ctx.restore();

      // ── CRT sweep highlight ──────────────────────────────────────────────────
      const sweepX = (now * 0.035) % (width + 180) - 90;
      const sweep = ctx.createLinearGradient(sweepX - 42, 0, sweepX + 42, 0);
      sweep.addColorStop(0, "rgba(48, 255, 224, 0)");
      sweep.addColorStop(0.5, "rgba(157, 255, 242, 0.14)");
      sweep.addColorStop(1, "rgba(48, 255, 224, 0)");
      ctx.fillStyle = sweep;
      ctx.fillRect(sweepX - 42, 0, 84, cssHeight);

      // ── vignette ────────────────────────────────────────────────────────────
      const vignette = ctx.createRadialGradient(
        width * 0.5, cssHeight * 0.5, cssHeight * 0.22,
        width * 0.5, cssHeight * 0.5, Math.max(width, cssHeight) * 0.78,
      );
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.44)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, cssHeight);

      // ── scanline flicker ─────────────────────────────────────────────────────
      // Regenerate bands on a staggered interval so flicker feels random, not periodic
      if (now - lastFlicker > 120 + Math.floor((now % 200))) {
        lastFlicker = now;
        flickerBands = Array.from({ length: 2 + Math.floor(cpu / 40) }, () => ({
          y: Math.floor(Math.random() * (cssHeight - 4)),
          h: 1 + Math.floor(Math.random() * 2),
          a: 0.04 + Math.random() * 0.09,
        }));
      }
      for (const b of flickerBands) {
        ctx.fillStyle = `rgba(181, 255, 244, ${b.a.toFixed(3)})`;
        ctx.fillRect(0, b.y, width, b.h);
      }

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
