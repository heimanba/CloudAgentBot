/**
 * ManagedBotStore：Managed Bot 本地 IaC 资料的读写与完整性判断。
 *
 * 职责：
 * - scope 目录布局（manifest.json / agents.yaml / agents.state.json / backup/）
 * - manifest 与 Project Document（agents.yaml）的原子写
 * - 配对备份（成功 Sync 后把当时的 agents.yaml 与 agents.state.json 一起复制）
 * - 完整性矩阵分类（决定首创建、Chat、update/Sync 是否允许）
 * - 目录扫描作为 Managed Bot 索引（首版无全局 managed-agent 表）
 *
 * 边界：
 * - agents.state.json 由 OpenAgentPack LocalFileStateBackend 独占写入；
 *   本 Store 只判断其是否存在、可解析，绝不解析或修改其内部字段。
 * - scope 是随机稳定 ID，不从可修改的 Bot 名称生成。
 */

import { copyFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { hostError } from "../../shared/errors";
import { writeFileAtomic } from "../atomic-file";
import { createManagedStateBackend } from "./state-backend";

/** manifest.json 的内容。不复制远程 Agent ID。 */
export interface ManagedBotManifest {
  version: 1;
  scope: string;
  connectionId: string;
  provider: string;
  projectName: string;
  phase: "new" | "applying" | "managed";
}

/**
 * 完整性分类（对应 local-storage.md 的完整性矩阵）。每行一个本地文件组合状态。
 */
export type ScopeIntegrity =
  | "new" // phase=new + project，无 state：允许一次首次创建
  | "interrupted-resumable" // phase=applying + project + state：创建中断但 state 已落地
  | "interrupted-unknown" // phase=applying + project，无 state：创建结果不明，停止重试
  | "managed" // phase=managed + project + state
  | "state-missing" // phase=managed + project，无 state
  | "project-missing" // manifest + state，无 project
  | "interrupted-scope" // project + state，无 manifest：中断 scope，只读
  | "invalid"; // 其他不一致组合

const MANIFEST_FILE = "manifest.json";
const PROJECT_FILE = "agents.yaml";
const STATE_FILE = "agents.state.json";
const BACKUP_DIR = "backup";

/**
 * 完整性矩阵中被生产行为消费的动作门禁。
 * `stateMissing` 是 assertWritable 的真实 fail-closed：任何 Provider mutation 前
 * state 缺失/损坏（interrupted-unknown / state-missing）抛 managed-state-missing。
 * 矩阵其余允许行为（首次创建门禁、Chat、写权限）由 BotControlPlane 的 phase/流程
 * 编排直接表达，不经由本对象；不为仅文档语义保留未消费字段。
 */
export interface IntegrityGate {
  /** state 缺失导致的 fail-closed（抛 managed-state-missing）。 */
  stateMissing: boolean;
}

/** 把完整性分类映射为被消费的动作门禁。 */
export function gateFor(integrity: ScopeIntegrity): IntegrityGate {
  switch (integrity) {
    case "interrupted-unknown":
    case "state-missing":
      return { stateMissing: true };
    case "new":
    case "interrupted-resumable":
    case "managed":
    case "project-missing":
    case "interrupted-scope":
    case "invalid":
      return { stateMissing: false };
  }
}

function isManifest(value: unknown): value is ManagedBotManifest {
  const v = value as ManagedBotManifest;
  return (
    typeof v === "object" &&
    v !== null &&
    v.version === 1 &&
    typeof v.scope === "string" &&
    typeof v.connectionId === "string" &&
    typeof v.provider === "string" &&
    typeof v.projectName === "string" &&
    (v.phase === "new" || v.phase === "applying" || v.phase === "managed")
  );
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function parseJsonCorrupt(raw: string): boolean {
  try {
    JSON.parse(raw);
    return false;
  } catch {
    return true;
  }
}

/** 单个 scope 的快照：manifest（可能缺失/损坏）、文件存在性与完整性分类。 */
export interface ManagedScopeSnapshot {
  scope: string;
  dir: string;
  manifest: ManagedBotManifest | null;
  /** manifest 文件存在但损坏或形状不符。 */
  manifestCorrupt: boolean;
  hasProject: boolean;
  hasState: boolean;
  /** state 文件存在但损坏。 */
  stateCorrupt: boolean;
  integrity: ScopeIntegrity;
  gate: IntegrityGate;
}

export class ManagedBotStore {
  readonly #root: string;

  /** @param root userData 下 managed-bots/ 目录。 */
  constructor(root: string) {
    this.#root = root;
  }

  scopeDir(connectionId: string, scope: string): string {
    return join(this.#root, connectionId, scope);
  }

  /**
   * 创建一个新 scope：随机稳定 ID + phase=new 的 manifest + 初始 agents.yaml。
   * 先写 Project Document 再写 manifest，保证“有 manifest 即有 project”的创建路径。
   */
  async createScope(input: {
    connectionId: string;
    provider: string;
    projectName: string;
    projectYaml: string;
  }): Promise<ManagedBotManifest> {
    const scope = `scope_${randomBytes(8).toString("hex")}`;
    const dir = this.scopeDir(input.connectionId, scope);
    await mkdir(dir, { recursive: true });
    const manifest: ManagedBotManifest = {
      version: 1,
      scope,
      connectionId: input.connectionId,
      provider: input.provider,
      projectName: input.projectName,
      phase: "new",
    };
    await this.writeProject(dir, input.projectYaml);
    await this.writeManifest(dir, manifest);
    return manifest;
  }

  /** 原子写 manifest。 */
  async writeManifest(dir: string, manifest: ManagedBotManifest): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFileAtomic(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
  }

  /** 原子写 Project Document（agents.yaml）。 */
  async writeProject(dir: string, projectYaml: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFileAtomic(join(dir, PROJECT_FILE), projectYaml);
  }

  /** 读取 Project Document 原文；缺失返回 null。 */
  async readProject(dir: string): Promise<string | null> {
    return readIfExists(join(dir, PROJECT_FILE));
  }

  /**
   * 派生 hasPendingChanges：当前 Project Document 与最后一次成功 Sync 的配对
   * backup 文本不同即为 true。比较完整文本，不引入 hash/revision/缓存。
   * backup 缺失返回 null（无法派生），由调用方依据完整性规则拒绝，不猜测。
   */
  async hasPendingProject(dir: string, currentProject: string): Promise<boolean | null> {
    const backup = await readIfExists(join(dir, BACKUP_DIR, PROJECT_FILE));
    if (backup === null) return null;
    return backup !== currentProject;
  }

  /**
   * 原子改 phase。首次创建调用 Provider 前必须先 new -> applying。
   */
  async transitionPhase(
    dir: string,
    manifest: ManagedBotManifest,
    phase: ManagedBotManifest["phase"],
  ): Promise<ManagedBotManifest> {
    const next: ManagedBotManifest = { ...manifest, phase };
    await this.writeManifest(dir, next);
    return next;
  }

  /**
   * 成功 Sync 后，把当时的 agents.yaml 与 agents.state.json 复制为同一份配对备份。
   * 由调用方在 Sync 成功、state 已由 LocalFileStateBackend 写入后调用；两者成对复制。
   */
  async writePairBackup(dir: string): Promise<void> {
    const backupDir = join(dir, BACKUP_DIR);
    await mkdir(backupDir, { recursive: true });
    await copyFile(join(dir, PROJECT_FILE), join(backupDir, PROJECT_FILE));
    await copyFile(join(dir, STATE_FILE), join(backupDir, STATE_FILE));
  }

  /**
   * 读取一个 scope 的快照并按完整性矩阵分类。
   * 损坏的 manifest 视为缺失（manifestCorrupt 标记）；损坏的 state 视为缺失（stateCorrupt 标记）。
   */
  async inspect(connectionId: string, scope: string): Promise<ManagedScopeSnapshot> {
    const dir = this.scopeDir(connectionId, scope);
    const manifestRaw = await readIfExists(join(dir, MANIFEST_FILE));
    const projectRaw = await readIfExists(join(dir, PROJECT_FILE));
    const stateRaw = await readIfExists(join(dir, STATE_FILE));

    let manifest: ManagedBotManifest | null = null;
    let manifestCorrupt = false;
    if (manifestRaw !== null) {
      try {
        const parsed: unknown = JSON.parse(manifestRaw);
        if (isManifest(parsed)) manifest = parsed;
        else manifestCorrupt = true;
      } catch {
        manifestCorrupt = true;
      }
    }

    const hasProject = projectRaw !== null;
    const hasState = stateRaw !== null;
    const stateCorrupt = stateRaw !== null && parseJsonCorrupt(stateRaw);
    const usableState = hasState && !stateCorrupt;

    const integrity = classifyIntegrity({ manifest, hasProject, hasState: usableState });
    return {
      scope,
      dir,
      manifest,
      manifestCorrupt,
      hasProject,
      hasState: usableState,
      stateCorrupt,
      integrity,
      gate: gateFor(integrity),
    };
  }

  /**
   * 目录扫描列举某 Connection 下的全部 scope。目录扫描即索引（无全局表）。
   * 只返回具备合法 manifest 的 scope；损坏/不完整 scope 由 inspect 单独判断。
   */
  async listScopes(connectionId: string): Promise<ManagedScopeSnapshot[]> {
    const connDir = join(this.#root, connectionId);
    let entries: string[];
    try {
      entries = await readdir(connDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const snapshots: ManagedScopeSnapshot[] = [];
    for (const entry of entries) {
      if (!entry.startsWith("scope_")) continue;
      snapshots.push(await this.inspect(connectionId, entry));
    }
    return snapshots;
  }

  /**
   * 永久删除一个 Connection 下的全部本地 IaC 管理资料。
   * 这里只触及 managed-bots/<connectionId>，不调用 Provider、不删除远程资源。
   */
  async removeConnectionData(connectionId: string): Promise<void> {
    await rm(join(this.#root, connectionId), { recursive: true, force: true });
  }

  /**
   * 供 BotControlPlane 在写路径前调用的 fail-closed 检查。
   * 除 phase=new 的首次创建外，state 缺失时报 managed-state-missing。
   */
  async assertWritable(connectionId: string, scope: string): Promise<ManagedScopeSnapshot> {
    const snapshot = await this.inspect(connectionId, scope);
    if (snapshot.gate.stateMissing) {
      throw hostError(
        "managed-state-missing",
        `managed scope ${scope} is missing or has corrupt state; refusing remote mutation`,
      );
    }
    return snapshot;
  }

  /**
   * 按远程 agentId 反查本 Connection 下管理它的 scope。
   * 经 SDK 公共只读入口读各 scope 的 state，找 address.type=agent 且 remote_id 匹配者；
   * 不解析 state 文件原文（LocalFileStateBackend 独占其内容）。无匹配返回 null。
   * state 损坏时该 scope 视为无关联（完整性矩阵另行分类），不向上抛错。
   */
  async findScopeByAgentId(
    connectionId: string,
    agentId: string,
  ): Promise<ManagedScopeSnapshot | null> {
    const snapshots = await this.listScopes(connectionId);
    for (const snapshot of snapshots) {
      if (!snapshot.hasState || snapshot.manifest === null) continue;
      const ids = await this.#readStateAgentIds(
        snapshot.dir,
        "agents.state.json",
        snapshot.manifest,
      );
      if (ids.includes(agentId)) return snapshot;
    }
    return null;
  }

  /**
   * 通过配对备份（backup/agents.state.json）只读反查 agentId 的历史关联 scope。
   *
   * 仅当当前 state 不可用（缺失/损坏）时由 BotControlPlane 调用：定位 scope 后
   * 仍须经 assertWritable 的当前完整性检查，在任何 Provider mutation 前 fail-closed
   * 返回 managed-state-missing。backup 绝不恢复、复制或作为 apply 输入；
   * 缺失/损坏返回 null（不猜测归属）。
   */
  async findScopeByBackupAgentId(
    connectionId: string,
    agentId: string,
  ): Promise<ManagedScopeSnapshot | null> {
    const snapshots = await this.listScopes(connectionId);
    for (const snapshot of snapshots) {
      if (snapshot.manifest === null) continue;
      // 当前 state 仍可用时无需走 backup；正常路径由 findScopeByAgentId 负责。
      if (snapshot.hasState) continue;
      const ids = await this.#readStateAgentIds(
        snapshot.dir,
        "backup/agents.state.json",
        snapshot.manifest,
      );
      if (ids.includes(agentId)) return snapshot;
    }
    return null;
  }

  /**
   * 列出本 Connection 下"当前 state 不可用、但配对备份存有 agentId"的 scope 关联。
   * 供 Bot 列表内存 join：把远程 Agent 标为 state-missing（诊断可见，Update/Sync 关闭）。
   * backup 缺失/损坏时跳过，不猜测归属。
   */
  async listBackupManagedAgents(
    connectionId: string,
  ): Promise<Array<{ agentId: string; integrity: ScopeIntegrity }>> {
    const snapshots = await this.listScopes(connectionId);
    const result: Array<{ agentId: string; integrity: ScopeIntegrity }> = [];
    for (const snapshot of snapshots) {
      if (snapshot.manifest === null) continue;
      if (snapshot.hasState) continue;
      const agentIds = await this.#readStateAgentIds(
        snapshot.dir,
        "backup/agents.state.json",
        snapshot.manifest,
      );
      for (const agentId of agentIds) {
        result.push({ agentId, integrity: snapshot.integrity });
      }
    }
    return result;
  }

  /**
   * 经公共只读入口列出指定 state 文件中的全部 agentId；缺失/损坏返回空数组。
   * 只读 backup 用于 state-missing 诊断，绝不进入 apply 输入。
   */
  async #readStateAgentIds(
    dir: string,
    file: "agents.state.json" | "backup/agents.state.json",
    manifest: ManagedBotManifest,
  ): Promise<string[]> {
    if ((await readIfExists(join(dir, file))) === null) return [];
    const backend = createManagedStateBackend(dir, file);
    try {
      return await backend.read({ projectId: manifest.projectName }, (state) =>
        state
          .listResources()
          .filter((r) => r.address.type === "agent" && r.remote_id !== null)
          .map((r) => r.remote_id as string),
      );
    } catch {
      // state 文件损坏：LocalFileStateBackend.load 抛错。视为无关联，由完整性矩阵分类。
      return [];
    }
  }

  /**
   * 列出本 Connection 下全部 scope 管理的远程 agentId 及其完整性。
   * 供 Bot 列表内存 join：远程 Agent 命中 managed 且完整性为 managed 时标 managed；
   * state 缺失/损坏（state-missing / interrupted-unknown）时标 state-missing。
   */
  async listManagedAgents(
    connectionId: string,
  ): Promise<Array<{ agentId: string; integrity: ScopeIntegrity }>> {
    const snapshots = await this.listScopes(connectionId);
    const result: Array<{ agentId: string; integrity: ScopeIntegrity }> = [];
    for (const snapshot of snapshots) {
      if (snapshot.manifest === null) continue;
      if (!snapshot.hasState) {
        // 有 manifest 但无可用 state：interrupted-unknown / state-missing 等。
        // new 阶段尚无远程 Agent，不产生 join 项。
        if (snapshot.manifest.phase !== "new") {
          // 无 state 时无从得知 agentId；由完整性本身决定是否 fail-closed，
          // 列表无法按 agentId 标记，跳过。
        }
        continue;
      }
      const backend = createManagedStateBackend(snapshot.dir);
      const stateScope = { projectId: snapshot.manifest.projectName };
      const agentIds = await backend.read(stateScope, (state) =>
        state
          .listResources()
          .filter((r) => r.address.type === "agent" && r.remote_id !== null)
          .map((r) => r.remote_id as string),
      );
      for (const agentId of agentIds) {
        result.push({ agentId, integrity: snapshot.integrity });
      }
    }
    return result;
  }

  /**
   * 从本机完整 managed state 读取 Agent 配对的 Environment remote ID。
   * state 是该关系的唯一可靠来源；Agent API 本身不返回 environment_id。
   * remote-only、state 缺失/损坏或资源形状不唯一时返回 null，由调用方要求用户选择。
   */
  async findManagedEnvironmentId(connectionId: string, agentId: string): Promise<string | null> {
    const snapshot = await this.findScopeByAgentId(connectionId, agentId);
    if (
      snapshot === null ||
      snapshot.manifest === null ||
      (snapshot.integrity !== "managed" && snapshot.integrity !== "interrupted-resumable")
    ) {
      return null;
    }
    const backend = createManagedStateBackend(snapshot.dir);
    try {
      const environmentIds = await backend.read(
        { projectId: snapshot.manifest.projectName },
        (state) =>
          state
            .listResources()
            .filter((resource) => resource.address.type === "environment" && resource.remote_id)
            .map((resource) => resource.remote_id as string),
      );
      return environmentIds.length === 1 ? environmentIds[0]! : null;
    } catch {
      // inspect 与 read 之间 state 仍可能被外部损坏；降级为显式环境选择，不猜测。
      return null;
    }
  }
}

function classifyIntegrity(input: {
  manifest: ManagedBotManifest | null;
  hasProject: boolean;
  hasState: boolean;
}): ScopeIntegrity {
  const { manifest, hasProject, hasState } = input;

  // project + state，无 manifest：中断 scope，只读。
  if (manifest === null) {
    return hasProject && hasState ? "interrupted-scope" : "invalid";
  }
  // manifest + state，无 project：project-missing。
  if (!hasProject && hasState) return "project-missing";
  // 无 project 且无 state：不完整。
  if (!hasProject) return "invalid";

  // 有 project。按 phase 与 state 分类。
  switch (manifest.phase) {
    case "new":
      return hasState ? "invalid" : "new";
    case "applying":
      return hasState ? "interrupted-resumable" : "interrupted-unknown";
    case "managed":
      return hasState ? "managed" : "state-missing";
  }
}
