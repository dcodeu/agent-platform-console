import type { Context } from "hono";
import { stream } from "hono/streaming";

type Subscriber = { id: number; send: (event: string, data: unknown) => Promise<void> };

const subs = new Map<number, Subscriber>();
let nextId = 1;

export function broadcast(event: string, data: unknown): void {
  for (const s of subs.values()) {
    s.send(event, data).catch(() => {
      subs.delete(s.id);
    });
  }
}

export function streamSseHandler(c: Context) {
  c.header("Content-Type", "text/event-stream; charset=utf-8");
  c.header("Cache-Control", "no-cache, no-transform");
  c.header("Connection", "keep-alive");
  c.header("X-Accel-Buffering", "no");

  return stream(c, async (out) => {
    const id = nextId++;
    const sub: Subscriber = {
      id,
      send: async (event: string, data: unknown) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        await out.write(payload);
      },
    };
    subs.set(id, sub);

    await out.write(`retry: 5000\nevent: hello\ndata: ${JSON.stringify({ id, ts: Date.now() })}\n\n`);

    const keepalive = setInterval(() => {
      out.write(`: ping ${Date.now()}\n\n`).catch(() => {
        clearInterval(keepalive);
        subs.delete(id);
      });
    }, 15_000);

    out.onAbort(() => {
      clearInterval(keepalive);
      subs.delete(id);
    });

    // Keep stream open indefinitely
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!subs.has(id)) {
          clearInterval(check);
          clearInterval(keepalive);
          resolve();
        }
      }, 1000);
    });
  });
}

export function subscriberCount(): number {
  return subs.size;
}
