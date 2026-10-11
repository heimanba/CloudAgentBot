import type { AdapterChatView, ChatAdapter, ChatEventListener } from "../../chat-adapter";
import type {
  ChatDetailView,
  ChatEventView,
  ChatTimelineItemView,
  MessageAttachment,
  MessageFileAttachmentView,
  MessageView,
  SendResult,
  UploadFileInput,
  UploadedFileView,
} from "@shared/models";
import { hostError, isHostError } from "@shared/errors";
import type { ResolvedConnection } from "../../../connections/connection-verifier";
import { BailianDataClient, parseBailianSse } from "./bailian-client";
import { toBailianHostError } from "./bailian-errors";
import { readRemoteRoster } from "../../collaboration-roster";
import {
  API_KEY_SCOPE_METADATA_KEY,
  SESSION_SHARED_METADATA_KEY,
} from "../../../api-key-scope";

type Wire = Record<string, unknown>;

function textContent(raw: Wire): string {
  if (!Array.isArray(raw.content)) return "";
  return raw.content
    .map((block) =>
      block &&
      typeof block === "object" &&
      (block as Wire).type === "text" &&
      typeof (block as Wire).text === "string"
        ? ((block as Wire).text as string)
        : "",
    )
    .join("");
}

/** 从消息内容块解析文件附件：image/video/file 块携带 file_id，file 块另带 filename。 */
function attachmentContent(raw: Wire): MessageFileAttachmentView[] {
  if (!Array.isArray(raw.content)) return [];
  return raw.content.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const wire = block as Wire;
    const type = wire.type;
    if (type !== "image" && type !== "video" && type !== "file") return [];
    const fileId =
      typeof wire.file_id === "string"
        ? wire.file_id
        : typeof wire.fileId === "string"
          ? wire.fileId
          : "";
    if (!fileId) return [];
    const filename = typeof wire.filename === "string" ? wire.filename : undefined;
    return [{ fileId, kind: type, ...(filename ? { filename } : {}) }];
  });
}

function dataContent(raw: Wire): Wire {
  const block = Array.isArray(raw.content)
    ? raw.content.find((item) => item && typeof item === "object" && (item as Wire).type === "data")
    : undefined;
  return block && typeof block === "object" && typeof (block as Wire).data === "object"
    ? ((block as Wire).data as Wire)
    : {};
}

function sessionAgentId(raw: Wire): string {
  if (typeof raw.agent_id === "string") return raw.agent_id;
  return raw.agent && typeof raw.agent === "object" && typeof (raw.agent as Wire).id === "string"
    ? ((raw.agent as Wire).id as string)
    : "";
}

function sessionMetadata(raw: Wire): Wire | undefined {
  return raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
    ? (raw.metadata as Wire)
    : undefined;
}

function keyScopeMarker(raw: Wire): string | undefined {
  const marker = sessionMetadata(raw)?.[API_KEY_SCOPE_METADATA_KEY];
  return typeof marker === "string" && marker.length > 0 ? marker : undefined;
}

function sessionShared(raw: Wire): boolean {
  return sessionMetadata(raw)?.[SESSION_SHARED_METADATA_KEY] === "true";
}

export function toBailianChatView(raw: Wire): AdapterChatView {
  const id = String(raw.id ?? "");
  const agent = raw.agent && typeof raw.agent === "object" ? raw.agent as Wire : undefined;
  const collaboration = readRemoteRoster(agent?.multiagent);
  return {
    ref: { connectionId: "", agentId: sessionAgentId(raw), sessionId: id },
    title: typeof raw.title === "string" && raw.title ? raw.title : id,
    ...(typeof raw.status === "string" ? { remoteStatus: raw.status } : {}),
    ...(typeof raw.updated_at === "string" ? { updatedAt: raw.updated_at } : {}),
    ...(sessionShared(raw) ? { shared: true } : {}),
    ...(keyScopeMarker(raw) ? { keyScopeMarker: keyScopeMarker(raw) } : {}),
    ...(collaboration ? { collaboration } : {}),
  };
}

function eventBase(raw: Wire, index = 0) {
  return {
    id: typeof raw.id === "string" ? raw.id : `bailian-${index}`,
    rawType: typeof raw.type === "string" ? raw.type : "unknown",
    ...(typeof raw.created_at === "string" ? { occurredAt: raw.created_at } : {}),
    ...(typeof raw.thread_id === "string" ? { threadId: raw.thread_id } : {}),
  };
}

export function toBailianTimelineItem(raw: Wire, index = 0): ChatTimelineItemView {
  const base = eventBase(raw, index);
  const type = base.rawType;
  if (type === "thread_created") {
    const data = dataContent(raw);
    return { ...base, kind: "delegation", action: "created",
      ...(typeof data.session_thread_id === "string" ? { threadId: data.session_thread_id } : {}),
      ...(typeof data.agent_name === "string" ? { agentName: data.agent_name } : {}) };
  }
  if (type === "thread_message_sent" || type === "thread_message_received") {
    const sent = type.endsWith("_sent");
    const metadata = raw.metadata && typeof raw.metadata === "object" ? raw.metadata as Wire : {};
    const threadId = metadata[sent ? "to_session_thread_id" : "from_session_thread_id"];
    const agentName = metadata[sent ? "to_agent_name" : "from_agent_name"];
    const content = textContent(raw);
    return { ...base, kind: "delegation", action: sent ? "sent" : "received",
      ...(typeof threadId === "string" ? { threadId } : {}),
      ...(typeof agentName === "string" ? { agentName } : {}),
      ...(content ? { content } : {}) };
  }
  if (type === "message" && (raw.role === "user" || raw.role === "assistant")) {
    const attachments = attachmentContent(raw);
    return {
      ...base,
      kind: "message",
      role: raw.role,
      content: textContent(raw),
      ...(attachments.length > 0 ? { attachments } : {}),
    };
  }
  if (type === "reasoning") return { ...base, kind: "thinking", content: textContent(raw) };
  if (["tool_call", "function_call", "mcp_call", "tool_approval_request"].includes(type)) {
    const data = dataContent(raw);
    return {
      ...base,
      kind: "tool-call",
      name: typeof data.name === "string" ? data.name : type,
      ...(data.arguments !== undefined ? { input: data.arguments } : {}),
    };
  }
  if (
    [
      "tool_call_output",
      "function_call_output",
      "mcp_call_output",
      "tool_approval_response",
    ].includes(type)
  ) {
    const data = dataContent(raw);
    return {
      ...base,
      kind: "tool-result",
      ...(typeof data.call_id === "string" ? { toolUseId: data.call_id } : {}),
      content: typeof data.output === "string" ? data.output : JSON.stringify(data),
      isError: raw.is_error === true,
    };
  }
  if (type === "session_status") {
    const data = dataContent(raw);
    const reason = data.stop_reason;
    return {
      ...base,
      kind: "status",
      scope: "session",
      status: typeof data.session_status === "string" ? data.session_status : "unknown",
      ...(reason && typeof reason === "object" && typeof (reason as Wire).type === "string"
        ? { stopReason: (reason as Wire).type as string }
        : {}),
    };
  }
  if (type === "error") {
    const error = raw.error && typeof raw.error === "object" ? (raw.error as Wire) : {};
    return {
      ...base,
      kind: "error",
      message: typeof error.message === "string" ? error.message : "Session error",
    };
  }
  return { ...base, kind: "unknown" };
}

function toMessages(events: Wire[]): MessageView[] {
  return events.flatMap((event) => {
    if (event.type !== "message" || (event.role !== "user" && event.role !== "assistant"))
      return [];
    const content = textContent(event);
    const attachments = attachmentContent(event);
    if (!content && attachments.length === 0) return [];
    return [
      {
        id: String(event.id),
        role: event.role,
        content,
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(typeof event.created_at === "string" ? { createdAt: event.created_at } : {}),
      },
    ];
  });
}

interface BailianChatAdapterOptions {
  fetchImpl?: typeof fetch;
  reconciliationDelayMs?: number;
  reconciliationAttempts?: number;
  sessionMetadata?: Record<string, string>;
  fileCheckDelayMs?: number;
  fileCheckAttempts?: number;
}

/** 依据 MIME 选择内容块类型：图片/视频用专用块，均携带 filename 以便回读展示。 */
function attachmentContentBlock(attachment: MessageAttachment): Wire {
  const mime = attachment.mimeType ?? "";
  if (mime.startsWith("image/"))
    return { type: "image", file_id: attachment.fileId, filename: attachment.filename };
  if (mime.startsWith("video/"))
    return { type: "video", file_id: attachment.fileId, filename: attachment.filename };
  return { type: "file", file_id: attachment.fileId, filename: attachment.filename };
}

/** 轮询文件安全审核：available 返回；rejected/type_rejected 报 invalid-input；超时 unavailable。 */
async function waitForFileAvailable(
  client: BailianDataClient,
  fileId: string,
  initial: Wire,
  options: BailianChatAdapterOptions,
): Promise<void> {
  const attempts = options.fileCheckAttempts ?? 60;
  const delayMs = options.fileCheckDelayMs ?? 1000;
  let current = initial;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = typeof current.status === "string" ? current.status : "checking";
    if (status === "available") return;
    if (status === "rejected" || status === "type_rejected") {
      throw hostError("invalid-input", `file rejected by safety review: ${status}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    current = await client.getFile(fileId);
  }
  throw hostError("unavailable", "file did not become available in time");
}


function createClient(connection: ResolvedConnection, fetchImpl?: typeof fetch): BailianDataClient {
  if (!connection.workspaceId) throw hostError("invalid-input", "Bailian workspaceId is required");
  return new BailianDataClient({
    apiKey: connection.credential,
    workspaceId: connection.workspaceId,
    fetchImpl,
  });
}

async function listAllEvents(client: BailianDataClient, sessionId: string): Promise<Wire[]> {
  const events: Wire[] = [];
  const seen = new Set<string>();
  let page: string | undefined;
  do {
    const query = new URLSearchParams({ order: "asc", limit: "100" });
    if (page) query.set("page", page);
    const result = await client.request(
      `/sessions/${encodeURIComponent(sessionId)}/events?${query}`,
    );
    for (const event of (result.data as Wire[] | undefined) ?? []) {
      const id = typeof event.id === "string" ? event.id : undefined;
      if (!id || !seen.has(id)) events.push(event);
      if (id) seen.add(id);
    }
    const next = typeof result.next_page === "string" ? result.next_page : undefined;
    if (next && next === page) throw new Error("Bailian event cursor did not advance");
    page = next;
  } while (page);
  return events;
}

function terminalSessionState(raw: Wire): boolean {
  if (raw.type !== "session_status") return false;
  const data = dataContent(raw);
  const reason = data.stop_reason;
  const stopType = reason && typeof reason === "object" ? (reason as Wire).type : undefined;
  return (
    (data.session_status === "idle" && stopType !== "requires_action") ||
    data.session_status === "terminated"
  );
}

export function createBailianChatAdapter(
  connection: ResolvedConnection,
  options: BailianChatAdapterOptions = {},
): ChatAdapter {
  const client = createClient(connection, options.fetchImpl);
  return {
    async listChats(agentId: string): Promise<AdapterChatView[]> {
      try {
        const chats: AdapterChatView[] = [];
        let page: string | undefined;
        do {
          const query = new URLSearchParams({ agent_id: agentId, limit: "100" });
          if (page) query.set("page", page);
          const result = await client.request(`/sessions?${query}`);
          chats.push(...((result.data as Wire[] | undefined) ?? []).map(toBailianChatView));
          page = typeof result.next_page === "string" ? result.next_page : undefined;
        } while (page);
        // Bailian 的 Session 列表不返回 metadata；读取详情补齐归属和共享状态。
        return Promise.all(
          chats.map(async (chat) => {
            if (!chat.ref.sessionId) return chat;
            return toBailianChatView(await client.getSession(chat.ref.sessionId));
          }),
        );
      } catch (error) {
        throw toBailianHostError(error, "bailian list sessions");
      }
    },
    async getChat(sessionId: string): Promise<ChatDetailView> {
      try {
        const chat = await client.getSession(sessionId);
        const events = await listAllEvents(client, sessionId);
        return {
          chat: toBailianChatView(chat),
          messages: toMessages(events),
          events: events.map(toBailianTimelineItem),
        };
      } catch (error) {
        throw toBailianHostError(error, "bailian get session");
      }
    },
    async getKeyScopeMarker(sessionId: string): Promise<string | undefined> {
      try {
        return keyScopeMarker(await client.getSession(sessionId));
      } catch (error) {
        throw toBailianHostError(error, "bailian read session scope");
      }
    },
    async getChatAccess(sessionId) {
      try {
        const session = await client.getSession(sessionId);
        const marker = keyScopeMarker(session);
        return {
          ...(marker ? { keyScopeMarker: marker } : {}),
          shared: sessionShared(session),
        };
      } catch (error) {
        throw toBailianHostError(error, "bailian read session access");
      }
    },
    async setChatShared(sessionId, shared, expectedOwnerScope) {
      try {
        const session = await client.getSession(sessionId);
        if (keyScopeMarker(session) !== expectedOwnerScope) {
          throw hostError("not-found", "chat not found");
        }
        if (
          session.metadata !== undefined &&
          (typeof session.metadata !== "object" ||
            session.metadata === null ||
            Array.isArray(session.metadata))
        ) {
          throw hostError("invalid-input", "session metadata is invalid");
        }
        const metadata = {
          ...((session.metadata ?? {}) as Wire),
          [SESSION_SHARED_METADATA_KEY]: shared ? "true" : "false",
        };
        await client.updateSessionMetadata(sessionId, metadata);
        return toBailianChatView(await client.getSession(sessionId));
      } catch (error) {
        throw toBailianHostError(error, "bailian share session");
      }
    },
    async createChat(
      agentId: string,
      environmentId: string,
      title?: string,
      metadata?: Record<string, string>,
    ): Promise<AdapterChatView> {
      try {
        return toBailianChatView(
          await client.request("/sessions", {
            method: "POST",
            body: JSON.stringify({
              agent: agentId,
              environment_id: environmentId,
              ...(title ? { title } : {}),
              ...((options.sessionMetadata || metadata)
                ? { metadata: { ...(options.sessionMetadata ?? {}), ...(metadata ?? {}) } }
                : {}),
            }),
          }),
        );
      } catch (error) {
        throw toBailianHostError(error, "bailian create session");
      }
    },
    async uploadFile(input: UploadFileInput): Promise<UploadedFileView> {
      try {
        const raw = await client.uploadFile(input.bytes, input.filename, input.mimeType);
        const fileId = typeof raw.id === "string" ? raw.id : "";
        if (!fileId) throw hostError("unavailable", "bailian upload returned no file id");
        await waitForFileAvailable(client, fileId, raw, options);
        return {
          fileId,
          filename: typeof raw.filename === "string" ? raw.filename : input.filename,
          ...(typeof raw.mime_type === "string"
            ? { mimeType: raw.mime_type }
            : input.mimeType
              ? { mimeType: input.mimeType }
              : {}),
          ...(typeof raw.size === "number" ? { sizeBytes: raw.size } : {}),
        };
      } catch (error) {
        throw toBailianHostError(error, "bailian upload file");
      }
    },
    async sendMessage(
      sessionId: string,
      text: string,
      attachments?: MessageAttachment[],
    ): Promise<SendResult> {
      try {
        const content: Wire[] = [
          ...(attachments ?? []).map(attachmentContentBlock),
          ...(text.trim().length > 0 ? [{ type: "text", text }] : []),
        ];
        if (content.length === 0) {
          throw hostError("invalid-input", "message requires text or an attachment");
        }
        await client.request(`/sessions/${encodeURIComponent(sessionId)}/events`, {
          method: "POST",
          body: JSON.stringify({
            input: [{ role: "user", type: "message", content }],
          }),
        });
        return { ok: true };
      } catch (error) {
        throw toBailianHostError(error, "bailian send message");
      }
    },

    async archiveChat(sessionId: string): Promise<void> {
      try {
        await client.archiveSession(sessionId);
      } catch (error) {
        throw toBailianHostError(error, "bailian archive session");
      }
    },

    async deleteChat(sessionId: string): Promise<void> {
      try {
        await client.deleteSession(sessionId);
      } catch (error) {
        throw toBailianHostError(error, "bailian delete session");
      }
    },

    async subscribe(sessionId: string, listener: ChatEventListener): Promise<() => void> {
      const abort = new AbortController();
      let cancelled = false;
      const deltaEvents = new Set<string>();
      const startedEvents = new Map<string, string>();
      const deltaTextByEventAndIndex = new Map<string, Map<number, string>>();
      let response: Response;
      let baselineEvents: Wire[];
      try {
        // 先建立 SSE，再读取发送前历史边界；subscribe resolve 后 Renderer 才会 POST。
        // SSE 在历史请求期间收到的帧由 Response body 缓冲，不会形成观察空窗。
        response = await client.stream(sessionId, abort.signal);
        baselineEvents = await listAllEvents(client, sessionId);
      } catch (error) {
        abort.abort();
        throw toBailianHostError(error, "bailian subscribe");
      }
      const baselineEventIds = new Set(
        baselineEvents.flatMap((event) => (typeof event.id === "string" ? [event.id] : [])),
      );
      const emittedTimelineIds = new Set(baselineEventIds);
      const emit = (event: ChatEventView) => {
        if (!cancelled) listener(event);
      };
      const emitFinalEvent = (raw: Wire) => {
        const id = typeof raw.id === "string" ? raw.id : undefined;
        if (id && emittedTimelineIds.has(id)) return;
        if (id) emittedTimelineIds.add(id);
        if (
          raw.type === "message" &&
          raw.role === "assistant" &&
          !deltaEvents.has(String(raw.id))
        ) {
          const text = textContent(raw);
          if (text) emit({ type: "token", text, ...(id ? { eventId: id } : {}) });
        }
        emit({ type: "timeline", item: toBailianTimelineItem(raw) });
      };
      const reconcileHistory = async (): Promise<boolean> => {
        const attempts = options.reconciliationAttempts ?? 120;
        const delayMs = options.reconciliationDelayMs ?? 500;
        for (let attempt = 0; attempt < attempts && !cancelled; attempt += 1) {
          const events = (await listAllEvents(client, sessionId)).filter(
            (event) => typeof event.id !== "string" || !baselineEventIds.has(event.id),
          );
          for (const event of events) emitFinalEvent(event);
          if (events.some(terminalSessionState)) {
            emit({ type: "done" });
            return true;
          }
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, delayMs);
            abort.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timeout);
                resolve();
              },
              { once: true },
            );
          });
        }
        return cancelled;
      };
      void (async () => {
        try {
          for await (const raw of parseBailianSse(response)) {
            const type = raw.type;
            if (type === "event_start") {
              const event = raw.event && typeof raw.event === "object" ? (raw.event as Wire) : {};
              if (typeof event.id === "string" && typeof event.type === "string") {
                startedEvents.set(event.id, event.type);
              }
              continue;
            }
            if (type === "event_delta") {
              const eventId = typeof raw.event_id === "string" ? raw.event_id : undefined;
              const delta = raw.delta && typeof raw.delta === "object" ? (raw.delta as Wire) : {};
              const content =
                delta.content && typeof delta.content === "object" ? (delta.content as Wire) : {};
              const index = typeof delta.index === "number" ? delta.index : undefined;
              if (eventId && startedEvents.has(eventId)) deltaEvents.add(eventId);
              if (
                eventId &&
                startedEvents.has(eventId) &&
                index !== undefined &&
                content.type === "text" &&
                typeof content.text === "string" &&
                content.text
              ) {
                const byIndex = deltaTextByEventAndIndex.get(eventId) ?? new Map<number, string>();
                byIndex.set(index, `${byIndex.get(index) ?? ""}${content.text}`);
                deltaTextByEventAndIndex.set(eventId, byIndex);
                // ChatEventView.token 表示最终回答文本；reasoning 增量只聚合，
                // 等完整 reasoning Message 到达后作为 thinking 时间线展示。
                if (startedEvents.get(eventId) === "message") {
                  emit({ type: "token", text: content.text, eventId });
                }
              }
              continue;
            }
            emitFinalEvent(raw);
            if (terminalSessionState(raw)) {
              emit({ type: "done" });
              return;
            }
            if (type === "error") {
              const item = toBailianTimelineItem(raw);
              emit({
                type: "error",
                error: hostError(
                  "unavailable",
                  item.kind === "error" ? item.message : "session error",
                ),
              });
              return;
            }
          }
          if (!cancelled && !(await reconcileHistory()))
            emit({
              type: "error",
              error: hostError("unavailable", "bailian stream ended before session completion"),
            });
        } catch (error) {
          if (!cancelled) {
            const mapped = toBailianHostError(error, "bailian stream");
            if (
              isHostError(mapped) &&
              !["authentication", "permission", "not-found", "invalid-input"].includes(mapped.code)
            ) {
              try {
                if (await reconcileHistory()) return;
              } catch {
                // Fall through to the original normalized stream error.
              }
            }
            emit({
              type: "error",
              error: isHostError(mapped)
                ? mapped
                : hostError("unavailable", "bailian stream failed"),
            });
          }
        }
      })();
      return () => {
        cancelled = true;
        abort.abort();
      };
    },
  };
}
