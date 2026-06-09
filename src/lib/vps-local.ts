import { readFileSync, existsSync } from "node:fs";
import { run } from "./shell.ts";

export interface LocalSnapshot {
  hostname: string;
  uptimeSeconds: number;
  loadAvg: [number, number, number];
  cores: number;
  memTotalBytes: number;
  memUsedBytes: number;
  memFreeBytes: number;
  swapUsedBytes: number;
  swapTotalBytes: number;
  diskRootUsedBytes: number;
  diskRootTotalBytes: number;
  cpuPct: number;
  netRxBytes: number;
  netTxBytes: number;
  collectedAt: number;
}

let lastCpu: { idle: number; total: number } | null = null;
let lastNet: { rx: number; tx: number; t: number } | null = null;

export async function snapshot(): Promise<LocalSnapshot> {
  const hostname = readSafe("/etc/hostname").trim() || "host";
  const upRaw = readSafe("/proc/uptime");
  const uptimeSeconds = Number(upRaw.split(" ")[0] || 0);
  const loadParts = readSafe("/proc/loadavg").trim().split(/\s+/);
  const loadAvg: [number, number, number] = [
    Number(loadParts[0] ?? 0),
    Number(loadParts[1] ?? 0),
    Number(loadParts[2] ?? 0),
  ];

  const mem = parseMeminfo();
  const disk = await readRootDisk();
  const cpuPct = readCpuPct();
  const cores = countCores();
  const net = readNet();

  return {
    hostname,
    uptimeSeconds,
    loadAvg,
    cores,
    memTotalBytes: mem.total,
    memUsedBytes: mem.used,
    memFreeBytes: mem.free,
    swapTotalBytes: mem.swapTotal,
    swapUsedBytes: mem.swapUsed,
    diskRootUsedBytes: disk.used,
    diskRootTotalBytes: disk.total,
    cpuPct,
    netRxBytes: net.rxRate,
    netTxBytes: net.txRate,
    collectedAt: Date.now(),
  };
}

function readSafe(p: string): string {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function parseMeminfo() {
  const text = readSafe("/proc/meminfo");
  const kv = new Map<string, number>();
  for (const line of text.split("\n")) {
    const m = line.match(/^(\S+):\s+(\d+)\s*kB/);
    if (m) kv.set(m[1], Number(m[2]) * 1024);
  }
  const total = kv.get("MemTotal") ?? 0;
  const available = kv.get("MemAvailable") ?? 0;
  const free = kv.get("MemFree") ?? 0;
  const used = total - available;
  const swapTotal = kv.get("SwapTotal") ?? 0;
  const swapFree = kv.get("SwapFree") ?? 0;
  return { total, used, free, swapTotal, swapUsed: swapTotal - swapFree };
}

async function readRootDisk(): Promise<{ used: number; total: number }> {
  const r = await run("df", ["-B1", "--output=used,size", "/"], { timeoutMs: 2500 });
  if (!r.ok) return { used: 0, total: 0 };
  const lines = r.stdout.trim().split("\n");
  const last = lines[lines.length - 1].trim().split(/\s+/);
  return { used: Number(last[0] ?? 0), total: Number(last[1] ?? 0) };
}

function readCpuPct(): number {
  const text = readSafe("/proc/stat");
  const line = text.split("\n").find((l) => l.startsWith("cpu "));
  if (!line) return 0;
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = (parts[3] ?? 0) + (parts[4] ?? 0);
  const total = parts.reduce((a, b) => a + b, 0);
  let pct = 0;
  if (lastCpu) {
    const dIdle = idle - lastCpu.idle;
    const dTot = total - lastCpu.total;
    pct = dTot > 0 ? Math.max(0, Math.min(100, (1 - dIdle / dTot) * 100)) : 0;
  }
  lastCpu = { idle, total };
  return pct;
}

function countCores(): number {
  const text = readSafe("/proc/cpuinfo");
  return text.split("\n").filter((l) => l.startsWith("processor")).length || 1;
}

function readNet(): { rxRate: number; txRate: number } {
  const text = readSafe("/proc/net/dev");
  let rx = 0;
  let tx = 0;
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([a-z0-9]+):\s+(\d+).+?\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
    if (!m) continue;
    const iface = m[1];
    if (iface === "lo" || iface.startsWith("docker") || iface.startsWith("br-") || iface.startsWith("veth")) continue;
    rx += Number(m[2]);
    tx += Number(m[4]);
  }
  const now = Date.now();
  let rxRate = 0;
  let txRate = 0;
  if (lastNet && now > lastNet.t) {
    const dt = (now - lastNet.t) / 1000;
    rxRate = Math.max(0, (rx - lastNet.rx) / dt);
    txRate = Math.max(0, (tx - lastNet.tx) / dt);
  }
  lastNet = { rx, tx, t: now };
  return { rxRate, txRate };
}

export interface ServiceStatus {
  unit: string;
  active: "active" | "inactive" | "failed" | "unknown";
}

const TRACKED_SERVICES = [
  "ssh",
  "cloudflared",
  "tailscaled",
  "docker",
  "fail2ban",
];

export async function services(): Promise<ServiceStatus[]> {
  const out: ServiceStatus[] = [];
  for (const unit of TRACKED_SERVICES) {
    const r = await run("systemctl", ["is-active", unit], { timeoutMs: 1500 });
    const v = r.stdout.trim();
    out.push({
      unit,
      active: v === "active" ? "active" : v === "failed" ? "failed" : v === "inactive" ? "inactive" : "unknown",
    });
  }
  const userUnits = ["hermes-dashboard.service"];
  for (const unit of userUnits) {
    const r = await run("systemctl", ["--user", "is-active", unit], { timeoutMs: 1500 });
    const v = r.stdout.trim();
    out.push({
      unit: unit.replace(".service", ""),
      active: v === "active" ? "active" : v === "failed" ? "failed" : v === "inactive" ? "inactive" : "unknown",
    });
  }
  return out;
}

export interface DockerContainer {
  name: string;
  status: string;
  image: string;
  ports: string;
}

export async function dockerContainers(): Promise<DockerContainer[]> {
  const r = await run(
    "docker",
    ["ps", "-a", "--no-trunc", "--format", "{{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}"],
    { timeoutMs: 3000 },
  );
  if (!r.ok) return [];
  return r.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, status, image, ports] = line.split("\t");
      return { name, status, image, ports: ports ?? "" };
    });
}

export function nodeMemoryProcessFiles(): boolean {
  return existsSync("/proc/meminfo");
}
