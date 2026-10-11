import { describe, expect, it } from "vitest";
import { parseQoderSse } from "./qoder-sse";

function chunked(...chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("parseQoderSse", () => {
  it("handles chunked CRLF frames, multi-line data, heartbeat and SSE id", async () => {
    const response = chunked(
      ": keepalive\r\n\r\nevent: heartbeat\r\ndata: {}\r\n\r\nid: evt-1\r\ndata: {\"type\":\"agent.message\",\r\n",
      "data: \"content\":[{\"type\":\"text\",\"text\":\"hi\"}]}\r\n\r\n",
    );
    const events = [];
    for await (const event of parseQoderSse(response)) events.push(event);
    expect(events).toEqual([{ id: "evt-1", type: "agent.message", content: [{ type: "text", text: "hi" }] }]);
  });

  it("ignores malformed frames without ending the stream", async () => {
    const response = chunked("data: nope\n\ndata: {\"type\":\"session.status_idle\"}\n\n");
    const events = [];
    for await (const event of parseQoderSse(response)) events.push(event);
    expect(events).toEqual([{ type: "session.status_idle" }]);
  });
});
