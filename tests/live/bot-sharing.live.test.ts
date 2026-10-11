/**
 * Bot 共享 metadata 的真实 Cloud 合同验证（MUTATING，自动清理）。
 *
 * 运行：OPENAGENTBOT_LIVE=1 pnpm vitest run tests/live/bot-sharing.live.test.ts --no-file-parallelism
 * 控制面使用生产 BotControlPlane 与 @openagentpack/sdk 公共入口；验证 Qoder 与百炼。
 * 凭据仅从当前仓库 .env 或环境变量读取，不输出也不落盘。
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCloudEnvironment,
  createProjectRuntime,
  resolveProjectConfigFromObject,
  StateManager,
  type ProjectRuntimeContext,
} from "@openagentpack/sdk";
import { BotControlPlane } from "../../src/main/control-plane/bot-control-plane";
import { ManagedBotStore } from "../../src/main/control-plane/managed-bot-store";
import { ScopeLock } from "../../src/main/control-plane/scope-lock";
import { createQoderBotCatalog } from "../../src/main/data-plane/providers/qoder/qoder-bot-catalog";
import { createBailianBotCatalog } from "../../src/main/data-plane/providers/bailian/bailian-bot-catalog";
import { requireQoderAndBailian, type QoderAndBailianCredentials } from "./support/credentials";
import { QODER_GATEWAY, type Provider } from "./support/endpoints";
import { uniqueTestPrefix } from "./support/naming";
import { archiveResource, restRequest, restTarget } from "./support/rest";

const LIVE = process.env.OPENAGENTBOT_LIVE === "1";
const prefix = uniqueTestPrefix("share");

const credentials: QoderAndBailianCredentials = LIVE
  ? requireQoderAndBailian()
  : { qoderPat: "", bailianApiKey: "", bailianWorkspaceId: "" };

interface TestResources {
  root?: string;
  agentId?: string;
  environmentId?: string;
}
const resources: Record<Provider, TestResources> = { qoder: {}, bailian: {} };

function providerConfig(provider: Provider): Record<string, unknown> {
  return provider === "qoder"
    ? { api_key: credentials.qoderPat, gateway: QODER_GATEWAY }
    : { api_key: credentials.bailianApiKey, workspace_id: credentials.bailianWorkspaceId };
}

async function createEnvironment(provider: Provider): Promise<string> {
  const name = `${prefix}-${provider}-environment`;
  const loaded = await resolveProjectConfigFromObject(
    { version: "1", providers: { [provider]: providerConfig(provider) }, defaults: { provider } },
    { basePath: ".", projectName: `${prefix}-${provider}-environment-project` },
  );
  const runtime: ProjectRuntimeContext = await createProjectRuntime({
    projectName: loaded.projectName,
    config: loaded.config,
    state: StateManager.initialize(":memory:"),
  });
  const created = await createCloudEnvironment(
    runtime,
    name,
    {
      name,
      description: "CloudAgentBot Bot sharing contract test",
      config: { type: "cloud", networking: { type: "unrestricted" } },
      metadata: { openagentbot_test: "bot-sharing", test_run: prefix },
    },
    { provider },
  );
  if (!created.id) throw new Error("test Environment creation returned no ID");
  resources[provider].environmentId = created.id;
  return created.id;
}

async function cleanupProvider(provider: Provider): Promise<void> {
  const resource = resources[provider];
  const target = restTarget(provider, credentials);
  if (resource.agentId) {
    await archiveResource(target, "agent", resource.agentId).catch(() => {});
  }
  if (resource.environmentId) {
    const deleted = await restRequest(target, `/environments/${resource.environmentId}`, {
      method: "DELETE",
    });
    if (!deleted.ok) {
      await archiveResource(target, "environment", resource.environmentId).catch(() => {});
    }
  }
  if (resource.root) await rm(resource.root, { recursive: true, force: true }).catch(() => {});
}

afterAll(async () => {
  if (!LIVE) return;
  await Promise.all([cleanupProvider("qoder"), cleanupProvider("bailian")]);
});

describe.skipIf(!LIVE)("Bot shared metadata live contract", () => {
  for (const provider of ["qoder", "bailian"] as const) {
    it(`${provider} shares and unshares through Managed Bot Project Document Sync`, async () => {
      const environmentId = await createEnvironment(provider);
      const root = await mkdtemp(join(tmpdir(), `${prefix}-${provider}-`));
      resources[provider].root = root;
      const store = new ManagedBotStore(root);
      const providerCredentials =
        provider === "qoder"
          ? { provider, credential: credentials.qoderPat }
          : {
              provider,
              credential: credentials.bailianApiKey,
              workspaceId: credentials.bailianWorkspaceId,
            };
      const control = new BotControlPlane({
        store,
        lock: new ScopeLock(),
        resolveCredential: async () => providerCredentials,
        resolveDefaultEnvironmentId: async () => environmentId,
      });
      const created = await control.create(`conn-${provider}-${prefix}`, {
        name: `${prefix}-${provider}-bot`,
        description: "Temporary Bot sharing contract resource",
        metadata: { openagentbot_test: "bot-sharing", test_run: prefix },
      });
      resources[provider].agentId = created.ref.agentId;

      const catalog =
        provider === "qoder"
          ? createQoderBotCatalog({ provider, credential: credentials.qoderPat })
          : createBailianBotCatalog({
              provider,
              credential: credentials.bailianApiKey,
              workspaceId: credentials.bailianWorkspaceId,
            });
      const before = (await catalog.listBots()).find((bot) => bot.agentId === created.ref.agentId);
      expect(before).toBeDefined();
      expect(before?.shared).toBeUndefined();

      await expect(control.setShared(created.ref, true)).resolves.toMatchObject({
        shared: true,
        ref: created.ref,
      });
      const shared = (await catalog.listBots()).find((bot) => bot.agentId === created.ref.agentId);
      expect(shared?.shared).toBe(true);

      await expect(control.setShared(created.ref, false)).resolves.toMatchObject({
        shared: false,
        ref: created.ref,
      });
      const unshared = (await catalog.listBots()).find(
        (bot) => bot.agentId === created.ref.agentId,
      );
      expect(unshared?.shared).toBeUndefined();
    }, 180_000);
  }
});
