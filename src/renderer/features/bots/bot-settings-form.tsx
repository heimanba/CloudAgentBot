/**
 * Bot 配置表单：编辑名称、描述、Instructions 与模型。
 * - 打开后经 useBotConfiguration 从 bots.getConfiguration 初始化；
 * - 完整四字段提交（不接受 partial）；保存成功返回列表并重载；
 * - 保存失败保留输入并显示稳定错误；保存中全部禁用；
 * - 未变更时重新同步；hasPendingChanges 展示固定提示；
 * - 固定说明：新配置只用于新建 Chat，已有 Chat 保持创建时快照。
 */

import { useState, type FormEvent } from "react";
import type {
  BotConfigurationView,
  BotMcpBinding,
  BotSkillRef,
  BotView,
  HostError,
  UpdateBotInput,
} from "@shared/models";
import {
  Alert,
  Button,
  Field,
  FieldLabel,
  FieldDescription,
  Input,
  Select,
  Textarea,
  typography,
} from "../../ui/design-system";
import { BotAvatar } from "../../ui/bot-avatar/bot-avatar";
import { useBotConfiguration } from "./use-bot-configuration";
import { BotMemberSelector } from "./bot-member-selector";
import { BotSkillSelector } from "./bot-skill-selector";
import { useBotSkills } from "./use-bot-skills";
import { useSkillCatalog } from "./use-skill-catalog";
import { BotMcpSelector } from "./bot-mcp-selector";
import { BotBuiltinTools } from "./bot-builtin-tools";

function errorText(error: HostError): string {
  switch (error.code) {
    case "managed-state-missing":
      return "本地 state 缺失或损坏，已停止远程写入。";
    case "not-found":
      return "本地未找到该 Bot 的管理记录。";
    case "not-connected":
      return "凭据已断开，请重新连接。";
    case "authentication":
      return "凭据无效。";
    case "permission":
      return "凭据权限不足。";
    case "rate-limited":
      return "请求过于频繁，请稍后重试。";
    case "invalid-input":
      return "Provider 未接受该配置，请检查 Instructions 和模型后重试。";
    case "unavailable":
      return "服务暂时不可用，请稍后重试。";
    default:
      return "保存失败，请重试。";
  }
}

export interface BotSettingsFormProps {
  botRef: BotConfigurationView["ref"];
  /** 当前 Connection 的完整 Bot 列表，作为协作成员候选；不新增获取目录 hook。 */
  bots: BotView[];
  botsLoading: boolean;
  botsError: HostError | null;
  onReloadBots(): void;
  /** 变更时提交完整配置，未变更时重新同步；返回 null 表示成功。 */
  onSave(
    ref: BotConfigurationView["ref"],
    input: UpdateBotInput | "sync",
  ): Promise<HostError | null>;
  /** 保存成功后返回列表并重载。 */
  onSaved(): void;
  /** 取消返回列表。 */
  onCancel(): void;
}

export function BotSettingsForm({
  botRef,
  bots,
  botsLoading,
  botsError,
  onReloadBots,
  onSave,
  onSaved,
  onCancel,
}: BotSettingsFormProps) {
  const { loading, config, error } = useBotConfiguration(botRef);

  if (loading) {
    return (
      <section className="h-full overflow-y-auto bg-background px-5 py-8 sm:px-8">
        <p className={typography.body} role="status">
          加载配置…
        </p>
      </section>
    );
  }

  if (error !== null || config === null) {
    return (
      <section className="h-full overflow-y-auto bg-background px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-[504px] flex-col gap-4">
          <Alert variant="destructive" title="无法加载配置">
            {error === null ? "本地未找到该 Bot 的配置。" : errorText(error)}
          </Alert>
          <div>
            <Button type="button" variant="secondary" onClick={onCancel}>
              返回
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <LoadedBotSettingsForm
      config={config}
      bots={bots}
      botsLoading={botsLoading}
      botsError={botsError}
      onReloadBots={onReloadBots}
      onSave={onSave}
      onSaved={onSaved}
      onCancel={onCancel}
    />
  );
}

function LoadedBotSettingsForm({
  config,
  bots,
  botsLoading,
  botsError,
  onReloadBots,
  onSave,
  onSaved,
  onCancel,
}: {
  config: BotConfigurationView;
  bots: BotView[];
  botsLoading: boolean;
  botsError: HostError | null;
  onReloadBots(): void;
  onSave: BotSettingsFormProps["onSave"];
  onSaved(): void;
  onCancel(): void;
}) {
  const [name, setName] = useState(config.name);
  const [description, setDescription] = useState(config.description);
  const [instructions, setInstructions] = useState(config.instructions);
  const [model, setModel] = useState(config.model);
  const [skills, setSkills] = useState<BotSkillRef[]>(config.skills ?? []);
  const [mcpServers, setMcpServers] = useState<BotMcpBinding[]>(config.mcpServers ?? []);
  const [builtinTools, setBuiltinTools] = useState<string[] | undefined>(config.builtinTools);
  const [memberAgentIds, setMemberAgentIds] = useState<string[]>(config.memberAgentIds);
  const skillOptions = useBotSkills(config.ref.connectionId);
  const skillCatalog = useSkillCatalog(config.ref.connectionId);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<HostError | null>(null);

  const nameId = "bot-config-name";
  const descId = "bot-config-description";
  const instrId = "bot-config-instructions";
  const modelId = "bot-config-model";
  const errorId = "bot-config-error";

  // 配置可能因外部更新变化（如重新打开），以初次加载为基准。
  const [initial] = useState(config);
  const unchanged =
    name === initial.name &&
    description === initial.description &&
    instructions === initial.instructions &&
    model === initial.model &&
    JSON.stringify(skills) === JSON.stringify(initial.skills ?? []) &&
    JSON.stringify(mcpServers) === JSON.stringify(initial.mcpServers ?? []) &&
    JSON.stringify(builtinTools) === JSON.stringify(initial.builtinTools) &&
    JSON.stringify(memberAgentIds) === JSON.stringify(initial.memberAgentIds);
  const submitDisabled = saving || name.trim().length === 0 || model.trim().length === 0;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    const input: UpdateBotInput = {
      name: name.trim(),
      description,
      instructions,
      model,
      skills,
      ...(JSON.stringify(builtinTools) === JSON.stringify(initial.builtinTools)
        ? {}
        : { builtinTools }),
      ...(config.supportsMcpConfiguration ? { mcpServers } : {}),
      memberAgentIds,
    };
    const error = await onSave(config.ref, unchanged ? "sync" : input);
    setSaving(false);
    if (error !== null) {
      // 失败保留输入。
      setSaveError(error);
      return;
    }
    onSaved();
  };

  const modelOptions = config.models.map((m) => ({ value: m.value, label: m.label }));

  return (
    <section
      aria-labelledby="bot-config-title"
      className="h-full overflow-y-auto bg-background px-5 py-8 sm:px-8 sm:py-10"
    >
      <div className="mx-auto max-w-[800px] motion-safe:animate-[surface-in_180ms_cubic-bezier(0.22,1,0.36,1)_both]">
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
          <div className="flex items-center gap-4 pb-5">
            <BotAvatar name={name} size="hero" />
            <div className="min-w-0">
              <h2 id="bot-config-title" className="m-0 type-page-title">
                配置 Bot
              </h2>
              <p className="mt-1 mb-0 type-supporting text-muted-foreground">
                编辑名称、描述、工作指令与模型。
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <Field className="border-b border-border pb-5">
              <FieldLabel htmlFor={nameId}>名称</FieldLabel>
              <Input
                autoFocus
                id={nameId}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                value={name}
                disabled={saving}
                aria-invalid={name.trim().length === 0}
              />
            </Field>

            <Field className="border-b border-border pb-5">
              <FieldLabel htmlFor={modelId}>模型</FieldLabel>
              <Select
                id={modelId}
                value={model}
                onValueChange={setModel}
                options={modelOptions}
                disabled={saving}
                aria-label="模型"
              />
            </Field>

            <Field className="border-b border-border pb-5">
              <FieldLabel htmlFor={descId}>描述</FieldLabel>
              <Textarea
                id={descId}
                maxLength={500}
                onChange={(event) => setDescription(event.target.value)}
                value={description}
                disabled={saving}
                className="min-h-[72px] resize-y"
              />
              <FieldDescription>
                说明适合完成什么任务，方便同事选择；具体行为由系统提示词决定。
              </FieldDescription>
            </Field>

            <Field className="border-b border-border pb-5">
              <FieldLabel htmlFor={instrId}>系统提示词</FieldLabel>
              <Textarea
                id={instrId}
                maxLength={20000}
                onChange={(event) => setInstructions(event.target.value)}
                value={instructions}
                disabled={saving}
                className="min-h-[144px] resize-y font-mono type-supporting"
              />
              <FieldDescription>
                用于指导 Bot 如何回答和使用工具。新配置用于新建 Chat，已有 Chat
                继续使用创建时的配置。
              </FieldDescription>
            </Field>

            <div className="border-b border-border pb-5">
              <p className="mb-2 type-control">Multi-Agent 模式</p>
              <p className="mb-3 type-supporting text-muted-foreground">
                {memberAgentIds.length > 0
                  ? `已配置 ${memberAgentIds.length} 位协作成员`
                  : "未开启"}
              </p>
              <BotMemberSelector
                value={memberAgentIds}
                candidates={bots}
                currentAgentId={config.ref.agentId}
                candidatesLoading={botsLoading}
                candidatesError={botsError}
                disabled={saving}
                onChange={setMemberAgentIds}
                onRetry={onReloadBots}
              />
            </div>

            <div className="border-b border-border pb-5">
              <BotBuiltinTools
                provider={config.provider}
                value={builtinTools}
                disabled={saving}
                onChange={setBuiltinTools}
              />
            </div>

            {config.supportsMcpConfiguration ? (
              <div className="border-b border-border pb-5">
                <BotMcpSelector value={mcpServers} disabled={saving} onChange={setMcpServers} />
              </div>
            ) : null}

            <div className="border-b border-border pb-5">
              <BotSkillSelector
                value={skills}
                options={skillOptions.options}
                loading={skillOptions.loading}
                error={skillOptions.error}
                disabled={saving}
                onChange={setSkills}
                onRetry={skillOptions.retry}
                marketplace={skillCatalog}
              />
            </div>

            {config.hasPendingChanges && (
              <Alert variant="warning" title="本地配置尚未同步到 Provider">
                保存并同步将再次应用当前配置。
              </Alert>
            )}

            {saveError !== null && (
              <Alert variant="destructive" title="保存失败">
                <span id={errorId}>{errorText(saveError)}</span>
              </Alert>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button onClick={onCancel} type="button" variant="secondary" disabled={saving}>
              取消
            </Button>
            <Button disabled={submitDisabled} pending={saving} type="submit" variant="default">
              {saving ? "保存中…" : "保存并同步"}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
