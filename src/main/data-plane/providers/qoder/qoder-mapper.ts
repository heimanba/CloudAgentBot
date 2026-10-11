import { qoderEventSchema, qoderSessionSchema, type ProviderSessionEvent, type ProviderSessionInfo } from "./qoder-wire";

function textContent(raw: Record<string, unknown>): string {
  if (typeof raw.content === "string") return raw.content;
  if (!Array.isArray(raw.content)) return "";
  return raw.content.map((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string" ? (item as Record<string, unknown>).text as string : "").join("");
}
function stopReason(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>).type === "string") return (value as Record<string, unknown>).type as string;
  return undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function errorContent(raw: Record<string, unknown>): string {
  const error = raw.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") {
    return (error as Record<string, unknown>).message as string;
  }
  return typeof raw.message === "string" ? raw.message : "";
}
export function toProviderSession(input: unknown): ProviderSessionInfo {
  const raw = qoderSessionSchema.parse(input);
  const agent = raw.agent && typeof raw.agent === "object" ? raw.agent as Record<string, unknown> : undefined;
  return { id: raw.id as string, agent_id: (typeof raw.agent_id === "string" ? raw.agent_id : agent?.id) as string, environment_id: typeof raw.environment_id === "string" ? raw.environment_id : "", status: typeof raw.status === "string" ? raw.status : "", ...(typeof raw.title === "string" ? { title: raw.title } : {}), created_at: typeof raw.created_at === "string" ? raw.created_at : "", updated_at: typeof raw.updated_at === "string" ? raw.updated_at : "", attributes: raw };
}
export function toProviderEvent(input: unknown): ProviderSessionEvent {
  const raw = qoderEventSchema.parse(input);
  const rawType = raw.type as string;
  const base = {
    raw_type: rawType,
    raw,
    ...(typeof raw.id === "string" ? { id: raw.id } : {}),
    ...(typeof raw.processed_at === "string" ? { processed_at: raw.processed_at } : {}),
    ...(typeof raw.session_thread_id === "string" ? { session_thread_id: raw.session_thread_id } : {}),
  };
  if (rawType === "agent.message" || rawType === "user.message") return { ...base, type: "message", role: rawType.startsWith("user.") ? "user" : "assistant", content: textContent(raw) };
  if (rawType === "session.error") return { ...base, type: "error", content: errorContent(raw) };
  if (rawType.startsWith("session.status_") || rawType.startsWith("session.thread_status_")) {
    const reason = stopReason(raw.stop_reason);
    const status = rawType.includes("terminated") ? "terminated" : rawType.includes("rescheduled") ? "rescheduled" : rawType.includes("idle") ? "idle" : "running";
    return { ...base, type: "status", status, ...(reason ? { stop_reason: reason } : {}) };
  }
  if (rawType === "agent.thinking") {
    return { ...base, type: "thinking", content: stringField(raw.thinking) ?? stringField(raw.text) ?? "" };
  }
  if (rawType === "agent.tool_use" || rawType === "agent.custom_tool_use" || rawType === "agent.mcp_tool_use") {
    return {
      ...base,
      type: "tool_use",
      name: stringField(raw.name) ?? "Tool",
      ...(stringField(raw.mcp_server_name) ? { server_name: stringField(raw.mcp_server_name) } : {}),
      ...(raw.input !== undefined ? { input: raw.input } : {}),
      ...(raw.evaluated_permission !== undefined ? { permission: raw.evaluated_permission } : {}),
    };
  }
  if (rawType === "agent.tool_result" || rawType === "agent.mcp_tool_result" || rawType === "user.tool_result" || rawType === "user.custom_tool_result") {
    return {
      ...base,
      type: "tool_result",
      content: textContent(raw),
      ...(stringField(raw.tool_use_id) ?? stringField(raw.mcp_tool_use_id) ?? stringField(raw.custom_tool_use_id)
        ? { tool_use_id: stringField(raw.tool_use_id) ?? stringField(raw.mcp_tool_use_id) ?? stringField(raw.custom_tool_use_id) }
        : {}),
      ...(booleanField(raw.is_error) !== undefined ? { is_error: booleanField(raw.is_error) } : {}),
    };
  }
  if (rawType === "agent.artifact_delivered") {
    return {
      ...base,
      type: "artifact",
      file_id: stringField(raw.file_id) ?? "",
      filename: stringField(raw.original_filename) ?? "Artifact",
      ...(numberField(raw.size) !== undefined ? { size: numberField(raw.size) } : {}),
      ...(stringField(raw.content_type) ? { content_type: stringField(raw.content_type) } : {}),
    };
  }
  if (rawType === "span.model_request_end") {
    const usage = raw.model_usage && typeof raw.model_usage === "object" ? raw.model_usage as Record<string, unknown> : undefined;
    return {
      ...base,
      type: "usage",
      ...(numberField(usage?.credits) !== undefined ? { credits: numberField(usage?.credits) } : {}),
      is_error: booleanField(raw.is_error) ?? false,
    };
  }
  if (rawType === "event_start") {
    const event = raw.event && typeof raw.event === "object" ? raw.event as Record<string, unknown> : undefined;
    return { ...base, type: "start", event_id: stringField(event?.id) ?? stringField(raw.id), name: stringField(event?.type) };
  }
  if (rawType === "event_delta") {
    const delta = raw.delta && typeof raw.delta === "object" ? raw.delta as Record<string, unknown> : undefined;
    const content = delta?.content && typeof delta.content === "object" ? delta.content as Record<string, unknown> : undefined;
    return {
      ...base,
      type: "delta",
      event_id: stringField(raw.event_id) ?? stringField(raw.id),
      delta_kind: stringField(content?.type) ?? stringField(delta?.type),
      content: stringField(content?.text) ?? stringField(delta?.text) ?? stringField(delta?.thinking) ?? "",
    };
  }
  return { ...base, type: "unknown" };
}
