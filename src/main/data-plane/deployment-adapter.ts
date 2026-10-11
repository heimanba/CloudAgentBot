/**
 * DeploymentAdapter：Provider 定时任务数据面 seam。
 * 与 ChatAdapter 平级；wire 类型不越过本 Interface。
 * 合同证据见 docs/research/bailian-deployment-api-contract-2026-10-08.md。
 *
 * metadata 语义（归属、共享、到期）由 ChatDataPlane 负责组装；
 * Adapter 只透传 Provider metadata，不解释 CloudAgentBot 标记。
 */

import type { DeploymentRunView } from "@shared/models";

export interface AdapterDeploymentView {
  agentId: string;
  deploymentId: string;
  name: string;
  description?: string;
  status: "active" | "paused" | "archived";
  prompt: string;
  schedule?: { expression: string; timezone: string; nextRunAt?: string; lastRunAt?: string };
  expiresAt?: string;
  shared: boolean;
  /** Main-only Provider metadata projection；ChatDataPlane 剥离后产生 keyScope。 */
  keyScopeMarker?: string;
  /**
   * Provider metadata 全量字符串键值（Main-only）。百炼 metadata 更新是整体替换，
   * ChatDataPlane 做 read-merge-write 需要完整旧值；不越过 preload。
   */
  metadata: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdapterCreateDeploymentInput {
  agentId: string;
  environmentId: string;
  name: string;
  prompt: string;
  description?: string;
  schedule?: { expression: string; timezone: string };
  /** Data plane 已并入归属/共享/到期标记的完整 metadata。 */
  metadata: Record<string, string>;
}

export interface AdapterUpdateDeploymentInput {
  name?: string;
  prompt?: string;
  description?: string;
  /** 传 null 清除定时触发。 */
  schedule?: { expression: string; timezone: string } | null;
  /** 整体替换（百炼合同）；调用方必须先读后并。 */
  metadata?: Record<string, string>;
}

export interface DeploymentAdapter {
  /** agentId 缺省时列出当前凭据可见的全部 Deployment（供运行监视轮询）。 */
  listDeployments(agentId?: string): Promise<AdapterDeploymentView[]>;
  getDeployment(deploymentId: string): Promise<AdapterDeploymentView>;
  createDeployment(input: AdapterCreateDeploymentInput): Promise<AdapterDeploymentView>;
  updateDeployment(
    deploymentId: string,
    input: AdapterUpdateDeploymentInput,
  ): Promise<AdapterDeploymentView>;
  pauseDeployment(deploymentId: string): Promise<AdapterDeploymentView>;
  unpauseDeployment(deploymentId: string): Promise<AdapterDeploymentView>;
  /** 归档是唯一终态，幂等；归档后触发返回 409。 */
  archiveDeployment(deploymentId: string): Promise<void>;
  runDeployment(deploymentId: string): Promise<DeploymentRunView>;
  listDeploymentRuns(deploymentId: string): Promise<DeploymentRunView[]>;
}
