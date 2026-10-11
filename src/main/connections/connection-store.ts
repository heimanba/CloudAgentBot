/**
 * ConnectionStore：connections.json 的读写。
 * 只保存非敏感元数据（id/provider/displayName/credentialKey）；
 * 原始凭据只由 CredentialStore 持有。原子写 + Schema 校验。
 */

import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { writeFileAtomic } from "../atomic-file";

export interface StoredConnection {
  id: string;
  provider: string;
  displayName: string;
  credentialKey: string;
  workspaceId?: string;
  /**
   * 该 Connection 的默认运行环境 ID；仅由 setupEnvironment 写入。
   * 缺失表示环境未设置，Renderer 看到 environmentReady=false。
   */
  defaultEnvironmentId?: string;
}

interface ConnectionsFile {
  version: 1;
  connections: StoredConnection[];
}

function isStoredConnection(value: unknown): value is StoredConnection {
  const v = value as StoredConnection;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.id === "string" &&
    typeof v.provider === "string" &&
    typeof v.displayName === "string" &&
    typeof v.credentialKey === "string" &&
    (v.workspaceId === undefined || typeof v.workspaceId === "string") &&
    (v.defaultEnvironmentId === undefined || typeof v.defaultEnvironmentId === "string")
  );
}

function parseConnectionsFile(raw: string): ConnectionsFile {
  const parsed = JSON.parse(raw) as ConnectionsFile;
  if (parsed.version !== 1 || !Array.isArray(parsed.connections)) {
    throw new Error("connections file corrupt");
  }
  for (const c of parsed.connections) {
    if (!isStoredConnection(c)) throw new Error("connections file corrupt");
  }
  return parsed;
}

export class ConnectionStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async list(): Promise<StoredConnection[]> {
    let raw: string;
    try {
      raw = await readFile(this.#filePath, "utf8");
    } catch {
      return [];
    }
    return parseConnectionsFile(raw).connections;
  }

  async add(input: {
    provider: string;
    displayName: string;
    workspaceId?: string;
  }): Promise<StoredConnection> {
    const connections = await this.list();
    const stored: StoredConnection = {
      id: `conn_${randomBytes(8).toString("hex")}`,
      provider: input.provider,
      displayName: input.displayName,
      credentialKey: `cred_${randomBytes(8).toString("hex")}`,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    };
    connections.push(stored);
    await this.#write(connections);
    return stored;
  }

  async remove(id: string): Promise<void> {
    const connections = await this.list();
    const next = connections.filter((c) => c.id !== id);
    if (next.length === connections.length) return;
    await this.#write(next);
  }

  async update(
    id: string,
    input: { displayName: string; workspaceId?: string; clearDefaultEnvironmentId?: boolean },
  ): Promise<StoredConnection | null> {
    const connections = await this.list();
    const index = connections.findIndex((connection) => connection.id === id);
    if (index < 0) return null;
    const updated: StoredConnection = { ...connections[index]!, displayName: input.displayName };
    if (input.workspaceId) updated.workspaceId = input.workspaceId;
    else delete updated.workspaceId;
    if (input.clearDefaultEnvironmentId) delete updated.defaultEnvironmentId;
    connections[index] = updated;
    await this.#write(connections);
    return updated;
  }

  /**
   * 设置或清除默认运行环境 ID。environmentId 为 null 时清除。
   * 该操作与 workspaceId/displayName 更新分离，避免部分状态写入。
   */
  async setDefaultEnvironmentId(
    id: string,
    environmentId: string | null,
  ): Promise<StoredConnection | null> {
    const connections = await this.list();
    const index = connections.findIndex((connection) => connection.id === id);
    if (index < 0) return null;
    const updated: StoredConnection = { ...connections[index]! };
    if (environmentId === null) delete updated.defaultEnvironmentId;
    else updated.defaultEnvironmentId = environmentId;
    connections[index] = updated;
    await this.#write(connections);
    return updated;
  }

  async #write(connections: StoredConnection[]): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true });
    const file: ConnectionsFile = { version: 1, connections };
    await writeFileAtomic(this.#filePath, JSON.stringify(file, null, 2));
  }
}
