export const APM_ERROR_SUMMARY_BUDGET = {
  maxInputTokens: 180,
  maxOutputTokens: 64,
  label: "APM summary budget: ≤180 input / ≤64 output tokens per surfaced error; cache by timestamp + job + raw line hash.",
} as const;

interface SummaryInput {
  line: string;
  labels?: Record<string, string | undefined>;
}

export interface ApmErrorSummary {
  title: string;
  primary: string;
  meaning: string;
  subsystem: string;
  likelyCause?: string;
  severity: "error" | "fatal" | "panic" | "warning";
  raw: string;
  budget: {
    inputTokens: number;
    outputTokens: number;
    label: string;
  };
}

const SUBSYSTEM_LABELS: Array<[RegExp, string]> = [
  [/hermes.*gateway|gateway/i, "Hermes gateway"],
  [/paperclip.*api|company.*runner|paperclip/i, "Paperclip API"],
  [/console|grafana/i, "Console UI"],
  [/postgres|pg|database|grafana_reader/i, "Postgres"],
  [/loki|prometheus|metrics/i, "Observability stack"],
  [/telegram|imessage|signal|discord/i, "Messaging gateway"],
  [/docker|compose|systemd|kuma/i, "Host service"],
  [/codex|claude|agent|worker/i, "Agent worker"],
];

const summaryCache = new Map<string, ApmErrorSummary>();

function estimateTokens(text: string): number {
  const compact = text.trim().replace(/\s+/g, " ");
  if (!compact) return 0;
  return Math.max(1, Math.ceil(compact.length / 4));
}

function capWords(text: string, maxWords: number): string {
  const words = text.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}…`;
}

function inferSeverity(line: string): ApmErrorSummary["severity"] {
  if (/panic/i.test(line)) return "panic";
  if (/fatal/i.test(line)) return "fatal";
  if (/warn/i.test(line)) return "warning";
  return "error";
}

function labelText(labels: Record<string, string | undefined> | undefined): string {
  if (!labels) return "";
  return [labels.job, labels.app, labels.service_name, labels.container, labels.source]
    .filter(Boolean)
    .join(" ");
}

function humanizeJob(job: string): string {
  return job
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .trim();
}

function inferSubsystem(input: SummaryInput): string {
  const combined = `${labelText(input.labels)} ${input.line}`;
  for (const [pattern, name] of SUBSYSTEM_LABELS) {
    if (pattern.test(combined)) return name;
  }
  const job = input.labels?.job ?? input.labels?.app ?? input.labels?.container;
  return job ? humanizeJob(job) : "Unknown subsystem";
}

function classify(line: string): Pick<ApmErrorSummary, "title" | "meaning" | "likelyCause"> {
  if (/\b(502|503|504|bad gateway|service unavailable|gateway timeout)\b/i.test(line)) {
    return {
      title: "Gateway request failed",
      meaning: "A gateway received the request but could not get a healthy response from the service behind it.",
      likelyCause: "Likely upstream outage, restart, bad port binding, or network refusal.",
    };
  }
  if (/\b(econnrefused|connection refused|connect refused)\b/i.test(line)) {
    return {
      title: "Connection refused",
      meaning: "A component tried to open a network connection and nothing was accepting traffic at that address.",
      likelyCause: "Likely stopped service, wrong host/port, or a listener bound to the wrong interface.",
    };
  }
  if (/\b(timeout|timed out|deadline exceeded|context deadline)\b/i.test(line)) {
    return {
      title: "Request timed out",
      meaning: "A dependency did not answer before the caller's deadline expired.",
      likelyCause: "Likely slow upstream, overloaded service, or network path issue.",
    };
  }
  if (/\b(database|postgres|psql|pg|sql|grafana_reader|authentication failed|password)\b/i.test(line)) {
    return {
      title: "Database connection failed",
      meaning: "A service could not complete a database operation.",
      likelyCause: "Likely database credential, connectivity, schema, or permission problem.",
    };
  }
  if (/\b(rate limit|429|quota|quota_exhausted)\b/i.test(line)) {
    return {
      title: "Provider quota or rate limit hit",
      meaning: "A model or API provider rejected work because the allowed request or token quota was exhausted.",
      likelyCause: "Likely temporary provider throttling, exhausted quota, or too many concurrent workers.",
    };
  }
  if (/\b(401|403|unauthorized|forbidden|expired_token|invalid token|auth)\b/i.test(line)) {
    return {
      title: "Authentication failed",
      meaning: "A service rejected the request because credentials were missing, expired, or not authorized.",
      likelyCause: "Likely expired token, missing secret, or insufficient service permissions.",
    };
  }
  if (/\b(oom|out of memory|killed process|cannot allocate memory)\b/i.test(line)) {
    return {
      title: "Process ran out of memory",
      meaning: "A process exceeded available memory and was killed or failed an allocation.",
      likelyCause: "Likely workload spike, memory leak, or container memory limit.",
    };
  }
  if (/\b(traceback|exception|stack trace|typeerror|referenceerror|valueerror)\b/i.test(line)) {
    return {
      title: "Application exception",
      meaning: "Application code threw an exception while handling work.",
      likelyCause: "Likely unhandled edge case, bad input, or a dependency returning an unexpected value.",
    };
  }
  return {
    title: "Error event detected",
    meaning: "A service emitted an error-level log entry that needs operator attention.",
    likelyCause: "Likely cause is not obvious from this line alone; expand the raw log for details.",
  };
}

export function summarizeApmError(input: SummaryInput): ApmErrorSummary {
  const raw = input.line.trim();
  const cacheKey = JSON.stringify({ raw, labels: input.labels ?? {} });
  const cached = summaryCache.get(cacheKey);
  if (cached) return cached;

  const subsystem = inferSubsystem(input);
  const severity = inferSeverity(raw);
  const classified = classify(raw);
  const meaning = capWords(classified.meaning, 24);
  const likelyCause = classified.likelyCause ? capWords(classified.likelyCause, 20) : undefined;
  const primaryBase = likelyCause
    ? `${classified.title} in ${subsystem}: ${likelyCause}`
    : `${classified.title} in ${subsystem}: ${meaning}`;
  const primary = capWords(primaryBase, 28);
  const outputText = [classified.title, subsystem, meaning, likelyCause, primary].filter(Boolean).join(" ");

  const summary: ApmErrorSummary = {
    title: classified.title,
    primary,
    meaning,
    subsystem,
    likelyCause,
    severity,
    raw,
    budget: {
      inputTokens: Math.min(estimateTokens(raw), APM_ERROR_SUMMARY_BUDGET.maxInputTokens),
      outputTokens: Math.min(estimateTokens(outputText), APM_ERROR_SUMMARY_BUDGET.maxOutputTokens),
      label: APM_ERROR_SUMMARY_BUDGET.label,
    },
  };
  summaryCache.set(cacheKey, summary);
  return summary;
}
