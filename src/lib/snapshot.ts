import { hostinger, type VirtualMachine, type VmMetrics, type DataCenter, type Subscription, type Backup, type Domain } from "./hostinger.ts";
import { snapshot as localSnapshot, services, dockerContainers, type LocalSnapshot, type ServiceStatus, type DockerContainer } from "./vps-local.ts";
import { codexPool, recentIntegrationAudits, type CodexWorker, type IntegrationAudit } from "./workers.ts";
import { hermesStatus, type HermesStatus } from "./hermes.ts";
import { paperclipStatus, type PaperclipStatus } from "./paperclip.ts";
import { activeTasks, recentTasks, companies, type CompanyTask, type Company } from "./tasks.ts";
import { push, series } from "./history.ts";
import { getUpstreamHealth, type UpstreamHealth } from "./upstream.ts";

export interface Snapshot {
  generatedAt: number;
  local: LocalSnapshot;
  localHistory: { cpu: number[]; mem: number[]; rxBps: number[]; txBps: number[] };
  services: ServiceStatus[];
  docker: DockerContainer[];
  hostinger: {
    configured: boolean;
    vm: VirtualMachine | null;
    metrics: VmMetrics | null;
    backups: Backup[];
    dataCenter: DataCenter | null;
    subscriptions: Subscription[];
    domains: Domain[];
    error?: string;
  };
  agents: {
    hermes: HermesStatus;
    paperclip: PaperclipStatus;
    codexPool: CodexWorker[];
  };
  tasks: {
    active: CompanyTask[];
    recent: CompanyTask[];
    companies: Company[];
  };
  audits: IntegrationAudit[];
  upstream: UpstreamHealth[];
}

let cached: Snapshot | null = null;
let cachedAt = 0;
const TTL_MS = 4000;

export async function getSnapshot(force = false): Promise<Snapshot> {
  if (!force && cached && Date.now() - cachedAt < TTL_MS) return cached;

  const [local, svc, docker, codex, hermes, paperclip] = await Promise.all([
    localSnapshot(),
    services(),
    dockerContainers(),
    codexPool(),
    hermesStatus(),
    paperclipStatus(),
  ]);

  push("local.cpu", local.cpuPct);
  push("local.mem", (local.memUsedBytes / Math.max(1, local.memTotalBytes)) * 100);
  push("local.rx", local.netRxBytes);
  push("local.tx", local.netTxBytes);

  let vm: VirtualMachine | null = null;
  let metrics: VmMetrics | null = null;
  let backups: Backup[] = [];
  let dataCenter: DataCenter | null = null;
  let subscriptions: Subscription[] = [];
  let domains: Domain[] = [];
  let hostingerError: string | undefined;

  if (hostinger.configured()) {
    try {
      const [vms, dcs, subs, doms] = await Promise.all([
        hostinger.listVms(),
        hostinger.dataCenters(),
        hostinger.subscriptions(),
        hostinger.domains(),
      ]);
      vm = vms[0] ?? null;
      subscriptions = subs;
      domains = doms;
      if (vm) {
        const [m, b] = await Promise.all([hostinger.metrics(vm.id, 6), hostinger.backups(vm.id)]);
        metrics = m;
        backups = b;
        dataCenter = dcs.find((d) => d.id === vm!.dataCenterId) ?? null;
      }
    } catch (e) {
      hostingerError = (e as Error).message;
    }
  }

  cached = {
    generatedAt: Date.now(),
    local,
    localHistory: {
      cpu: series("local.cpu"),
      mem: series("local.mem"),
      rxBps: series("local.rx"),
      txBps: series("local.tx"),
    },
    services: svc,
    docker,
    hostinger: {
      configured: hostinger.configured(),
      vm,
      metrics,
      backups,
      dataCenter,
      subscriptions,
      domains,
      error: hostingerError,
    },
    agents: {
      hermes,
      paperclip,
      codexPool: codex,
    },
    tasks: {
      active: activeTasks(),
      recent: recentTasks(10),
      companies: companies(),
    },
    audits: recentIntegrationAudits(12),
    upstream: getUpstreamHealth(),
  };
  cachedAt = Date.now();
  return cached;
}
