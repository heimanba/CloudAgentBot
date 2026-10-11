import { it, expect } from "vitest";
import { parseCreateBotInput } from "./validation";
it("接受模板创建标记并拒绝不合法的 metadata", () => {
  const base = {
    name: "openagentbot-team-e2e-0924-1032-Watcher",
    description: "Competitive Researcher",
    instructions: "Monitor only the public companies and signals the user selects.",
    model: "qwen3.7-max",
    skills: [],
  };
  const a = parseCreateBotInput(base);
  const b = parseCreateBotInput({
    ...base,
    metadata: { openagentbot_template: "Competitor Watch" },
  });
  const c = parseCreateBotInput({
    ...base,
    metadata: {
      openagentbot_template: "Competitor Watch",
      openagentbot_template_run: "84cbddf6-3c38-4281-98dc-169584fd589b",
    },
  });
  expect([a !== null, b !== null, c !== null]).toEqual([true, true, true]);
  expect(c?.metadata?.openagentbot_template_run).toBe("84cbddf6-3c38-4281-98dc-169584fd589b");
  expect(parseCreateBotInput({ ...base, metadata: { "bad-key": "x" } })).toBeNull();
});
