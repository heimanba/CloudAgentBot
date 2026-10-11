import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { resolveProjectConfigFromObject } from "@openagentpack/sdk";
import {
  buildProjectDocument,
  mergeAgentShared,
  mergeAgentKeyScope,
  readAgentShared,
  mergeEditableAgentDocument,
  readEditableAgentDocument,
} from "./project-document";

const BASE_INPUT = {
  name: "Demo Bot",
  description: "demo",
  projectName: "openagentbot-test",
  provider: "qoder" as const,
  environmentId: "env_shared_123",
  skills: [],
};

const MEMBER_IDS_MAX = Array.from({ length: 20 }, (_, index) => `agent_${index}`);

/** 完整更新输入（含成员 roster）。 */
function updateInput(memberAgentIds: string[]) {
  return {
    name: "Demo",
    description: "d",
    instructions: "Do it",
    model: "auto",
    skills: [],
    memberAgentIds,
  };
}

/** 单 Agent 文档，multiagent 为 undefined 时不写该键。 */
function documentWithMultiagent(multiagent: unknown): string {
  const agent: Record<string, unknown> = {
    name: "Demo",
    description: "",
    model: "auto",
    instructions: "Do it",
    environment: "default",
  };
  if (multiagent !== undefined) agent.multiagent = multiagent;
  return stringifyYaml({ version: "1", agents: { Demo: agent } });
}

describe("buildProjectDocument", () => {
  it("共享标记往返时只改保留键并保留其他 metadata", () => {
    const original = buildProjectDocument({
      ...BASE_INPUT,
      metadata: { openagentbot_template: "来源", owner: "team-a" },
    });
    const shared = mergeAgentShared(original, true, "qoder", "scope-1");
    expect(readAgentShared(shared, "scope-1")).toBe(true);
    expect(
      (parseYaml(shared) as { agents: Record<string, { metadata: Record<string, string> }> })
        .agents["Demo Bot"]?.metadata,
    ).toEqual({
      openagentbot_template: "来源",
      owner: "team-a",
      openagentbot_shared: "true",
    });
    const unshared = mergeAgentShared(shared, false, "bailian", "scope-1");
    expect(readAgentShared(unshared, "scope-1")).toBe(false);
    expect(
      (parseYaml(unshared) as { agents: Record<string, { metadata: Record<string, string> }> })
        .agents["Demo Bot"]?.metadata,
    ).toEqual({
      openagentbot_template: "来源",
      owner: "team-a",
    });
    const qoderCleared = mergeAgentShared(shared, false, "qoder", "scope-1");
    expect(
      (parseYaml(qoderCleared) as { agents: Record<string, { metadata: Record<string, string> }> })
        .agents["Demo Bot"]?.metadata,
    ).toMatchObject({
      openagentbot_template: "来源",
      owner: "team-a",
      openagentbot_shared: "",
    });
  });

  it("Key scope metadata 往返保留已有 metadata 与 Agent 声明", () => {
    const yaml = buildProjectDocument({
      name: "Demo Bot",
      provider: "qoder",
      projectName: "demo-project",
      environmentId: "env_1",
      metadata: { openagentbot_template: "example" },
    });
    const scoped = mergeAgentKeyScope(yaml, "oab-key-v1-scope-one", "Demo Bot");
    const parsed = parseYaml(scoped) as {
      agents: Record<string, { metadata: Record<string, string> }>;
    };
    expect(parsed.agents["Demo Bot"]?.metadata).toEqual({
      openagentbot_template: "example",
      openagentbot_key_scope: "oab-key-v1-scope-one",
    });
  });
  it("把模板导入来源写入 Agent metadata，并在编辑时保留", () => {
    const yaml = buildProjectDocument({
      ...BASE_INPUT,
      metadata: { openagentbot_template: "Competitor Watch", openagentbot_template_run: "run-1" },
    });
    const merged = mergeEditableAgentDocument(yaml, updateInput([]), "scope-1");
    const parsed = parseYaml(merged.yaml) as {
      agents: Record<string, { metadata: Record<string, string> }>;
    };
    expect(parsed.agents["Demo Bot"].metadata).toEqual({
      openagentbot_template: "Competitor Watch",
      openagentbot_template_run: "run-1",
    });
  });
  it("创建时按所选内置工具写入，编辑时可清空并保留其他工具配置", async () => {
    const yaml = buildProjectDocument({ ...BASE_INPUT, builtinTools: ["read", "web_search"] });
    const parsed = parseYaml(yaml) as { agents: Record<string, { tools: { builtin: string[] } }> };
    expect(parsed.agents["Demo Bot"]?.tools.builtin).toEqual(["read", "web_search"]);
    await expect(
      resolveProjectConfigFromObject(parsed, { basePath: ".", projectName: "tools-test" }),
    ).resolves.toBeDefined();

    const merged = mergeEditableAgentDocument(
      yaml,
      { ...updateInput([]), builtinTools: [] },
      "scope-1",
    );
    expect(readEditableAgentDocument(merged.yaml, "scope-1").configuration.builtinTools).toEqual(
      [],
    );
  });

  it("百炼网页工具只在用户显式选择后写入声明", () => {
    const defaults = parseYaml(buildProjectDocument({ ...BASE_INPUT, provider: "bailian" })) as {
      agents: Record<string, { tools?: { builtin: string[] } }>;
    };
    expect(defaults.agents["Demo Bot"]?.tools).toBeUndefined();
    const selected = parseYaml(
      buildProjectDocument({
        ...BASE_INPUT,
        provider: "bailian",
        builtinTools: ["bash", "web_search", "web_fetch", "mark_artifacts"],
      }),
    ) as { agents: Record<string, { tools: { builtin: string[] } }> };
    expect(selected.agents["Demo Bot"]?.tools.builtin).toEqual([
      "bash",
      "web_search",
      "web_fetch",
      "mark_artifacts",
    ]);
  });
  it("生成的 YAML 能通过 SDK 配置解析并产生一个 agent 与一个外部环境引用", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-doc-"));
    try {
      const yaml = buildProjectDocument(BASE_INPUT);
      const loaded = await resolveProjectConfigFromObject(parseYaml(yaml), {
        basePath: dir,
        projectName: "openagentbot-test",
      });
      const agents = loaded.config.agents as Record<
        string,
        { environment?: string; model?: string }
      >;
      const envs = loaded.config.environments as Record<
        string,
        { environment_id?: string; config?: { type?: string } }
      >;
      expect(Object.keys(agents)).toEqual(["Demo Bot"]);
      expect(agents["Demo Bot"]?.model).toBe("auto");
      expect(Object.keys(envs)).toEqual(["default"]);
      expect(agents["Demo Bot"]?.environment).toBe("default");
      expect(envs.default?.environment_id).toBe("env_shared_123");
      expect(envs.default?.config?.type).toBe("cloud");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("不包含凭据；provider 块是空占位", () => {
    const yaml = buildProjectDocument({
      ...BASE_INPUT,
      name: "Bot",
      description: undefined,
    });
    const parsed = parseYaml(yaml) as { providers: { qoder: Record<string, unknown> } };
    expect(parsed.providers.qoder).toEqual({});
    expect(yaml).not.toContain("api_key");
    expect(yaml).not.toContain("token");
    expect(yaml).not.toContain("pat-under-test");
  });

  it("特殊字符经转义后往返无损", async () => {
    const name = 'A "quoted" \\bot\n\twith: punctuation #1';
    const description = 'line1\nline2 "desc" \\end';
    const dir = await mkdtemp(join(tmpdir(), "v2-doc-"));
    try {
      const yaml = buildProjectDocument({
        ...BASE_INPUT,
        name,
        description,
        environmentId: "env_special_\\id\n",
      });
      const loaded = await resolveProjectConfigFromObject(parseYaml(yaml), {
        basePath: dir,
        projectName: "p",
      });
      const agents = loaded.config.agents as Record<
        string,
        { name: string; description: string; environment: string }
      >;
      const envs = loaded.config.environments as Record<string, { environment_id: string }>;
      const agent = agents[name];
      expect(agent).toBeDefined();
      expect(agent?.name).toBe(name);
      expect(agent?.description).toBe(description);
      expect(agent?.environment).toBe("default");
      expect(envs.default?.environment_id).toBe("env_special_\\id\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bailian provider 生成对应模型与 provider 占位块", () => {
    const yaml = buildProjectDocument({
      ...BASE_INPUT,
      provider: "bailian",
      environmentId: "env_bailian_1",
    });
    const parsed = parseYaml(yaml) as {
      providers: { bailian: Record<string, unknown> };
      defaults: { provider: string };
      agents: Record<string, { model: string; environment: string }>;
      environments: { default: { environment_id: string } };
    };
    expect(parsed.providers.bailian).toEqual({});
    expect(parsed.defaults.provider).toBe("bailian");
    expect(parsed.agents["Demo Bot"]?.model).toBe("qwen3.7-max");
    expect(parsed.agents["Demo Bot"]?.environment).toBe("default");
    expect(parsed.environments.default.environment_id).toBe("env_bailian_1");
  });

  it("bailian 透传 CreateBotInput.model；qoder 忽略该字段固定 auto", () => {
    const bailianYaml = buildProjectDocument({
      ...BASE_INPUT,
      provider: "bailian",
      environmentId: "env_bailian_1",
      model: "economy",
    });
    const bailianParsed = parseYaml(bailianYaml) as {
      agents: Record<string, { model: string }>;
    };
    expect(bailianParsed.agents["Demo Bot"]?.model).toBe("economy");

    const qoderYaml = buildProjectDocument({
      ...BASE_INPUT,
      model: "qwen3.8-max",
    });
    const qoderParsed = parseYaml(qoderYaml) as {
      agents: Record<string, { model: string }>;
    };
    expect(qoderParsed.agents["Demo Bot"]?.model).toBe("auto");
  });

  it("写入外部 Skill 引用，并以空数组明确表达解除全部绑定", () => {
    const empty = parseYaml(buildProjectDocument(BASE_INPUT)) as {
      agents: Record<string, { skills: unknown[] }>;
    };
    expect(empty.agents["Demo Bot"]?.skills).toEqual([]);

    const bound = parseYaml(
      buildProjectDocument({
        ...BASE_INPUT,
        skills: [{ type: "custom", skillId: "skill_1", version: "1.2" }],
      }),
    ) as { agents: Record<string, { skills: unknown[] }> };
    expect(bound.agents["Demo Bot"]?.skills).toEqual([
      { type: "custom", skill_id: "skill_1", version: "1.2" },
    ]);
  });

  it("为百炼写入配对的官方 MCP server 与 toolkit 工具配置", async () => {
    const yaml = buildProjectDocument({
      ...BASE_INPUT,
      provider: "bailian",
      mcpServers: [
        {
          type: "official",
          serverCode: "EnhancedSearch",
          serverName: "联网搜索增强版",
          permissionPolicy: "always_allow",
          tools: [
            { name: "search", enabled: true },
            { name: "search_image", enabled: false },
          ],
        },
      ],
    });
    const parsed = parseYaml(yaml) as {
      agents: Record<
        string,
        { mcp_servers: unknown[]; tools: { builtin: string[]; mcp: unknown[] } }
      >;
    };
    expect(parsed.agents["Demo Bot"]?.mcp_servers).toEqual([
      { name: "EnhancedSearch", type: "official", display_name: "联网搜索增强版" },
    ]);
    expect(parsed.agents["Demo Bot"]?.tools.builtin).toEqual([
      "bash",
      "read",
      "write",
      "edit",
      "glob",
      "grep",
    ]);
    expect(parsed.agents["Demo Bot"]?.tools.mcp).toEqual([
      {
        type: "mcp_toolkit",
        mcp_server_name: "EnhancedSearch",
        default_config: { enabled: false },
        configs: [
          { name: "search", enabled: true },
          { name: "search_image", enabled: false },
        ],
      },
    ]);
    await expect(
      resolveProjectConfigFromObject(parsed, { basePath: ".", projectName: "mcp-test" }),
    ).resolves.toBeDefined();
  });
});

describe("协作成员 roster（multiagent 写入）", () => {
  it("协作创建写入 coordinator 与外部 agent_id 引用，并被 SDK 配置解析接受", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-doc-"));
    try {
      const yaml = buildProjectDocument({
        ...BASE_INPUT,
        memberAgentIds: ["agent_remote_1", "agent_remote_2"],
      });
      const parsed = parseYaml(yaml) as { agents: Record<string, { multiagent?: unknown }> };
      expect(parsed.agents["Demo Bot"]?.multiagent).toEqual({
        type: "coordinator",
        agents: [{ agent_id: "agent_remote_1" }, { agent_id: "agent_remote_2" }],
      });
      const loaded = await resolveProjectConfigFromObject(parsed, {
        basePath: dir,
        projectName: "members",
      });
      const agents = loaded.config.agents as Record<string, { multiagent?: unknown }>;
      // SDK 把成员解析为外部引用（字符串成员是逻辑名，形状必须保持对象）。
      expect(agents["Demo Bot"]?.multiagent).toEqual({
        type: "coordinator",
        agents: [{ agent_id: "agent_remote_1" }, { agent_id: "agent_remote_2" }],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("普通创建（省略或空数组）完全不写 multiagent 键", () => {
    for (const yaml of [
      buildProjectDocument(BASE_INPUT),
      buildProjectDocument({ ...BASE_INPUT, memberAgentIds: [] }),
    ]) {
      const parsed = parseYaml(yaml) as { agents: Record<string, Record<string, unknown>> };
      expect(Object.hasOwn(parsed.agents["Demo Bot"]!, "multiagent")).toBe(false);
    }
  });

  it("协作创建使用协调版缺省 Instructions，普通创建沿用固定默认", () => {
    const instructionsOf = (yaml: string) =>
      (parseYaml(yaml) as { agents: Record<string, { instructions: string }> }).agents["Demo Bot"]!
        .instructions;

    expect(instructionsOf(buildProjectDocument(BASE_INPUT))).toBe(
      "You are a helpful assistant managed by CloudAgentBot. Answer concisely and accurately.",
    );
    expect(
      instructionsOf(buildProjectDocument({ ...BASE_INPUT, instructions: "请用中文回答。" })),
    ).toBe("请用中文回答。");
    expect(
      instructionsOf(
        buildProjectDocument({
          ...BASE_INPUT,
          memberAgentIds: ["agent_remote_1"],
          instructions: "请协调成员。",
        }),
      ),
    ).toBe("请协调成员。");
    for (const memberAgentIds of [["agent_remote_1"], ["agent_remote_1", "agent_remote_2"]]) {
      expect(instructionsOf(buildProjectDocument({ ...BASE_INPUT, memberAgentIds }))).toBe(
        [
          "You coordinate the available specialist agents.",
          "",
          "- Decide whether delegation is useful based on the task and each specialist's capabilities.",
          "- When the user explicitly requests a particular available specialist, prefer delegating the relevant work to that specialist when the runtime can identify it unambiguously.",
          "- Avoid unnecessary delegation.",
          "- Define clear task boundaries and reconcile the specialists' results into one coherent final response.",
        ].join("\n"),
      );
    }
  });
});

describe("协作成员 roster（读取）", () => {
  it("创建出的协作 YAML 读取往返：roster 保序，逻辑名与四字段不变", () => {
    const ids = ["agent_b", "agent_a", "agent_c"];
    const yaml = buildProjectDocument({ ...BASE_INPUT, memberAgentIds: ids });
    const doc = readEditableAgentDocument(yaml, "scope_1");
    expect(doc.logicalName).toBe("Demo Bot");
    expect(doc.configuration.memberAgentIds).toEqual(ids);
    expect(doc.configuration.name).toBe("Demo Bot");
    expect(doc.configuration.model).toBe("auto");
  });

  it("缺少 multiagent 键的普通 Bot 读取为空数组", () => {
    const yaml = buildProjectDocument(BASE_INPUT);
    expect(readEditableAgentDocument(yaml, "scope_1").configuration.memberAgentIds).toEqual([]);
  });

  it.each([
    ["未知 type", { type: "peer", agents: [{ agent_id: "agent_a" }] }],
    ["缺少 agents", { type: "coordinator" }],
    ["空 agents", { type: "coordinator", agents: [] }],
    ["逻辑名成员", { type: "coordinator", agents: ["Other Agent"] }],
    [
      "逻辑名与外部引用混合",
      { type: "coordinator", agents: [{ agent_id: "agent_a" }, "Other Agent"] },
    ],
    [
      "重复外部引用",
      { type: "coordinator", agents: [{ agent_id: "agent_a" }, { agent_id: " agent_a " }] },
    ],
    ["空 agent_id", { type: "coordinator", agents: [{ agent_id: "   " }] }],
    ["agent_id 非字符串", { type: "coordinator", agents: [{ agent_id: 42 }] }],
    ["成员形状未知", { type: "coordinator", agents: [{ name: "agent_a" }] }],
    [
      "超过 20 个成员",
      {
        type: "coordinator",
        agents: [...MEMBER_IDS_MAX, "agent_extra"].map((id) => ({ agent_id: id })),
      },
    ],
    ["显式 null", null],
    ["非映射", "agent_a"],
  ])("非法 multiagent 形状（%s）fail closed 为 invalid-input", (_label, multiagent) => {
    expect(() =>
      readEditableAgentDocument(documentWithMultiagent(multiagent), "scope_bad"),
    ).toThrow(expect.objectContaining({ code: "invalid-input" }));
  });

  it("合法 20 个成员通过", () => {
    const yaml = documentWithMultiagent({
      type: "coordinator",
      agents: MEMBER_IDS_MAX.map((id) => ({ agent_id: id })),
    });
    expect(readEditableAgentDocument(yaml, "scope_1").configuration.memberAgentIds).toEqual(
      MEMBER_IDS_MAX,
    );
  });
});

describe("协作成员 roster（合并）", () => {
  const WITH_ROSTER = stringifyYaml({
    version: "1",
    providers: { qoder: {} },
    custom_top: { keep: true },
    agents: {
      stable_key: {
        name: "Demo",
        description: "",
        model: "auto",
        instructions: "Do it",
        environment: "default",
        metadata: { owner: "team-a" },
        multiagent: { type: "coordinator", agents: [{ agent_id: "agent_old" }] },
      },
    },
  });

  it("非空数组完整替换 roster，逻辑 key 与未开放字段原样保留", () => {
    const ids = ["agent_new_1", "agent_new_2"];
    const merged = mergeEditableAgentDocument(WITH_ROSTER, updateInput(ids), "scope_1");
    const parsed = parseYaml(merged.yaml) as Record<string, unknown>;
    expect(parsed.custom_top).toEqual({ keep: true });
    const agent = (parsed.agents as Record<string, Record<string, unknown>>).stable_key!;
    expect(agent.multiagent).toEqual({
      type: "coordinator",
      agents: [{ agent_id: "agent_new_1" }, { agent_id: "agent_new_2" }],
    });
    expect(agent.metadata).toEqual({ owner: "team-a" });
    expect(agent.environment).toBe("default");
    expect(merged.configuration.memberAgentIds).toEqual(ids);
    expect(readEditableAgentDocument(merged.yaml, "scope_1").configuration.memberAgentIds).toEqual(
      ids,
    );
  });

  it("空数组删除 multiagent 键（回到普通 Bot），其余键保留", () => {
    const merged = mergeEditableAgentDocument(WITH_ROSTER, updateInput([]), "scope_1");
    const parsed = parseYaml(merged.yaml) as Record<string, unknown>;
    expect(parsed.custom_top).toEqual({ keep: true });
    const agents = parsed.agents as Record<string, Record<string, unknown>>;
    expect(Object.keys(agents)).toEqual(["stable_key"]);
    expect(Object.hasOwn(agents.stable_key!, "multiagent")).toBe(false);
    expect(agents.stable_key!.metadata).toEqual({ owner: "team-a" });
    expect(merged.configuration.memberAgentIds).toEqual([]);
    expect(readEditableAgentDocument(merged.yaml, "scope_1").configuration.memberAgentIds).toEqual(
      [],
    );
  });

  it("从未有 roster 的文档合并非空数组合成 coordinator 声明", () => {
    const merged = mergeEditableAgentDocument(
      documentWithMultiagent(undefined),
      updateInput(["agent_x"]),
      "scope_1",
    );
    const parsed = parseYaml(merged.yaml) as { agents: Record<string, Record<string, unknown>> };
    expect(parsed.agents.Demo!.multiagent).toEqual({
      type: "coordinator",
      agents: [{ agent_id: "agent_x" }],
    });
  });

  it("现有文档为逻辑名成员时合并 fail closed（不自动接管、不写盘猜测）", () => {
    const damaged = documentWithMultiagent({
      type: "coordinator",
      agents: ["Other Agent"],
    });
    expect(() => mergeEditableAgentDocument(damaged, updateInput(["agent_x"]), "scope_1")).toThrow(
      expect.objectContaining({ code: "invalid-input" }),
    );
    expect(() => mergeEditableAgentDocument(damaged, updateInput([]), "scope_1")).toThrow(
      expect.objectContaining({ code: "invalid-input" }),
    );
  });
});

describe("Project Document 编辑（读取/合并 round-trip）", () => {
  it("四字段可无损 round-trip 多行、引号、反斜线与 Unicode，并保留未开放字段", () => {
    const source = stringifyYaml({
      version: 1,
      agents: {
        stable_key: {
          name: "旧名称",
          description: "旧描述",
          instructions: "旧指令",
          model: "ultimate",
          environment: "shared-environment",
          mcp_servers: ["filesystem"],
          files: ["README.md"],
          memory: { enabled: true },
        },
      },
    });
    const configuration = {
      name: '新名称 "引号"',
      description: "第一行\n第二行\\path",
      instructions: "回答：你好 👋\n保留 'single' 与 \\backslash",
      model: "qwen3.8-max",
      skills: [],
      memberAgentIds: [],
    };

    const merged = mergeEditableAgentDocument(source, configuration, "scope-1");
    expect(readEditableAgentDocument(merged.yaml, "scope-1")).toEqual({
      logicalName: "stable_key",
      configuration,
    });
    const parsed = parseYaml(merged.yaml) as Record<string, unknown>;
    const agent = (parsed.agents as Record<string, Record<string, unknown>>).stable_key!;
    expect(agent.environment).toBe("shared-environment");
    expect(agent.mcp_servers).toEqual(["filesystem"]);
    expect(agent.files).toEqual(["README.md"]);
    expect(agent.memory).toEqual({ enabled: true });
  });

  it("name/description 缺失时回退，instructions/model 缺失或 model 非字符串时拒绝", () => {
    const minimal = stringifyYaml({
      agents: { logical_name: { instructions: "Do it", model: "ultimate" } },
    });
    expect(readEditableAgentDocument(minimal, "scope-1").configuration).toEqual({
      name: "logical_name",
      description: "",
      instructions: "Do it",
      model: "ultimate",
      skills: [],
      memberAgentIds: [],
    });

    for (const agent of [
      { model: "ultimate" },
      { instructions: "Do it" },
      { instructions: "Do it", model: { id: "ultimate" } },
    ]) {
      expect(() =>
        readEditableAgentDocument(stringifyYaml({ agents: { logical_name: agent } }), "scope-1"),
      ).toThrow(expect.objectContaining({ code: "invalid-input" }));
    }
  });
});

it("共享、配置编辑和取消共享往返保留能力引用及未知声明", () => {
  const original = buildProjectDocument({
    ...BASE_INPUT,
    provider: "bailian",
    memberAgentIds: ["agent-worker"],
    skills: [{ type: "custom", skillId: "skill-existing", version: "1" }],
    builtinTools: ["read"],
    metadata: { owner: "team-a" },
    mcpServers: [
      {
        type: "official",
        serverCode: "EnhancedSearch",
        serverName: "联网搜索",
        permissionPolicy: "always_allow",
        tools: [{ name: "search", enabled: true }],
      },
    ],
  });
  const document = parseYaml(original);
  document.agents["Demo Bot"].custom_setting = { retained: true };
  const shared = mergeAgentShared(stringifyYaml(document), true, "bailian", "scope-1");
  const before = readEditableAgentDocument(shared, "scope-1").configuration;
  const updated = mergeEditableAgentDocument(
    shared,
    { ...before, description: "更新用途" },
    "scope-1",
  );
  expect(readAgentShared(updated.yaml, "scope-1")).toBe(true);
  const unshared = mergeAgentShared(updated.yaml, false, "bailian", "scope-1");
  const expected = { ...document.agents["Demo Bot"], description: "更新用途" };
  expect(parseYaml(unshared).agents["Demo Bot"]).toEqual(expected);
});
