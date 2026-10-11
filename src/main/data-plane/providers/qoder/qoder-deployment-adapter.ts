/**
 * Qoder Deployment（定时任务）Adapter。
 * wire → Provider-neutral view 的映射只发生在这里；metadata 标记透传不解释。
 * 合同见 docs/research/qoder-deployment-api-contract-2026-10-08.md（文档分析，
 * 未经真实环境探测；映射对字段名做防御性兼容，探测后应收敛）。
 *
 * 与百炼的差异：agent 引用为字符串（最新版本）；environment_id 创建必填；
 * initial_events 事件类型是 user.message；schedule 回读 upcoming_runs_at；
 * Run 的触发来源字段是 trigger_context.type。
 */

import type { DeploymentRunView } from "@shared/models";
import type { ResolvedConnection } from "../../../connections/connection-verifier";
import {
  API_KEY_SCOPE_METADATA_KEY,
  DEPLOYMENT_EXPIRES_AT_METADATA_KEY,
  SESSION_SHARED_METADATA_KEY,
} from "../../../api-key-scope";
import type {
  AdapterCreateDeploymentInput,
  AdapterDeploymentView,
  AdapterUpdateDeploymentInput,
  DeploymentAdapter,
} from "../../deployment-adapter";
import { QoderDataClient } from "./qoder-client";
import { toQoderHostError } from "./qoder-errors";

type Wire = Record<string, unknown>;

function asRecord(value: unknown): Wire {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Wire) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** agent 引用在响应中可能是字符串（id）或 {id, type, version} 对象。 */
function readAgentId(raw: unknown): string {
  if (typeof raw === "string") return raw;
  return asString(asRecord(raw).id) ?? "";
}

/** initial_events 的首条 user.message 文本是 CloudAgentBot 写入的固定 prompt。 */
function readPrompt(initialEvents: unknown): string {
  if (!Array.isArray(initialEvents)) return "";
  for (const event of initialEvents) {
    const record = asRecord(event);
    if (record.type !== "user.message" && record.type !== "message") continue;
    const content = record.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const text = asString(asRecord(block).text);
      if (text !== undefined) return text;
    }
  }
  return "";
}

export function toQoderDeploymentView(raw: Wire): AdapterDeploymentView {
  const metadata = asRecord(raw.metadata);
  const metadataStrings: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string") metadataStrings[key] = value;
  }
  const schedule = raw.schedule === null ? undefined : asRecord(raw.schedule);
  const keyScopeMarker = asString(metadata[API_KEY_SCOPE_METADATA_KEY]);
  const expiresAt = asString(metadata[DEPLOYMENT_EXPIRES_AT_METADATA_KEY]);
  const view: AdapterDeploymentView = {
    agentId: readAgentId(raw.agent),
    deploymentId: asString(raw.id) ?? "",
    name: asString(raw.name) ?? "",
    status:
      (typeof raw.archived_at === "string" && raw.archived_at) || raw.status === "archived"
        ? "archived"
        : raw.status === "paused"
          ? "paused"
          : "active",
    prompt: readPrompt(raw.initial_events),
    shared: metadata[SESSION_SHARED_METADATA_KEY] === "true",
    metadata: metadataStrings,
  };
  const description = asString(raw.description);
  if (description !== undefined) view.description = description;
  if (schedule !== undefined) {
    const expression = asString(schedule.expression);
    const timezone = asString(schedule.timezone);
    if (expression !== undefined && timezone !== undefined) {
      const upcoming = Array.isArray(schedule.upcoming_runs_at)
        ? asString(schedule.upcoming_runs_at[0])
        : undefined;
      view.schedule = {
        expression,
        timezone,
        ...(asString(schedule.next_run_at) ?? upcoming
          ? { nextRunAt: asString(schedule.next_run_at) ?? upcoming }
          : {}),
        ...(asString(schedule.last_run_at) ? { lastRunAt: asString(schedule.last_run_at) } : {}),
      };
    }
  }
  if (expiresAt !== undefined) view.expiresAt = expiresAt;
  if (keyScopeMarker !== undefined) view.keyScopeMarker = keyScopeMarker;
  const createdAt = asString(raw.created_at);
  const updatedAt = asString(raw.updated_at);
  if (createdAt !== undefined) view.createdAt = createdAt;
  if (updatedAt !== undefined) view.updatedAt = updatedAt;
  return view;
}

export function toQoderDeploymentRunView(raw: Wire): DeploymentRunView {
  const run: DeploymentRunView = {
    id: asString(raw.id) ?? "",
    deploymentId: asString(raw.deployment_id) ?? "",
    trigger: asRecord(raw.trigger_context).type === "schedule" ? "schedule" : "manual",
    status:
      raw.status === "succeeded"
        ? "succeeded"
        : raw.status === "failed" || raw.status === "error"
          ? "failed"
          : "running",
  };
  const sessionId = asString(raw.session_id);
  if (sessionId !== undefined) run.sessionId = sessionId;
  const errorMessage =
    asString(raw.error) ?? asString(asRecord(raw.error).message);
  if (errorMessage !== undefined) run.errorMessage = errorMessage;
  const startedAt = asString(raw.started_at) ?? asString(raw.created_at);
  const finishedAt = asString(raw.finished_at) ?? asString(raw.completed_at);
  if (startedAt !== undefined) run.startedAt = startedAt;
  if (finishedAt !== undefined) run.finishedAt = finishedAt;
  return run;
}

export function createQoderDeploymentAdapter(connection: ResolvedConnection): DeploymentAdapter {
  const client = new QoderDataClient({ apiKey: connection.credential });

  return {
    async listDeployments(agentId?: string): Promise<AdapterDeploymentView[]> {
      try {
        return (await client.listDeployments(agentId)).map(toQoderDeploymentView);
      } catch (error) {
        throw toQoderHostError(error, "qoder list deployments");
      }
    },

    async getDeployment(deploymentId: string): Promise<AdapterDeploymentView> {
      try {
        return toQoderDeploymentView(await client.getDeployment(deploymentId));
      } catch (error) {
        throw toQoderHostError(error, "qoder get deployment");
      }
    },

    async createDeployment(
      input: AdapterCreateDeploymentInput,
    ): Promise<AdapterDeploymentView> {
      try {
        const body: Wire = {
          name: input.name,
          agent: input.agentId,
          // Qoder 合同：environment_id 创建必填（ChatDataPlane 保证解析出非空值）。
          environment_id: input.environmentId,
          initial_events: [
            { type: "user.message", content: [{ type: "text", text: input.prompt }] },
          ],
          metadata: input.metadata,
        };
        if (input.description !== undefined) body.description = input.description;
        if (input.schedule !== undefined) {
          body.schedule = {
            type: "cron",
            expression: input.schedule.expression,
            timezone: input.schedule.timezone,
          };
        }
        return toQoderDeploymentView(await client.createDeployment(body));
      } catch (error) {
        throw toQoderHostError(error, "qoder create deployment");
      }
    },

    async updateDeployment(
      deploymentId: string,
      input: AdapterUpdateDeploymentInput,
    ): Promise<AdapterDeploymentView> {
      try {
        // Qoder 更新是 merge-patch：未传字段不变；metadata 由 ChatDataPlane 先读后并，
        // 这里传全量在两种语义下都安全。
        const body: Wire = {};
        if (input.name !== undefined) body.name = input.name;
        if (input.description !== undefined) body.description = input.description;
        if (input.schedule !== undefined) {
          body.schedule =
            input.schedule === null
              ? null
              : {
                  type: "cron",
                  expression: input.schedule.expression,
                  timezone: input.schedule.timezone,
                };
        }
        if (input.prompt !== undefined) {
          body.initial_events = [
            { type: "user.message", content: [{ type: "text", text: input.prompt }] },
          ];
        }
        if (input.metadata !== undefined) body.metadata = input.metadata;
        return toQoderDeploymentView(await client.updateDeployment(deploymentId, body));
      } catch (error) {
        throw toQoderHostError(error, "qoder update deployment");
      }
    },

    async pauseDeployment(deploymentId: string): Promise<AdapterDeploymentView> {
      try {
        return toQoderDeploymentView(await client.pauseDeployment(deploymentId));
      } catch (error) {
        throw toQoderHostError(error, "qoder pause deployment");
      }
    },

    async unpauseDeployment(deploymentId: string): Promise<AdapterDeploymentView> {
      try {
        return toQoderDeploymentView(await client.unpauseDeployment(deploymentId));
      } catch (error) {
        throw toQoderHostError(error, "qoder unpause deployment");
      }
    },

    async archiveDeployment(deploymentId: string): Promise<void> {
      try {
        await client.archiveDeployment(deploymentId);
      } catch (error) {
        throw toQoderHostError(error, "qoder archive deployment");
      }
    },

    async runDeployment(deploymentId: string): Promise<DeploymentRunView> {
      try {
        return toQoderDeploymentRunView(await client.runDeployment(deploymentId));
      } catch (error) {
        throw toQoderHostError(error, "qoder run deployment");
      }
    },

    async listDeploymentRuns(deploymentId: string): Promise<DeploymentRunView[]> {
      try {
        return (await client.listDeploymentRuns(deploymentId)).map(toQoderDeploymentRunView);
      } catch (error) {
        throw toQoderHostError(error, "qoder list deployment runs");
      }
    },
  };
}
