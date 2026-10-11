import { useState } from "react";
import type { BotView, CreateBotInput, HostError } from "@shared/models";
import { Alert, Button, Card, Field, FieldLabel, Input, Select } from "../../ui/design-system";
import { teamTemplates } from "./team-templates";

const CREATE_NEW = "__create_new__";

interface Props {
  bots: BotView[];
  loading: boolean;
  error: HostError | null;
  provider?: string;
  onCreate(input: CreateBotInput): Promise<{ bot: BotView | null; error: HostError | null }>;
  onReload(): void;
  onCreated(bot: BotView): void;
  onCancel(): void;
}

/** Team Package 仅用于一次性创建配置，运行期协作由 Provider 的 coordinator 承载。 */
export function TeamTemplateCreation({
  bots,
  loading,
  error,
  provider,
  onCreate,
  onReload,
  onCreated,
  onCancel,
}: Props) {
  const [templateIndex, setTemplateIndex] = useState(0);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [choosingExisting, setChoosingExisting] = useState<Record<string, boolean>>({});
  const [namePrefix, setNamePrefix] = useState("");
  const [created, setCreated] = useState<Record<string, BotView>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const template = teamTemplates[templateIndex];
  const leadKey = template.team.room.defaultResponder.member;
  const lead = template.team.members.find((member) => member.key === leadKey);
  const members = template.team.members.filter((member) => member.key !== leadKey);
  const existingOptions = bots.map((bot) => ({ value: bot.ref.agentId, label: bot.name }));

  const create = async () => {
    if (!lead || busy || loading || error || Object.values(choosingExisting).some(Boolean)) return;
    const selectedIds = members
      .map((member) => created[member.key]?.ref.agentId ?? bindings[member.key])
      .filter((id) => id && id !== CREATE_NEW);
    if (new Set(selectedIds).size !== selectedIds.length) {
      setFailure("同一个现有 Bot 不能关联到多个成员，请调整选择。");
      return;
    }
    setStarted(true);
    setBusy(true);
    setFailure(null);
    const currentRunId = runId ?? crypto.randomUUID();
    if (runId === null) setRunId(currentRunId);
    const metadata = {
      openagentbot_template: template.team.name,
      openagentbot_template_run: currentRunId,
    };
    const prefix = namePrefix.trim();
    const resolved: string[] = [];
    for (const member of members) {
      if (created[member.key]) {
        resolved.push(created[member.key].ref.agentId);
        continue;
      }
      const existingId = bindings[member.key];
      if (existingId && existingId !== CREATE_NEW) {
        resolved.push(existingId);
        continue;
      }
      setCurrentStep(`正在创建 ${member.name}`);
      const result = await onCreate({
        name: `${prefix}${member.name}`,
        description: member.title,
        instructions: member.description,
        skills: [],
        metadata,
        ...(provider === "bailian" ? { model: "qwen3.7-max" } : {}),
      });
      if (!result.bot || result.error) {
        setFailure(
          `创建 ${member.name} 失败（${result.error?.code ?? "unavailable"}）。已创建的成员会保留。重试前请核对 Bot 列表，避免重复创建 ${member.name}。`,
        );
        setCurrentStep(null);
        setBusy(false);
        return;
      }
      setCreated((previous) => ({ ...previous, [member.key]: result.bot! }));
      resolved.push(result.bot.ref.agentId);
    }
    setCurrentStep(`正在创建协调者 ${lead.name}`);
    const result = await onCreate({
      name: `${prefix}${lead.name}`,
      description: lead.title,
      instructions: `${lead.description}\n\n协作约定：${template.team.room.bulletin}\n\n根据任务需要委派给协作成员，并汇总结果；不要假定文本点名是精确路由。`,
      memberAgentIds: resolved,
      skills: [],
      metadata,
      ...(provider === "bailian" ? { model: "qwen3.7-max" } : {}),
    });
    setBusy(false);
    setCurrentStep(null);
    if (!result.bot || result.error) {
      setFailure(
        `创建协调者 ${lead.name} 失败（${result.error?.code ?? "unavailable"}）。已创建的成员会保留。重试前请核对 Bot 列表，避免重复创建 ${lead.name}。`,
      );
      return;
    }
    onCreated(result.bot);
  };

  return (
    <section
      className="h-full overflow-y-auto bg-background px-5 py-8 sm:px-8"
      aria-labelledby="team-template-title"
    >
      <div className="mx-auto flex max-w-[560px] flex-col gap-5">
        <div>
          <h2 id="team-template-title" className="m-0 type-page-title">
            从协作模板创建
          </h2>
          <p className="mt-1 type-supporting text-muted-foreground">
            先创建或关联成员 Bot，最后创建协调者。每个 Bot 独立管理。
          </p>
        </div>
        <Field>
          <FieldLabel htmlFor="team-template">模板</FieldLabel>
          <Select
            id="team-template"
            value={String(templateIndex)}
            onValueChange={(value) => {
              setTemplateIndex(Number(value));
              setBindings({});
              setChoosingExisting({});
            }}
            disabled={started}
            options={teamTemplates.map((item, index) => ({
              value: String(index),
              label: item.team.name,
            }))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="team-name-prefix">名称前缀（可选）</FieldLabel>
          <Input
            id="team-name-prefix"
            value={namePrefix}
            onChange={(event) => setNamePrefix(event.target.value)}
            maxLength={40}
            disabled={started}
            placeholder="例如：项目名-"
          />
        </Field>
        <Card className="p-4">
          <p className="m-0 type-supporting font-medium">{template.team.name}</p>
          <p className="mt-1 mb-0 type-supporting text-muted-foreground">
            {template.team.description}
          </p>
        </Card>
        <div className="flex flex-col gap-3">
          {members.map((member) => (
            <Field key={member.key}>
              <p className="m-0 type-control font-medium">{member.name} · {member.title}</p>
              <p className="m-0 type-caption text-muted-foreground">{member.description}</p>
              {created[member.key] ? (
                <p className="m-0 type-supporting">已创建：{created[member.key].name}</p>
              ) : bindings[member.key] && bindings[member.key] !== CREATE_NEW ? (
                <div className="flex items-center gap-2">
                  <Select
                    id={`team-member-${member.key}`}
                    value={bindings[member.key]}
                    onValueChange={(value) =>
                      setBindings((previous) => ({ ...previous, [member.key]: value }))
                    }
                    disabled={(started && !failure) || loading || error !== null}
                    options={existingOptions}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={(started && !failure) || loading || error !== null}
                    onClick={() =>
                      setBindings((previous) => ({ ...previous, [member.key]: CREATE_NEW }))
                    }
                  >
                    改为新建
                  </Button>
                </div>
              ) : choosingExisting[member.key] ? (
                <div className="flex items-center gap-2">
                  <Select
                    id={`team-member-${member.key}`}
                    placeholder="选择现有 Bot"
                    onValueChange={(value) => {
                      setBindings((previous) => ({ ...previous, [member.key]: value }));
                      setChoosingExisting((previous) => ({ ...previous, [member.key]: false }));
                    }}
                    disabled={loading || error !== null}
                    options={existingOptions}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setChoosingExisting((previous) => ({ ...previous, [member.key]: false }))
                    }
                  >
                    取消
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="m-0 type-supporting">将新建「{namePrefix.trim()}{member.name}」</p>
                  {existingOptions.length > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={(started && !failure) || loading || error !== null}
                      onClick={() =>
                        setChoosingExisting((previous) => ({ ...previous, [member.key]: true }))
                      }
                    >
                      改用现有 Bot
                    </Button>
                  ) : null}
                </div>
              )}
            </Field>
          ))}
        </div>
        {lead ? (
          <p className="m-0 type-supporting">
            协调者：{lead.name} · {lead.title}（新建）
          </p>
        ) : null}
        <p className="m-0 type-caption text-muted-foreground">
          模板中的 Room、外观和本地 Skill 文件不会导入；协作通过协调者的远程 Chat 运行。已有 Bot
          不会被修改。
        </p>
        <div role="status" aria-live="polite" className="type-supporting text-muted-foreground">
          {busy && currentStep
            ? currentStep
            : started
              ? `已创建 ${Object.keys(created).length} 位成员`
              : `将新建 ${members.filter((member) => !bindings[member.key] || bindings[member.key] === CREATE_NEW).length} 位成员和 1 位协调者`}
        </div>
        {Object.keys(created).length > 0 ? (
          <p className="m-0 type-caption text-muted-foreground">
            已完成：
            {Object.values(created)
              .map((bot) => bot.name)
              .join("、")}
          </p>
        ) : null}
        {failure ? (
          <Alert variant="destructive" title="创建中断">
            {failure}
          </Alert>
        ) : null}
        {failure ? (
          <Button type="button" variant="outline" onClick={onReload} disabled={loading}>
            刷新 Bot 列表
          </Button>
        ) : null}
        {error ? (
          <Alert variant="destructive" title="Bot 列表不可用">
            刷新 Bot 列表后重试。
          </Alert>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            返回
          </Button>
          <Button
            type="button"
            onClick={() => void create()}
            disabled={
              busy || loading || error !== null || !lead || Object.values(choosingExisting).some(Boolean)
            }
            pending={busy}
          >
            {busy ? "创建中…" : started ? "继续创建" : "创建协作 Bot"}
          </Button>
        </div>
      </div>
    </section>
  );
}
