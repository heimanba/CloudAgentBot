/**
 * 百炼 Deployment（定时任务）Adapter。
 * wire → Provider-neutral view 的映射只发生在这里；metadata 标记透传不解释。
 * 合同见 docs/research/bailian-deployment-api-contract-2026-10-08.md。
 */

import type { DeploymentRunView } from "@shared/models";
import { hostError } from "@shared/errors";
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
import { BailianDataClient } from "./bailian-client";
import { toBailianHostError } from "./bailian-errors";

type Wire = Record<string, unknown>;

export interface BailianDeploymentAdapterOptions {
  fetchImpl?: typeof fetch;
}

function asRecord(value: unknown): Wire {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Wire) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** initial_events 的首条用户文本消息是 CloudAgentBot 写入的固定 prompt。 */
function readPrompt(initialEvents: unknown): string {
  if (!Array.isArray(initialEvents)) return "";
  for (const event of initialEvents) {
    const record = asRecord(event);
    if (record.type !== "message") continue;
    const content = record.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const text = asString(asRecord(block).text);
      if (text !== undefined) return text;
    }
  }
  return "";
}

export function toBailianDeploymentView(raw: Wire): AdapterDeploymentView {
  const metadata = asRecord(raw.metadata);
  const metadataStrings: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string") metadataStrings[key] = value;
  }
  const schedule = raw.schedule === null ? undefined : asRecord(raw.schedule);
  const agent = asRecord(raw.agent);
  const keyScopeMarker = asString(metadata[API_KEY_SCOPE_METADATA_KEY]);
  const expiresAt = asString(metadata[DEPLOYMENT_EXPIRES_AT_METADATA_KEY]);
  const view: AdapterDeploymentView = {
    agentId: asString(agent.id) ?? "",
    deploymentId: asString(raw.id) ?? "",
    name: asString(raw.name) ?? "",
    status:
      typeof raw.archived_at === "string" && raw.archived_at
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
      view.schedule = {
        expression,
        timezone,
        ...(asString(schedule.next_run_at) ? { nextRunAt: asString(schedule.next_run_at) } : {}),
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

export function toBailianDeploymentRunView(raw: Wire): DeploymentRunView {
  const run: DeploymentRunView = {
    id: asString(raw.id) ?? "",
    deploymentId: asString(raw.deployment_id) ?? "",
    trigger: raw.trigger_source === "schedule" ? "schedule" : "manual",
    status:
      raw.status === "succeeded" ? "succeeded" : raw.status === "failed" ? "failed" : "running",
  };
  const sessionId = asString(raw.session_id);
  if (sessionId !== undefined) run.sessionId = sessionId;
  const errorMessage = asString(asRecord(raw.error).message);
  if (errorMessage !== undefined) run.errorMessage = errorMessage;
  const startedAt = asString(raw.started_at);
  const finishedAt = asString(raw.finished_at);
  if (startedAt !== undefined) run.startedAt = startedAt;
  if (finishedAt !== undefined) run.finishedAt = finishedAt;
  return run;
}

export function createBailianDeploymentAdapter(
  connection: ResolvedConnection,
  options: BailianDeploymentAdapterOptions = {},
): DeploymentAdapter {
  if (!connection.workspaceId) {
    throw hostError("invalid-input", "Bailian workspaceId is required");
  }
  const client = new BailianDataClient({
    apiKey: connection.credential,
    workspaceId: connection.workspaceId,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  /** 创建请求必须携带 Agent 版本；从 agents 目录解析当前版本。 */
  async function resolveAgentVersion(agentId: string): Promise<number | undefined> {
    const result = await client.request(`/agents?limit=100`);
    const agents = (result.data as Wire[] | undefined) ?? [];
    const found = agents.find((raw) => raw.id === agentId);
    return typeof found?.version === "number" ? found.version : undefined;
  }

  return {
    async listDeployments(agentId?: string): Promise<AdapterDeploymentView[]> {
      try {
        return (await client.listDeployments(agentId)).map(toBailianDeploymentView);
      } catch (error) {
        throw toBailianHostError(error, "bailian list deployments");
      }
    },

    async getDeployment(deploymentId: string): Promise<AdapterDeploymentView> {
      try {
        return toBailianDeploymentView(await client.getDeployment(deploymentId));
      } catch (error) {
        throw toBailianHostError(error, "bailian get deployment");
      }
    },

    async createDeployment(
      input: AdapterCreateDeploymentInput,
    ): Promise<AdapterDeploymentView> {
      try {
        const version = await resolveAgentVersion(input.agentId);
        const body: Wire = {
          name: input.name,
          agent: { id: input.agentId, ...(version !== undefined ? { version } : {}) },
          initial_events: [
            {
              type: "message",
              role: "user",
              content: [{ type: "text", text: input.prompt }],
            },
          ],
          metadata: input.metadata,
        };
        // environment_id 在百炼是可选字段；空值不传（数据面保证非空，live 合同测试可省略）。
        if (input.environmentId.length > 0) body.environment_id = input.environmentId;
        if (input.description !== undefined) body.description = input.description;
        if (input.schedule !== undefined) {
          body.schedule = {
            type: "cron",
            expression: input.schedule.expression,
            timezone: input.schedule.timezone,
          };
        }
        return toBailianDeploymentView(await client.createDeployment(body));
      } catch (error) {
        throw toBailianHostError(error, "bailian create deployment");
      }
    },

    async updateDeployment(
      deploymentId: string,
      input: AdapterUpdateDeploymentInput,
    ): Promise<AdapterDeploymentView> {
      try {
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
            {
              type: "message",
              role: "user",
              content: [{ type: "text", text: input.prompt }],
            },
          ];
        }
        if (input.metadata !== undefined) body.metadata = input.metadata;
        return toBailianDeploymentView(await client.updateDeployment(deploymentId, body));
      } catch (error) {
        throw toBailianHostError(error, "bailian update deployment");
      }
    },

    async pauseDeployment(deploymentId: string): Promise<AdapterDeploymentView> {
      try {
        return toBailianDeploymentView(await client.pauseDeployment(deploymentId));
      } catch (error) {
        throw toBailianHostError(error, "bailian pause deployment");
      }
    },

    async unpauseDeployment(deploymentId: string): Promise<AdapterDeploymentView> {
      try {
        return toBailianDeploymentView(await client.unpauseDeployment(deploymentId));
      } catch (error) {
        throw toBailianHostError(error, "bailian unpause deployment");
      }
    },

    async archiveDeployment(deploymentId: string): Promise<void> {
      try {
        await client.archiveDeployment(deploymentId);
      } catch (error) {
        throw toBailianHostError(error, "bailian archive deployment");
      }
    },

    async runDeployment(deploymentId: string): Promise<DeploymentRunView> {
      try {
        return toBailianDeploymentRunView(await client.runDeployment(deploymentId));
      } catch (error) {
        throw toBailianHostError(error, "bailian run deployment");
      }
    },

    async listDeploymentRuns(deploymentId: string): Promise<DeploymentRunView[]> {
      try {
        return (await client.listDeploymentRuns(deploymentId)).map(toBailianDeploymentRunView);
      } catch (error) {
        throw toBailianHostError(error, "bailian list deployment runs");
      }
    },
  };
}
