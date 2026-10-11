/**
 * ChatAdapter：Provider 数据面 seam。
 * 每个 Provider 实现一个 Adapter；wire 类型不越过本 Interface。
 * ref.connectionId 由 ChatDataPlane 绑定，Adapter 返回时置空。
 * Stage 04 定义只读子集；Stage 05 追加 create/send/subscribe。
 *
 * 环境解析（agent → environment_id）是 ChatDataPlane 的职责：
 * Adapter 接收显式 environmentId，不自行 listEnvironments 或猜测。
 */

import type {
  ChatArtifactView,
  ChatDetailView,
  ChatEventView,
  ChatView,
  MessageAttachment,
  SendResult,
  UploadFileInput,
  UploadedFileView,
} from "@shared/models";

/** Private adapter result field; ChatDataPlane strips it before crossing preload. */
export type AdapterChatView = ChatView & {
  keyScopeMarker?: string;
  /**
   * Session 关联的 Deployment ID（Main-only，ChatDataPlane 剥离）。
   * 部分 Provider（Qoder）的 Deployment Run Session 不继承 Deployment metadata，
   * ChatDataPlane 用该字段继承 Deployment 的归属范围。
   */
  deploymentId?: string;
};
export type AdapterChatDetailView = Omit<ChatDetailView, "chat"> & { chat: AdapterChatView };
export interface AdapterChatAccess {
  keyScopeMarker?: string;
  shared: boolean;
  /** 同 AdapterChatView.deploymentId。 */
  deploymentId?: string;
}

/** subscribe 的监听器接收中立的流式事件；Adapter 把 wire event 映射为它。 */
export type ChatEventListener = (event: ChatEventView) => void;

export interface ChatAdapter {
  listChats(agentId: string): Promise<AdapterChatView[]>;
  getChat(sessionId: string): Promise<AdapterChatDetailView>;
  getKeyScopeMarker(sessionId: string): Promise<string | undefined>;
  getChatAccess?(sessionId: string): Promise<AdapterChatAccess>;
  setChatShared?(
    sessionId: string,
    shared: boolean,
    expectedOwnerScope: string,
  ): Promise<AdapterChatView>;

  /**
   * 创建一个远程 Session。environmentId 由 ChatDataPlane 解析后显式传入；
   * 省略时由 Provider 端拒绝（Qoder 要求 environment_id）。
   */
  createChat(
    agentId: string,
    environmentId: string,
    title?: string,
    metadata?: Record<string, string>,
  ): Promise<AdapterChatView>;

  /** 发送纯文本与可选附件；resolve 表示 Provider 已接收（receipt），不代表最终回复完成。 */
  sendMessage(sessionId: string, text: string, attachments?: MessageAttachment[]): Promise<SendResult>;

  /**
   * 上传文件并阻塞轮询至 available，返回文件引用。Connection 级操作（Workspace 全局），
   * 不绑定 Session。Provider 不支持时可省略。
   */
  uploadFile?(input: UploadFileInput): Promise<UploadedFileView>;

  /**
   * 订阅实时 SSE 事件，返回取消订阅函数。
   * fire-and-forget：Promise 立即 resolve，不等首帧（Qoder SSE 是静默流，
   * 新 session 在 sendMessage 之前可能完全无 data；等首帧会与 sendMessage 死锁）。
   * 连接级错误（401、网络失败、session 不存在）经 error 事件上抛，不 reject。
   * Adapter 内部抑制 heartbeat、映射 wire event 为 ChatEventView；
   * idle/terminated 或流自然结束时以 done 通知；错误以 error 通知。
   * 取消订阅只关闭本地流，不影响 Provider 已接受的远程运行。
   */
  subscribe(sessionId: string, listener: ChatEventListener): Promise<() => void>;

  /** 归档远程 Session；具体语义由 Provider 决定（Qoder 设置 archived_at，Bailian 置 terminated）。 */
  archiveChat(sessionId: string): Promise<void>;

  /** 删除远程 Session；Bailian 为硬删除且不可恢复，UI 必须二次确认。 */
  deleteChat(sessionId: string): Promise<void>;

  /** 获取 Session 内已投递产物；Provider 不支持时可省略。 */
  getArtifact?(
    sessionId: string,
    fileId: string,
    options?: { includeContent?: boolean },
  ): Promise<ChatArtifactView>;
}
