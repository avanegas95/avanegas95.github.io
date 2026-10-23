// Metrics-only logger (SCOPE §10 Q5): no message text, IPs, session IDs or keys.
export type ChatMetric = {
  evt: "chat";
  status: number;
  code?: string;
  mood?: string;
  model?: string;
  turns?: number;
  latencyMs?: number;
  ttfbMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costMicroUsd?: number;
  stopReason?: string;
  errorClass?: string;
};

const KEYS = [
  "evt",
  "status",
  "code",
  "mood",
  "model",
  "turns",
  "latencyMs",
  "ttfbMs",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "costMicroUsd",
  "stopReason",
  "errorClass",
] as const satisfies readonly (keyof ChatMetric)[];

export function logMetric(
  m: ChatMetric,
  sink: (line: string) => void = console.log,
): void {
  const out: Record<string, unknown> = {};
  for (const k of KEYS) {
    const v = (m as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  sink(JSON.stringify(out));
}
