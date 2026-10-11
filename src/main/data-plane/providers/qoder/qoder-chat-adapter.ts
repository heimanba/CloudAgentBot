/**
 * QoderChatAdapter：Qoder 数据面实现。
 * 在 qoder-client.ts 装配的 QoderDataClient 之上构建；
 * wire 类型（ProviderSessionInfo/ProviderSessionEvent）在本文件内映射为共享 view model，
 * 不越过 Adapter 边界。connectionId 由 ChatDataPlane 在 ref 组装时绑定。
 * Stage 04 只读；Stage 05 追加 createChat/sendMessage/subscribe（写与流式）。
 */

import {
  type ProviderSessionEvent,
  type ProviderSessionInfo,
  type QoderDataClient,
  createQoderDataClient,
} from "./qoder-client";
import type {
  ChatArtifactView,
  ChatEventView,
  ChatTimelineItemView,
  MessageAttachment,
  MessageFileAttachmentView,
  MessageView,
  SendResult,
  UploadFileInput,
  UploadedFileView,
} from "@shared/models";
import type { AdapterChatView, ChatAdapter, ChatEventListener } from "../../chat-adapter";
import { toQoderHostError } from "./qoder-errors";
import { hostError, isHostError } from "@shared/errors";
import type { ResolvedConnection } from "../../../connections/connection-verifier";
import { readRemoteRoster } from "../../collaboration-roster";
import {
  API_KEY_SCOPE_METADATA_KEY,
  SESSION_SHARED_METADATA_KEY,
} from "../../../api-key-scope";

const IMAGE_FILE_EXTENSIONS = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
]);
const PREVIEWABLE_IMAGE_TYPES = new Set(IMAGE_FILE_EXTENSIONS.values());

function imageContentType(contentType: string | undefined, filename: string): string | null {
  const normalizedType = (contentType ?? "").toLowerCase().split(";")[0];
  if (PREVIEWABLE_IMAGE_TYPES.has(normalizedType)) return normalizedType;
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return IMAGE_FILE_EXTENSIONS.get(extension) ?? null;
}

function hasImageSignature(contentType: string, bytes: Uint8Array): boolean {
  if (contentType === "image/png") {
    return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (contentType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/gif") return bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
  return bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

function sessionMetadata(
  raw: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const metadata = raw?.metadata;
  return typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : undefined;
}

function keyScopeMarker(raw: Record<string, unknown> | undefined): string | undefined {
  const marker = sessionMetadata(raw)?.[API_KEY_SCOPE_METADATA_KEY];
  return typeof marker === "string" && marker.length > 0 ? marker : undefined;
}

function sessionShared(raw: Record<string, unknown> | undefined): boolean {
  return sessionMetadata(raw)?.[SESSION_SHARED_METADATA_KEY] === "true";
}

/**
 * Deployment Run 产生的 Session：Qoder 不继承 Deployment metadata，
 * 但 wire 顶层与 metadata 均带 deployment_id，供 ChatDataPlane 继承归属范围。
 */
function sessionDeploymentId(raw: Record<string, unknown> | undefined): string | undefined {
  const top = raw?.deployment_id;
  if (typeof top === "string" && top.length > 0) return top;
  const meta = sessionMetadata(raw)?.deployment_id;
  return typeof meta === "string" && meta.length > 0 ? meta : undefined;
}

export function toChatView(info: ProviderSessionInfo): AdapterChatView {
  const raw = info.attributes as Record<string, unknown> | undefined;
  const agent = raw?.agent && typeof raw.agent === "object" ? raw.agent as Record<string, unknown> : undefined;
  const collaboration = readRemoteRoster(agent?.multiagent);
  const deploymentId = sessionDeploymentId(raw);
  return {
    ref: { connectionId: "", agentId: info.agent_id, sessionId: info.id },
    title: info.title ?? info.id,
    remoteStatus: info.status,
    updatedAt: info.updated_at,
    ...(sessionShared(raw) ? { shared: true } : {}),
    ...(keyScopeMarker(raw) ? { keyScopeMarker: keyScopeMarker(raw) } : {}),
    ...(deploymentId ? { deploymentId } : {}),
    ...(collaboration ? { collaboration } : {}),
  };
}

type MessageAttachmentMap = ReadonlyMap<string, MessageFileAttachmentView[]>;

interface QoderFileResource {
  id: string;
  type: string;
  file_id?: string;
  mount_path?: string;
  created_at?: string;
  updated_at?: string;
}

function sessionResources(info: ProviderSessionInfo): QoderFileResource[] | undefined {
  const raw = info.attributes.resources;
  if (!Array.isArray(raw)) return undefined;
  return raw.flatMap((resource) => {
    if (!resource || typeof resource !== "object") return [];
    const value = resource as Record<string, unknown>;
    if (typeof value.id !== "string" || typeof value.type !== "string") return [];
    return [{
      id: value.id,
      type: value.type,
      ...(typeof value.file_id === "string" ? { file_id: value.file_id } : {}),
      ...(typeof value.mount_path === "string" ? { mount_path: value.mount_path } : {}),
      ...(typeof value.created_at === "string" ? { created_at: value.created_at } : {}),
      ...(typeof value.updated_at === "string" ? { updated_at: value.updated_at } : {}),
    }];
  });
}

function eventId(event: ProviderSessionEvent, index = 0): string {
  return event.id ?? `${event.raw_type}:${event.processed_at ?? index}`;
}

interface MountedFileReference {
  mountPath: string;
  fileId?: string;
  filename?: string;
}

function mountedFileReferences(content: string): {
  content: string;
  references: MountedFileReference[];
} {
  const references: MountedFileReference[] = [];
  let remaining = content;
  for (;;) {
    const match = /^\[([^\]\r\n]+)\][ \t]*/.exec(remaining);
    const mountPath = match?.[1];
    if (!match || !mountPath?.startsWith("/mnt/session/uploads/")) break;
    const relativePath = mountPath.slice("/mnt/session/uploads/".length);
    const separator = relativePath.indexOf("/");
    const fileId = separator > 0 ? relativePath.slice(0, separator) : undefined;
    const filename = relativePath.length > 0
      ? relativePath.slice(relativePath.lastIndexOf("/") + 1)
      : undefined;
    references.push({
      mountPath,
      ...(fileId ? { fileId } : {}),
      ...(filename ? { filename } : {}),
    });
    remaining = remaining.slice(match[0].length);
  }
  return { content: remaining, references };
}

function messageAttachments(
  event: ProviderSessionEvent,
  id: string,
  attachmentsByEventId: MessageAttachmentMap,
): MessageFileAttachmentView[] {
  const persisted = attachmentsByEventId.get(id) ?? [];
  if (persisted.length > 0 || event.role !== "user") return persisted;
  return mountedFileReferences(event.content ?? "").references.flatMap((reference) =>
    reference.fileId
      ? [{
          fileId: reference.fileId,
          kind: "file" as const,
          ...(reference.filename ? { filename: reference.filename } : {}),
        }]
      : [],
  );
}

function messageContent(event: ProviderSessionEvent): string {
  const content = event.content ?? "";
  if (event.role !== "user") return content;
  const parsed = mountedFileReferences(content);
  return parsed.references.length > 0 ? parsed.content : content;
}

export function toMessageViews(
  events: ProviderSessionEvent[],
  attachmentsByEventId: MessageAttachmentMap = new Map(),
): MessageView[] {
  const messages: MessageView[] = [];
  events.forEach((event, index) => {
    if (event.type !== "message") return;
    if (event.role !== "user" && event.role !== "assistant") return;
    const id = eventId(event, index);
    const attachments = messageAttachments(event, id, attachmentsByEventId);
    const content = messageContent(event);
    if (content.length === 0 && attachments.length === 0) return;
    messages.push({
      id,
      role: event.role,
      content,
      createdAt: event.processed_at,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
  });
  return messages;
}

function threadMessageText(raw: Record<string, unknown>): string {
  if (!Array.isArray(raw.content)) return "";
  return raw.content.flatMap((block) =>
    block && typeof block === "object" && typeof (block as Record<string, unknown>).text === "string"
      ? [(block as Record<string, unknown>).text as string] : [],
  ).join("");
}

/** Provider event → 稳定、可展示、Provider-neutral 的时间线 item。 */
export function toTimelineItem(
  event: ProviderSessionEvent,
  index = 0,
  attachmentsByEventId: MessageAttachmentMap = new Map(),
): ChatTimelineItemView {
  const id = eventId(event, index);
  const base = {
    id,
    rawType: event.raw_type,
    ...(event.processed_at ? { occurredAt: event.processed_at } : {}),
    ...(event.session_thread_id ? { threadId: event.session_thread_id } : {}),
  };
  const raw = event.raw as Record<string, unknown>;
  if (event.raw_type === "session.thread_created") {
    return { ...base, kind: "delegation", action: "created",
      ...(typeof raw.agent_name === "string" ? { agentName: raw.agent_name } : {}) };
  }
  if (event.raw_type === "agent.thread_message_sent" || event.raw_type === "agent.thread_message_received") {
    const sent = event.raw_type.endsWith("_sent");
    const threadId = raw[sent ? "to_session_thread_id" : "from_session_thread_id"];
    const agentName = raw[sent ? "to_agent_name" : "from_agent_name"];
    const content = threadMessageText(raw);
    return { ...base, kind: "delegation", action: sent ? "sent" : "received",
      ...(typeof threadId === "string" ? { threadId } : {}),
      ...(typeof agentName === "string" ? { agentName } : {}),
      ...(content ? { content } : {}) };
  }
  if (event.type === "message" && (event.role === "user" || event.role === "assistant")) {
    const attachments = messageAttachments(event, id, attachmentsByEventId);
    return {
      ...base,
      kind: "message",
      role: event.role,
      content: messageContent(event),
      ...(attachments.length > 0 ? { attachments } : {}),
    };
  }
  if (event.type === "thinking") return { ...base, kind: "thinking", content: event.content ?? "" };
  if (event.type === "tool_use") {
    return {
      ...base,
      kind: "tool-call",
      name: event.name ?? "Tool",
      ...(event.server_name ? { serverName: event.server_name } : {}),
      ...(event.input !== undefined ? { input: event.input } : {}),
      ...(event.permission !== undefined ? { permission: event.permission } : {}),
    };
  }
  if (event.type === "tool_result") {
    return {
      ...base,
      kind: "tool-result",
      ...(event.tool_use_id ? { toolUseId: event.tool_use_id } : {}),
      content: event.content ?? "",
      isError: event.is_error ?? false,
    };
  }
  if (event.type === "artifact") {
    return {
      ...base,
      kind: "artifact",
      fileId: event.file_id ?? "",
      filename: event.filename ?? "Artifact",
      ...(event.size !== undefined ? { size: event.size } : {}),
      ...(event.content_type ? { contentType: event.content_type } : {}),
    };
  }
  if (event.type === "status") {
    return {
      ...base,
      kind: "status",
      scope: event.raw_type.startsWith("session.thread_") ? "thread" : "session",
      status: event.status ?? "unknown",
      ...(event.stop_reason ? { stopReason: event.stop_reason } : {}),
    };
  }
  if (event.type === "usage") {
    return {
      ...base,
      kind: "usage",
      ...(event.credits !== undefined ? { credits: event.credits } : {}),
      isError: event.is_error ?? false,
    };
  }
  if (event.type === "error")
    return { ...base, kind: "error", message: event.content ?? "Session error" };
  return { ...base, kind: "unknown" };
}

export function toTimelineItems(
  events: ProviderSessionEvent[],
  attachmentsByEventId: MessageAttachmentMap = new Map(),
): ChatTimelineItemView[] {
  return events.flatMap((event, index) =>
    event.type === "delta" || event.type === "start"
      ? []
      : [toTimelineItem(event, index, attachmentsByEventId)],
  );
}

/**
 * 把单个 SSE wire event 映射为中立 ChatEventView。
 * 只对 Renderer 有意义的子集产生事件，其余返回 null：
 * - assistant message → token（增量展示）；
 * - session idle/terminated → done；
 * - session error → error。
 */
export function toChatEventView(event: ProviderSessionEvent): ChatEventView | null {
  if (event.type === "delta" && event.delta_kind === "text" && (event.content ?? "").length > 0) {
    return {
      type: "token",
      text: event.content ?? "",
      ...(event.event_id ? { eventId: event.event_id } : {}),
    };
  }
  if (event.type === "message" && event.role === "assistant") {
    const text = event.content ?? "";
    return text.length > 0
      ? { type: "token", text, ...(event.id ? { eventId: event.id } : {}) }
      : null;
  }
  if (
    event.type === "status" &&
    event.raw_type.startsWith("session.status_") &&
    (event.status === "terminated" ||
      (event.status === "idle" && event.stop_reason !== "requires_action"))
  ) {
    return { type: "done" };
  }
  if (event.type === "error") {
    return {
      type: "error",
      error: hostError("unavailable", event.content ?? "session error"),
    };
  }
  if (event.type !== "start" && event.type !== "delta")
    return { type: "timeline", item: toTimelineItem(event) };
  return null;
}

/** 翻页拉取一个 Session 的全部持久事件（历史只读）。 */
async function listAllEvents(
  client: QoderDataClient,
  sessionId: string,
): Promise<ProviderSessionEvent[]> {
  const events: ProviderSessionEvent[] = [];
  let afterId: string | undefined;
  const seen = new Set<string>();
  do {
    const result = await client.listEvents(sessionId, {
      limit: 100,
      order: "asc",
      after_id: afterId,
    });
    for (const event of result.events) {
      if (event.id === undefined || !seen.has(event.id)) events.push(event);
      if (event.id !== undefined) seen.add(event.id);
    }
    if (!result.has_more) break;
    if (!result.last_id || result.last_id === afterId)
      throw new Error("qoder event cursor did not advance");
    afterId = result.last_id;
  } while (true);
  return events;
}

function imageFileIds(event: ProviderSessionEvent): string[] {
  if (event.type !== "message" || event.role !== "user" || !Array.isArray(event.raw.content)) return [];
  return event.raw.content.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const content = block as Record<string, unknown>;
    if (content.type !== "image" || !content.source || typeof content.source !== "object") return [];
    const source = content.source as Record<string, unknown>;
    return source.type === "file" && typeof source.file_id === "string" ? [source.file_id] : [];
  });
}

async function sessionMessageAttachments(
  client: QoderDataClient,
  sessionId: string,
  events: ProviderSessionEvent[],
  resourcesFromSession?: QoderFileResource[],
): Promise<MessageAttachmentMap> {
  const userEvents = events.flatMap((event, index) =>
    event.type === "message" && event.role === "user"
      ? [{
          event,
          index,
          time: event.processed_at ? Date.parse(event.processed_at) : undefined,
        }]
      : [],
  );
  if (userEvents.length === 0) return new Map();

  const result = new Map<string, MessageFileAttachmentView[]>();
  const directFileIds = new Set<string>();
  const referencedFileIds = new Set<string>();
  const fileRequests = new Map<string, ReturnType<QoderDataClient["getFile"]>>();
  const getFile = (fileId: string) => {
    const existing = fileRequests.get(fileId);
    if (existing) return existing;
    const request = client.getFile(fileId);
    fileRequests.set(fileId, request);
    return request;
  };
  const append = async (
    id: string,
    fileId: string,
    forcedKind?: MessageFileAttachmentView["kind"],
    fallbackFilename?: string,
  ) => {
    const existing = result.get(id) ?? [];
    if (existing.some((attachment) => attachment.fileId === fileId)) return;
    let file: Awaited<ReturnType<QoderDataClient["getFile"]>> | undefined;
    try {
      file = await getFile(fileId);
    } catch {
      file = undefined;
    }
    const mimeType = file?.mime_type ?? undefined;
    const kind = forcedKind ?? (mimeType?.startsWith("image/")
      ? "image"
      : mimeType?.startsWith("video/")
        ? "video"
        : "file");
    const filename = file?.filename ?? fallbackFilename;
    result.set(id, [
      ...existing,
      {
        fileId,
        kind,
        ...(filename ? { filename } : {}),
      },
    ]);
  };

  for (const { event, index } of userEvents) {
    for (const fileId of imageFileIds(event)) {
      directFileIds.add(fileId);
      await append(eventId(event, index), fileId, "image");
    }
  }

  let listedResources: QoderFileResource[] = [];
  try {
    listedResources = await client.listSessionResources(sessionId);
  } catch {
    listedResources = [];
  }
  const resources = [...(resourcesFromSession ?? []), ...listedResources].filter(
    (resource, index, all) =>
      resource.type === "file" &&
      all.findIndex((candidate) => candidate.id === resource.id) === index,
  );

  for (const { event, index } of userEvents) {
    const id = eventId(event, index);
    for (const reference of mountedFileReferences(event.content ?? "").references) {
      const resource = resources.find((candidate) => candidate.mount_path === reference.mountPath);
      const fileId = resource?.file_id ?? reference.fileId;
      if (!fileId) continue;
      referencedFileIds.add(fileId);
      await append(id, fileId, undefined, reference.filename);
    }
  }

  const legacyResources = resources.filter(
    (resource, index, all) =>
      resource.file_id &&
      !directFileIds.has(resource.file_id) &&
      !referencedFileIds.has(resource.file_id) &&
      all.findIndex((candidate) => candidate.file_id === resource.file_id) === index,
  );
  const allUserEventsTimed = userEvents.every(({ time }) => Number.isFinite(time));
  for (const resource of legacyResources) {
    const attachedAt = resource.created_at ? Date.parse(resource.created_at) : Number.NaN;
    const target = (
      allUserEventsTimed && Number.isFinite(attachedAt)
        ? userEvents.find(({ time }) => (time as number) >= attachedAt)
        : undefined
    ) ?? userEvents.at(-1);
    if (!target || !resource.file_id) continue;
    await append(eventId(target.event, target.index), resource.file_id);
  }
  return result;
}

async function findArtifactEvent(
  client: QoderDataClient,
  sessionId: string,
  fileId: string,
): Promise<ProviderSessionEvent> {
  const events = await listAllEvents(client, sessionId);
  const event = events.find((item) => item.type === "artifact" && item.file_id === fileId);
  if (event === undefined) throw hostError("not-found", "artifact not found in session");
  return event;
}

export function createQoderChatAdapter(connection: ResolvedConnection | string): ChatAdapter {
  const client = createQoderDataClient({
    apiKey: typeof connection === "string" ? connection : connection.credential,
  });

  return {
    async listChats(agentId: string): Promise<AdapterChatView[]> {
      try {
        const chats: AdapterChatView[] = [];
        let page: string | undefined;
        do {
          const result = await client.listSessions({ agent_id: agentId, limit: 100, page });
          for (const info of result.sessions) {
            chats.push(toChatView(info));
          }
          page = result.has_more ? result.next_page : undefined;
        } while (page !== undefined);
        return chats;
      } catch (error) {
        throw toQoderHostError(error, "qoder list sessions");
      }
    },

    async getChat(sessionId: string) {
      try {
        const [info, events] = await Promise.all([
          client.getSession(sessionId),
          listAllEvents(client, sessionId),
        ]);
        const attachmentsByEventId = await sessionMessageAttachments(
          client,
          sessionId,
          events,
          sessionResources(info),
        );
        return {
          chat: toChatView(info),
          messages: toMessageViews(events, attachmentsByEventId),
          events: toTimelineItems(events, attachmentsByEventId),
        };
      } catch (error) {
        throw toQoderHostError(error, "qoder get session");
      }
    },

    async getKeyScopeMarker(sessionId: string): Promise<string | undefined> {
      try {
        const info = await client.getSession(sessionId);
        return keyScopeMarker(info.attributes as Record<string, unknown> | undefined);
      } catch (error) {
        throw toQoderHostError(error, "qoder read session scope");
      }
    },

    async getChatAccess(sessionId) {
      try {
        const info = await client.getSession(sessionId);
        const raw = info.attributes as Record<string, unknown> | undefined;
        const marker = keyScopeMarker(raw);
        const deploymentId = sessionDeploymentId(raw);
        return {
          ...(marker ? { keyScopeMarker: marker } : {}),
          shared: sessionShared(raw),
          ...(deploymentId ? { deploymentId } : {}),
        };
      } catch (error) {
        throw toQoderHostError(error, "qoder read session access");
      }
    },

    async setChatShared(sessionId, shared, expectedOwnerScope) {
      try {
        const info = await client.getSession(sessionId);
        if (
          keyScopeMarker(info.attributes as Record<string, unknown> | undefined) !==
          expectedOwnerScope
        ) {
          throw hostError("not-found", "chat not found");
        }
        await client.updateSessionMetadata(sessionId, {
          [SESSION_SHARED_METADATA_KEY]: shared ? "true" : "false",
        });
        return toChatView(await client.getSession(sessionId));
      } catch (error) {
        if (isHostError(error)) throw error;
        throw toQoderHostError(error, "qoder update session sharing");
      }
    },

    async createChat(
      agentId: string,
      environmentId: string,
      title?: string,
      metadata?: Record<string, string>,
    ): Promise<AdapterChatView> {
      try {
        const info = await client.createSession({
          agent_id: agentId,
          environment_id: environmentId,
          ...(title !== undefined ? { title } : {}),
          ...(metadata ? { metadata } : {}),
        });
        return toChatView(info);
      } catch (error) {
        throw toQoderHostError(error, "qoder create session");
      }
    },

    async uploadFile(input: UploadFileInput): Promise<UploadedFileView> {
      try {
        const file = await client.uploadFile(input.bytes, input.filename, input.mimeType);
        return {
          fileId: file.id,
          filename: file.filename ?? input.filename,
          ...(file.mime_type ? { mimeType: file.mime_type } : input.mimeType ? { mimeType: input.mimeType } : {}),
          ...(file.size_bytes !== undefined ? { sizeBytes: file.size_bytes } : {}),
        };
      } catch (error) {
        throw toQoderHostError(error, "qoder upload file");
      }
    },

    async sendMessage(
      sessionId: string,
      text: string,
      attachments?: MessageAttachment[],
    ): Promise<SendResult> {
      try {
        const imageAttachments = (attachments ?? []).filter(
          (attachment) => imageContentType(attachment.mimeType, attachment.filename) !== null,
        );
        const fileAttachments = (attachments ?? []).filter(
          (attachment) => imageContentType(attachment.mimeType, attachment.filename) === null,
        );
        const mountedReferences: string[] = [];
        for (const attachment of fileAttachments) {
          const resource = await client.addSessionFileResource(sessionId, attachment.fileId);
          const mountPath = resource.mount_path;
          if (
            !mountPath?.startsWith("/mnt/session/uploads/") ||
            mountPath.includes("]") ||
            mountPath.includes("\r") ||
            mountPath.includes("\n")
          ) {
            throw hostError("unavailable", "qoder file resource did not return a valid mount path");
          }
          mountedReferences.push(`[${mountPath}]`);
        }
        await client.sendMessage(
          sessionId,
          [...mountedReferences, ...(text.length > 0 ? [text] : [])].join(" "),
          imageAttachments.map((attachment) => attachment.fileId),
        );
        return { ok: true };
      } catch (error) {
        throw toQoderHostError(error, "qoder send message");
      }
    },

    async archiveChat(sessionId: string): Promise<void> {
      try {
        await client.archiveSession(sessionId);
      } catch (error) {
        throw toQoderHostError(error, "qoder archive session");
      }
    },

    async deleteChat(sessionId: string): Promise<void> {
      try {
        await client.deleteSession(sessionId);
      } catch (error) {
        throw toQoderHostError(error, "qoder delete session");
      }
    },

    async getArtifact(
      sessionId: string,
      fileId: string,
      options?: { includeContent?: boolean },
    ): Promise<ChatArtifactView> {
      try {
        const event = await findArtifactEvent(client, sessionId, fileId);
        const download = await client.getFileDownloadUrl(fileId);
        const result: ChatArtifactView = {
          ref: { connectionId: "", agentId: "", sessionId },
          fileId,
          filename: event.filename ?? "Artifact",
          ...(event.content_type ? { contentType: event.content_type } : {}),
          ...(event.size !== undefined ? { size: event.size } : {}),
          downloadUrl: download.url,
        };
        if (options?.includeContent !== true) return result;
        const response = await fetch(download.url);
        if (!response.ok) throw hostError("unavailable", "qoder artifact download failed");
        const contentType = response.headers.get("content-type") ?? undefined;
        const effectiveContentType = result.contentType ?? contentType;
        const previewImageType = imageContentType(effectiveContentType, result.filename);
        if (previewImageType !== null) {
          const bytes = await response.arrayBuffer();
          if (!hasImageSignature(previewImageType, new Uint8Array(bytes))) {
            throw hostError("unavailable", "qoder artifact preview content is not a valid image");
          }
          return {
            ...result,
            ...(contentType && !result.contentType ? { contentType } : {}),
            previewData: { contentType: previewImageType, bytes },
          };
        }
        result.content = await response.text();
        return contentType && !result.contentType ? { ...result, contentType } : result;
      } catch (error) {
        if (isHostError(error)) throw error;
        throw toQoderHostError(error, "qoder get artifact");
      }
    },

    subscribe(sessionId: string, listener: ChatEventListener): Promise<() => void> {
      let cancelled = false;
      const safeEmit = (event: ChatEventView) => {
        if (!cancelled) listener(event);
      };

      // fire-and-forget：subscribe 立即返回 unsubscribe。
      // Qoder SSE 是静默流——无初始握手帧，新 session 在 sendMessage 之前可能完全无 data。
      // 如果 await 首个 iterator.next() 才返回，会死锁：UI 等 subscribe 完成才允许 sendMessage，
      // 而 subscribe 永远等不到 sendMessage 触发的事件（bg_1/bg_6 实测：60s+ 无响应）。
      // 连接级错误（401、网络失败、session 不存在）在后台循环中捕获并以 error 事件上抛。
      let doneEmitted = false;
      let iterator: AsyncIterator<ProviderSessionEvent> | null = null;
      let lastEventId: string | undefined;
      const deltaEventIds = new Set<string>();
      const emittedEventIds = new Set<string>();

      const handleEvent = (raw: ProviderSessionEvent): boolean => {
        if (raw.id) lastEventId = raw.id;
        if (raw.type === "delta" && raw.event_id) deltaEventIds.add(raw.event_id);
        if (raw.type === "message" && raw.id && deltaEventIds.has(raw.id)) return false;
        if (raw.id && raw.type !== "delta" && emittedEventIds.has(raw.id)) return false;
        if (raw.id && raw.type !== "delta") emittedEventIds.add(raw.id);
        const view = toChatEventView(raw);
        if (view !== null) {
          safeEmit(view);
          if (view.type === "done") doneEmitted = true;
          return view.type === "done";
        }
        return false;
      };

      void (async () => {
        try {
          for (let attempt = 0; attempt < 4 && !cancelled && !doneEmitted; attempt += 1) {
            iterator = client
              .streamEvents(sessionId, {
                ...(lastEventId ? { last_event_id: lastEventId } : {}),
                event_deltas: ["agent.message"],
                include_tool_calls: true,
                include_thinking: true,
              })
              [Symbol.asyncIterator]();
            for (;;) {
              const result = await iterator.next();
              if (result.done || cancelled) break;
              if (handleEvent(result.value)) break;
            }
            if (!doneEmitted && !cancelled && attempt < 3) {
              await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
            }
          }
          if (!cancelled && !doneEmitted) {
            safeEmit({
              type: "error",
              error: hostError("unavailable", "qoder stream ended before session completion"),
            });
          }
        } catch (error) {
          if (!cancelled) {
            const mapped = toQoderHostError(error, "qoder stream");
            safeEmit({
              type: "error",
              error: isHostError(mapped) ? mapped : hostError("unavailable", "qoder stream failed"),
            });
          }
        }
      })();

      return Promise.resolve(() => {
        cancelled = true;
        void iterator?.return?.(undefined);
      });
    },
  };
}
