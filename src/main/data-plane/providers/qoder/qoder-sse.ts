export async function* parseQoderSse(response: Response): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) throw new Error("Qoder SSE response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parseFrame = (frame: string): Record<string, unknown> | null => {
    const data: string[] = [];
    let id: string | undefined;
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:") && line.slice(6).trim() === "heartbeat") return null;
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      if (line.startsWith("id:")) id = line.slice(3).trimStart();
    }
    if (data.length === 0) return null;
    try {
      const value = JSON.parse(data.join("\n")) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const event = value as Record<string, unknown>;
      if (id !== undefined && event.id === undefined) event.id = id;
      return event;
    } catch { return null; }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const match = /\r?\n\r?\n/.exec(buffer);
        if (!match || match.index === undefined) break;
        const event = parseFrame(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        if (event) yield event;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) { const event = parseFrame(buffer); if (event) yield event; }
  } finally {
    try { await reader.cancel(); } catch { /* completed or aborted */ }
    reader.releaseLock();
  }
}
