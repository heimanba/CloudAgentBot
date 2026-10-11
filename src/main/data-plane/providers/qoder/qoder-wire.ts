import { z } from "zod";

const wireObject = z.record(z.string(), z.unknown());

export const qoderListSchema = z.object({
  data: z.array(wireObject).default([]),
  has_more: z.boolean().optional(),
  next_page: z.string().nullable().optional(),
});

export const qoderEventListSchema = z.object({
  data: z.array(wireObject).default([]),
  first_id: z.string().nullable().optional(),
  last_id: z.string().nullable().optional(),
  has_more: z.boolean().default(false),
});

export const qoderFileDownloadSchema = z.object({
  url: z.string().url().refine((value) => value.startsWith("http:") || value.startsWith("https:")),
  expires_at: z.string().optional(),
});

export const qoderUploadedFileSchema = z.object({
  id: z.string().min(1),
  filename: z.string().optional(),
  size_bytes: z.number().nonnegative().optional(),
  mime_type: z.string().nullable().optional(),
});

export const qoderSessionResourceSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  file_id: z.string().optional(),
  mount_path: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const qoderSessionResourceListSchema = z.object({
  data: z.array(qoderSessionResourceSchema).default([]),
  has_more: z.boolean().optional(),
  next_page: z.string().nullable().optional(),
});

export const qoderSessionSchema = wireObject.superRefine((value, context) => {
  if (typeof value.id !== "string" || value.id.length === 0) context.addIssue({ code: "custom", message: "session.id must be a non-empty string" });
  const agent = value.agent;
  const agentId = typeof value.agent_id === "string" ? value.agent_id : agent && typeof agent === "object" && typeof (agent as Record<string, unknown>).id === "string" ? (agent as Record<string, unknown>).id : undefined;
  if (!agentId) context.addIssue({ code: "custom", message: "session.agent id must be present" });
});

export const qoderEventSchema = wireObject.superRefine((value, context) => {
  if (typeof value.type !== "string" || value.type.length === 0) context.addIssue({ code: "custom", message: "event.type must be a non-empty string" });
});

export interface QoderCreateSessionInput { agent_id: string; environment_id: string; title?: string; metadata?: Record<string, string> }
export interface SessionFilter { agent_id?: string; limit?: number; page?: string }
export interface EventListOptions { limit?: number; after_id?: string; before_id?: string; order?: "asc" | "desc" }
export interface EventStreamOptions {
  last_event_id?: string;
  event_deltas?: Array<"agent.message" | "agent.thinking">;
  include_tool_calls?: boolean;
  include_thinking?: boolean;
}
export interface ProviderSessionInfo { id: string; agent_id: string; environment_id: string; status: string; title?: string; created_at: string; updated_at: string; attributes: Record<string, unknown> }
export type ProviderSessionEventType = "message" | "status" | "error" | "thinking" | "tool_use" | "tool_result" | "artifact" | "usage" | "delta" | "start" | "unknown";
export interface ProviderSessionEvent {
  type: ProviderSessionEventType;
  raw_type: string;
  id?: string;
  processed_at?: string;
  session_thread_id?: string;
  role?: string;
  content?: string;
  status?: string;
  stop_reason?: string;
  name?: string;
  server_name?: string;
  input?: unknown;
  permission?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  file_id?: string;
  filename?: string;
  size?: number;
  content_type?: string;
  credits?: number;
  event_id?: string;
  delta_kind?: string;
  raw: Record<string, unknown>;
}
export interface SessionListResult { sessions: ProviderSessionInfo[]; has_more: boolean; next_page?: string }
export interface ProviderSessionEventList { events: ProviderSessionEvent[]; first_id?: string; last_id?: string; has_more: boolean }
