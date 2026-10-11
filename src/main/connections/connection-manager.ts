/**
 * ConnectionManager：DesktopHost 的 Connection 域实现。
 * 流程：校验输入 → 验证凭据 → 存入 CredentialStore → 落 connections.json。
 * 凭据写入失败时回滚元数据，不留下没有凭据的 Connection。
 */

import type {
  ConnectionView,
  ConnectInput,
  EnvironmentSetupResult,
  RemoveConnectionOptions,
  UpdateConnectionInput,
} from "@shared/models";
import { hostError } from "@shared/errors";
import type { CredentialStore } from "../credentials/credential-store";
import { SecureStorageUnavailableError } from "../credentials/credential-store";
import type { ConnectionStore } from "./connection-store";
import type { ConnectionVerifier, ResolvedConnection } from "./connection-verifier";

export interface ConnectionManagerOptions {
  connectionStore: ConnectionStore;
  credentialStore: CredentialStore;
  verifiers: Record<string, ConnectionVerifier>;
  countManagedScopes?: (connectionId: string) => Promise<number>;
  removeManagedScopes?: (connectionId: string) => Promise<void>;
  setupEnvironment?: (
    connectionId: string,
    environmentId?: string,
  ) => Promise<EnvironmentSetupResult>;
}

export class ConnectionManager {
  readonly #connectionStore: ConnectionStore;
  readonly #credentialStore: CredentialStore;
  readonly #verifiers: Record<string, ConnectionVerifier>;
  readonly #countManagedScopes: (connectionId: string) => Promise<number>;
  readonly #removeManagedScopes: (connectionId: string) => Promise<void>;
  readonly #setupEnvironment: (
    connectionId: string,
    environmentId?: string,
  ) => Promise<EnvironmentSetupResult>;

  constructor(options: ConnectionManagerOptions) {
    this.#connectionStore = options.connectionStore;
    this.#credentialStore = options.credentialStore;
    this.#verifiers = options.verifiers;
    this.#countManagedScopes = options.countManagedScopes ?? (async () => 0);
    this.#removeManagedScopes = options.removeManagedScopes ?? (async () => undefined);
    this.#setupEnvironment =
      options.setupEnvironment ??
      (async () => {
        throw hostError("unavailable", "environment control plane is not configured");
      });
  }

  async list(): Promise<ConnectionView[]> {
    const connections = await this.#connectionStore.list();
    return Promise.all(
      connections.map(async (c) => ({
        id: c.id,
        provider: c.provider,
        displayName: c.displayName,
        credentialStored: (await this.#credentialStore.get(c.credentialKey)) !== null,
        managedBotDataCount: await this.#countManagedScopes(c.id),
        environmentReady: c.defaultEnvironmentId !== undefined,
        ...(c.workspaceId ? { workspaceId: c.workspaceId } : {}),
      })),
    );
  }

  async connect(input: ConnectInput): Promise<ConnectionView> {
    const displayName = input.displayName.trim();
    if (displayName.length === 0) {
      throw hostError("invalid-input", "displayName must be non-empty");
    }
    if (input.credential.trim().length === 0) {
      throw hostError("invalid-input", "credential must be non-empty");
    }
    const verifier = this.#verifiers[input.provider];
    if (verifier === undefined) {
      throw hostError("invalid-input", `unsupported provider: ${input.provider}`);
    }

    // 先验证：无效凭据不产生任何持久化。
    await verifier.verify(input);

    const stored = await this.#connectionStore.add({
      provider: input.provider,
      displayName,
      ...(input.workspaceId?.trim() ? { workspaceId: input.workspaceId.trim() } : {}),
    });
    try {
      await this.#credentialStore.set(stored.credentialKey, input.credential);
    } catch (error) {
      // 回滚元数据：不留下没有凭据的 Connection。
      // 回滚失败不得掩盖原始错误：记录后仍抛出凭据写入的真实原因。
      try {
        await this.#connectionStore.remove(stored.id);
      } catch (rollbackError) {
        console.error("connection metadata rollback failed", rollbackError);
      }
      throw error instanceof SecureStorageUnavailableError
        ? hostError("unavailable", "secure storage unavailable")
        : error;
    }
    return {
      id: stored.id,
      provider: stored.provider,
      displayName: stored.displayName,
      credentialStored: true,
      managedBotDataCount: 0,
      environmentReady: false,
      ...(stored.workspaceId ? { workspaceId: stored.workspaceId } : {}),
    };
  }

  async reconnect(input: { connectionId: string; credential: string }): Promise<ConnectionView> {
    if (input.credential.trim().length === 0) {
      throw hostError("invalid-input", "credential must be non-empty");
    }
    const connections = await this.#connectionStore.list();
    const target = connections.find((c) => c.id === input.connectionId);
    if (target === undefined) {
      throw hostError("not-found", `connection not found: ${input.connectionId}`);
    }
    const verifier = this.#verifiers[target.provider];
    if (verifier === undefined) {
      throw hostError("invalid-input", `unsupported provider: ${target.provider}`);
    }

    await verifier.verify({
      provider: target.provider,
      displayName: target.displayName,
      credential: input.credential,
      ...(target.workspaceId ? { workspaceId: target.workspaceId } : {}),
    });

    try {
      await this.#credentialStore.set(target.credentialKey, input.credential);
    } catch (error) {
      throw error instanceof SecureStorageUnavailableError
        ? hostError("unavailable", "secure storage unavailable")
        : error;
    }
    return {
      id: target.id,
      provider: target.provider,
      displayName: target.displayName,
      credentialStored: true,
      managedBotDataCount: await this.#countManagedScopes(target.id),
      environmentReady: target.defaultEnvironmentId !== undefined,
      ...(target.workspaceId ? { workspaceId: target.workspaceId } : {}),
    };
  }

  async disconnect(connectionId: string): Promise<void> {
    const connections = await this.#connectionStore.list();
    const target = connections.find((c) => c.id === connectionId);
    if (target === undefined) {
      throw hostError("not-found", `connection not found: ${connectionId}`);
    }
    // 只删除安全存储中的凭据；保留元数据与 managed scope（local-storage.md）。
    await this.#credentialStore.delete(target.credentialKey);
  }

  async update(input: UpdateConnectionInput): Promise<ConnectionView> {
    const displayName = input.displayName.trim();
    if (!displayName) throw hostError("invalid-input", "displayName must be non-empty");
    const target = (await this.#connectionStore.list()).find(
      (item) => item.id === input.connectionId,
    );
    if (!target) throw hostError("not-found", `connection not found: ${input.connectionId}`);
    const workspaceId = input.workspaceId?.trim();
    if (target.provider === "bailian" && !workspaceId)
      throw hostError("invalid-input", "workspaceId is required for bailian");

    const workspaceChanged = workspaceId !== target.workspaceId;
    if (workspaceChanged && !input.credential?.trim()) {
      throw hostError("invalid-input", "credential is required when workspaceId changes");
    }

    // workspaceId 变化 = 新凭据 + 新 workspaceId + 清除环境绑定，原子完成。
    // 顺序：验证新凭据 → 保存新凭据 → 单次 store.update 携带 workspaceId + clearDefaultEnvironmentId。
    // store 失败时回滚 CredentialStore 到旧凭据，不留部分状态。
    if (workspaceChanged) {
      const credential = input.credential!;
      await this.#verifiers[target.provider]!.verify({
        provider: target.provider,
        displayName,
        credential,
        ...(workspaceId ? { workspaceId } : {}),
      });

      const previousCredential = await this.#credentialStore.get(target.credentialKey);
      await this.#credentialStore.set(target.credentialKey, credential);

      try {
        const updated = await this.#connectionStore.update(target.id, {
          displayName,
          ...(workspaceId ? { workspaceId } : {}),
          clearDefaultEnvironmentId: true,
        });
        if (!updated) throw hostError("not-found", `connection not found: ${input.connectionId}`);
        return {
          id: updated.id,
          provider: updated.provider,
          displayName: updated.displayName,
          credentialStored: true,
          managedBotDataCount: await this.#countManagedScopes(updated.id),
          environmentReady: false,
          ...(updated.workspaceId ? { workspaceId: updated.workspaceId } : {}),
        };
      } catch (storeError) {
        // 回滚凭据到更新前状态；回滚失败记录但不掩盖原始错误。
        if (previousCredential === null) {
          await this.#credentialStore.delete(target.credentialKey).catch((rollbackError) => {
            void rollbackError;
            console.error("connection credential rollback failed");
          });
        } else {
          await this.#credentialStore
            .set(target.credentialKey, previousCredential)
            .catch((rollbackError) => {
              void rollbackError;
              console.error("connection credential rollback failed");
            });
        }
        throw storeError;
      }
    }

    const updated = await this.#connectionStore.update(target.id, {
      displayName,
      ...(workspaceId ? { workspaceId } : {}),
    });
    if (!updated) throw hostError("not-found", `connection not found: ${input.connectionId}`);
    return {
      id: updated.id,
      provider: updated.provider,
      displayName: updated.displayName,
      credentialStored: (await this.#credentialStore.get(updated.credentialKey)) !== null,
      managedBotDataCount: await this.#countManagedScopes(updated.id),
      environmentReady: updated.defaultEnvironmentId !== undefined,
      ...(updated.workspaceId ? { workspaceId: updated.workspaceId } : {}),
    };
  }

  async verify(connectionId: string): Promise<void> {
    const resolved = await this.resolveCredential(connectionId);
    const target = (await this.#connectionStore.list()).find((item) => item.id === connectionId)!;
    await this.#verifiers[target.provider]!.verify({
      provider: target.provider,
      displayName: target.displayName,
      credential: resolved.credential,
      ...(target.workspaceId ? { workspaceId: target.workspaceId } : {}),
    });
  }

  async remove(connectionId: string, options: RemoveConnectionOptions): Promise<void> {
    const target = (await this.#connectionStore.list()).find((item) => item.id === connectionId);
    if (!target) throw hostError("not-found", `connection not found: ${connectionId}`);
    const managedBotDataCount = await this.#countManagedScopes(connectionId);
    if (managedBotDataCount > 0 && !options.removeManagedBotData)
      throw hostError("conflict", "connection has managed bot data; explicit removal required");
    if (managedBotDataCount > 0) await this.#removeManagedScopes(connectionId);
    await this.#credentialStore.delete(target.credentialKey);
    await this.#connectionStore.remove(connectionId);
  }

  /**
   * 为 Connection 设置运行环境。
   * 成功时写入 defaultEnvironmentId 并返回 ready；多候选时返回 selection-required，不产生本地写入。
   */
  async setupEnvironment(
    connectionId: string,
    environmentId?: string,
  ): Promise<EnvironmentSetupResult> {
    await this.resolveCredential(connectionId);
    const result = await this.#setupEnvironment(connectionId, environmentId);
    if (result.status === "ready") {
      await this.#connectionStore.setDefaultEnvironmentId(connectionId, result.environmentId);
    }
    return result;
  }

  /**
   * 返回 Connection 当前绑定的默认运行环境 ID；未设置时返回 null。
   * BotControlPlane/ChatDataPlane 用它解析环境。
   */
  async getDefaultEnvironmentId(connectionId: string): Promise<string | null> {
    const target = (await this.#connectionStore.list()).find((item) => item.id === connectionId);
    if (!target) throw hostError("not-found", `connection not found: ${connectionId}`);
    return target.defaultEnvironmentId ?? null;
  }

  /**
   * 为一次控制面/数据面调用解析凭据。
   * 凭据不存在或不可读时抛 not-connected；返回值只在本调用闭包内使用。
   */
  async resolveCredential(connectionId: string): Promise<ResolvedConnection> {
    const connections = await this.#connectionStore.list();
    const target = connections.find((c) => c.id === connectionId);
    if (target === undefined) {
      throw hostError("not-found", `connection not found: ${connectionId}`);
    }
    const credential = await this.#credentialStore.get(target.credentialKey);
    if (credential === null) {
      throw hostError("not-connected", `connection not connected: ${connectionId}`);
    }
    return {
      provider: target.provider,
      credential,
      ...(target.workspaceId ? { workspaceId: target.workspaceId } : {}),
    };
  }
}
