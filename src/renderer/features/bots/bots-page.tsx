import { useMemo, useState, type FormEvent } from "react";
import type {
  BotRef,
  BotMcpBinding,
  BotSkillRef,
  BotView,
  CreateBotInput,
  HostError,
  UpdateBotInput,
} from "@shared/models";
import {
  Button,
  Field,
  FieldLabel,
  FieldDescription,
  Input,
  Select,
  Textarea,
  Alert,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  typography,
} from "../../ui/design-system";
import { MoreHorizontal, Plus, RefreshCw, Search, ListFilter } from "lucide-react";
import { BotAvatar } from "../../ui/bot-avatar/bot-avatar";
import { cn } from "../../lib/utils";
import {
  buildBotDirectory,
  filterBotDirectory,
  type BotDirectoryFilter,
} from "./bot-directory-model";
import { BotSettingsForm } from "./bot-settings-form";
import { BotMemberSelector } from "./bot-member-selector";
import { BotSkillSelector } from "./bot-skill-selector";
import { useBotSkills } from "./use-bot-skills";
import { useSkillCatalog } from "./use-skill-catalog";
import { BotMcpSelector } from "./bot-mcp-selector";
import { BotBuiltinTools } from "./bot-builtin-tools";
import { BotSharingHelp } from "./bot-share-action";
import { BotDirectoryRow } from "./bot-directory-row";
import { TeamTemplateCreation } from "./team-template-creation";

function errorText(error: HostError): string {
  switch (error.code) {
    case "not-connected":
      return "凭据已断开，请重新连接。";
    case "authentication":
      return "凭据无效，请到「管理连接」更新凭证。";
    case "permission":
      return "凭据权限不足。";
    case "rate-limited":
      return "请求过于频繁，请稍后重试。";
    case "managed-state-missing":
      return "本地 state 缺失或损坏，已停止远程写入。";
    case "conflict":
      return "远程状态冲突，请刷新后重试。";
    case "not-found":
      return "本地未找到该 Bot 的管理记录。";
    case "sync-incomplete":
      return "同步完成但未记录远程标识，请重试。";
    case "invalid-input":
      return "输入不合法，请检查后重试。";
    case "unavailable":
      return "服务暂时不可用，请稍后重试。";
    default:
      return "操作失败，请重试。";
  }
}

export interface BotsPageProps {
  connectionId: string;
  bots: BotView[];
  loading: boolean;
  error: HostError | null;
  /** 当前 Connection 的 Provider；百炼可选模型，Qoder 创建模型固定为 auto。 */
  provider?: string;
  onReload(): void;
  onOpenChats(bot: BotView): void;
  onEditBot?(ref: BotRef): void;
  onSetShared?(ref: BotRef, shared: boolean): Promise<HostError | null>;
  /** 更新或重新同步 managed Bot；返回 null 表示成功。 */
  onSave(ref: BotRef, input: UpdateBotInput | "sync"): Promise<HostError | null>;
  /** 创建 Bot；成功后返回新 BotView，失败返回错误。 */
  onCreate(input: CreateBotInput): Promise<{ bot: BotView | null; error: HostError | null }>;
  /** 归档 Managed Bot；返回 null 表示成功（成功后由 hook 触发列表重读）。 */
  onArchive(ref: BotRef): Promise<HostError | null>;
  /** 创建成功后由调用方决定是否进入新 Bot（通常打开 Chats）。 */
  onCreated(bot: BotView): void;
  /** 从任务草稿进入创建时，取消后回到原任务。 */
  onCreateCancelled?(): void;
  /** 外部新建入口每次递增，列表随即打开创建 Surface。 */
  createRequestKey?: number;
}

/** 百炼创建可选模型（真机验证列表，与 main 侧 BAILIAN_VERIFIED_MODELS 一致）。 */
const BAILIAN_CREATE_MODEL_OPTIONS = [
  { value: "qwen3.7-max", label: "qwen3.7-max（默认）" },
  { value: "qwen3.8-max", label: "qwen3.8-max" },
  { value: "qwen3.8-flash", label: "qwen3.8-flash" },
  { value: "qwen3.7-plus", label: "qwen3.7-plus" },
  { value: "qwen3.6-plus", label: "qwen3.6-plus" },
  { value: "qwen3.6-flash", label: "qwen3.6-flash" },
  { value: "deepseek-v4-pro", label: "deepseek-v4-pro" },
  { value: "deepseek-v4-flash", label: "deepseek-v4-flash" },
  { value: "glm-5.2", label: "glm-5.2" },
  { value: "glm-5.1", label: "glm-5.1" },
  { value: "auto", label: "auto（智能路由）" },
  { value: "performance", label: "performance" },
  { value: "balanced", label: "balanced" },
  { value: "economy", label: "economy" },
];

/** Bot 创建表单：两家 Provider 使用相同字段顺序，Qoder 的固定模型只读展示。 */
function BotCreationForm({
  connectionId,
  provider,
  bots,
  botsLoading,
  botsError,
  onReloadBots,
  onCreate,
  onCreated,
  onCancel,
}: {
  connectionId: string;
  provider?: string;
  /** 当前 Connection 的完整 Bot 列表，直接作为协作成员候选。 */
  bots: BotView[];
  botsLoading: boolean;
  botsError: HostError | null;
  onReloadBots(): void;
  onCreate: BotsPageProps["onCreate"];
  onCreated: BotsPageProps["onCreated"];
  onCancel(): void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [model, setModel] = useState(BAILIAN_CREATE_MODEL_OPTIONS[0].value);
  const [skills, setSkills] = useState<BotSkillRef[]>([]);
  const [mcpServers, setMcpServers] = useState<BotMcpBinding[]>([]);
  const [builtinTools, setBuiltinTools] = useState<string[] | undefined>(undefined);
  const [memberAgentIds, setMemberAgentIds] = useState<string[]>([]);
  const skillOptions = useBotSkills(connectionId);
  const skillCatalog = useSkillCatalog(connectionId);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<HostError | null>(null);

  const nameId = "create-bot-name";
  const descId = "create-bot-description";
  const instructionsId = "create-bot-instructions";
  const modelId = "create-bot-model";
  const errorId = "create-bot-error";
  const submitDisabled = creating || name.trim().length === 0;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    const trimmed = name.trim();
    const input: CreateBotInput = {
      name: trimmed,
      skills,
      ...(builtinTools === undefined ? {} : { builtinTools }),
      memberAgentIds,
      ...(mcpServers.length > 0 ? { mcpServers } : {}),
    };
    if (description.trim().length > 0) input.description = description.trim();
    if (instructions.trim().length > 0) input.instructions = instructions.trim();
    if (provider === "bailian") input.model = model;
    const { bot, error } = await onCreate(input);
    setCreating(false);
    if (error !== null) {
      setCreateError(error);
      return;
    }
    if (bot !== null) {
      onCreated(bot);
    }
  };

  return (
    <section
      aria-labelledby="create-bot-title"
      className="h-full overflow-y-auto bg-background px-5 py-8 sm:px-8 sm:py-10"
    >
      <div className="mx-auto max-w-[560px] motion-safe:animate-[surface-in_180ms_cubic-bezier(0.22,1,0.36,1)_both]">
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
          <div className="flex items-center gap-4 pb-5">
            <BotAvatar name={name} size="hero" creating={creating} />
            <div className="min-w-0">
              <h2 id="create-bot-title" className="m-0 type-page-title">
                创建 Bot
              </h2>
              <p className="mt-1 mb-0 type-supporting text-muted-foreground">
                填写名称即可创建，其他配置可以稍后完善。
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <Field>
              <FieldLabel htmlFor={nameId}>名称</FieldLabel>
              <Input
                autoFocus
                id={nameId}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                placeholder="Bot 名称"
                value={name}
                disabled={creating}
                aria-invalid={createError !== null && name.trim().length === 0}
                aria-describedby={createError !== null ? errorId : undefined}
              />
            </Field>

            <div className="grid gap-5">
              <Field>
                <FieldLabel htmlFor={descId}>职责描述（可选）</FieldLabel>
                <Textarea
                  id={descId}
                  maxLength={500}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="例如：帮助整理会议纪要"
                  value={description}
                  disabled={creating}
                  className="min-h-[72px] resize-y"
                />
                <FieldDescription>
                  说明适合完成什么任务，方便同事选择；具体行为由系统提示词决定。
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor={instructionsId}>工作指令（可选）</FieldLabel>
                <Textarea
                  id={instructionsId}
                  maxLength={20_000}
                  onChange={(event) => setInstructions(event.target.value)}
                  placeholder="描述 Bot 应如何工作、回答和使用工具"
                  value={instructions}
                  disabled={creating}
                  className="min-h-[144px] resize-y"
                />
                <p className="mt-1 type-caption text-muted-foreground">
                  留空时使用{memberAgentIds.length > 0 ? "协作" : "普通 Bot"}
                  默认指令；创建后仍可修改。
                </p>
              </Field>

              <Field>
                <FieldLabel htmlFor={modelId}>模型</FieldLabel>
                {provider === "bailian" ? (
                  <Select
                    id={modelId}
                    value={model}
                    onValueChange={setModel}
                    disabled={creating}
                    options={BAILIAN_CREATE_MODEL_OPTIONS}
                  />
                ) : (
                  <Input id={modelId} value="auto" readOnly aria-label="模型" />
                )}
                {provider !== "bailian" ? (
                  <p className="m-0 type-caption text-muted-foreground">
                    Qoder 创建时自动选择模型；创建后可在配置页调整。
                  </p>
                ) : null}
              </Field>

              <BotBuiltinTools
                provider={provider ?? "qoder"}
                value={builtinTools}
                disabled={creating}
                onChange={setBuiltinTools}
              />
              <div className="grid gap-1.5">
                <BotSkillSelector
                  value={skills}
                  options={skillOptions.options}
                  loading={skillOptions.loading}
                  error={skillOptions.error}
                  disabled={creating}
                  showScopeHint={false}
                  onChange={setSkills}
                  onRetry={skillOptions.retry}
                  marketplace={skillCatalog}
                />
                <p className="type-caption text-muted-foreground">
                  为 Bot 添加特定任务的工作方法。
                </p>
              </div>

              {provider === "bailian" ? (
                <div className="grid gap-1.5">
                  <BotMcpSelector
                    value={mcpServers}
                    disabled={creating}
                    showScopeHint={false}
                    onChange={setMcpServers}
                  />
                  <p className="type-caption text-muted-foreground">
                    连接 Bot 可使用的外部工具或服务。
                  </p>
                </div>
              ) : null}

              <BotMemberSelector
                value={memberAgentIds}
                candidates={bots}
                candidatesLoading={botsLoading}
                candidatesError={botsError}
                disabled={creating}
                onChange={setMemberAgentIds}
                onRetry={onReloadBots}
              />
            </div>

            {createError !== null && (
              <Alert variant="destructive" title="创建失败">
                <span id={errorId}>{errorText(createError)}</span>
              </Alert>
            )}
          </div>

          <p className="type-caption text-muted-foreground">
            所选能力会用于这个 Bot 后续新建的 Chat；创建后仍可调整。
          </p>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button onClick={onCancel} type="button" variant="secondary" disabled={creating}>
              取消
            </Button>
            <Button disabled={submitDisabled} pending={creating} type="submit" variant="default">
              {creating ? "创建中…" : "创建 Bot"}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

/** Bot 列表：远程 Bot 只读浏览；受管理 Bot 提供重新同步与编辑配置入口。 */
export function BotsPage({
  connectionId,
  bots,
  loading,
  error,
  provider,
  onReload,
  onOpenChats,
  onEditBot,
  onSetShared,
  onSave,
  onCreate,
  onArchive,
  onCreated,
  onCreateCancelled,
  createRequestKey = 0,
}: BotsPageProps) {
  const [localShowCreate, setLocalShowCreate] = useState(false);
  const [showTemplateCreate, setShowTemplateCreate] = useState(false);
  const [dismissedCreateRequest, setDismissedCreateRequest] = useState(0);
  const [editingBotRef, setEditingBotRef] = useState<BotRef | null>(null);
  const [pendingArchiveBot, setPendingArchiveBot] = useState<BotView | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<HostError | null>(null);
  const [selectedFilter, setFilter] = useState<BotDirectoryFilter | null>(null);
  const [query, setQuery] = useState("");
  const [onlyCoordinators, setOnlyCoordinators] = useState(false);
  const showCreate = localShowCreate || createRequestKey > dismissedCreateRequest;
  const directory = useMemo(() => buildBotDirectory(bots), [bots]);
  const filter = selectedFilter ?? (directory.managedCount > 0 ? "managed" : "shared");
  const visibleRows = useMemo(
    () =>
      filterBotDirectory(directory.rows, filter, query).filter(
        ({ bot }) => !onlyCoordinators || Boolean(bot.collaboration?.memberAgentIds.length),
      ),
    [directory.rows, filter, query, onlyCoordinators],
  );

  const requestArchive = (bot: BotView) => {
    setArchiveError(null);
    setPendingArchiveBot(bot);
  };
  const closeArchive = () => {
    setPendingArchiveBot(null);
    setArchiveError(null);
  };
  const confirmArchive = async () => {
    if (pendingArchiveBot === null || archiving) return;
    setArchiving(true);
    setArchiveError(null);
    const err = await onArchive(pendingArchiveBot.ref);
    setArchiving(false);
    if (err !== null) {
      // 失败：弹窗保持打开，错误就地展示。
      setArchiveError(err);
      return;
    }
    // 成功：hook 已触发 reload 重读 Provider 事实；关闭弹窗，不做乐观删除。
    closeArchive();
  };
  const closeCreate = () => {
    setLocalShowCreate(false);
    setShowTemplateCreate(false);
    setDismissedCreateRequest(createRequestKey);
  };

  if (showTemplateCreate) {
    return (
      <TeamTemplateCreation
        bots={bots}
        loading={loading}
        error={error}
        provider={provider}
        onCreate={onCreate}
        onReload={onReload}
        onCreated={(bot) => {
          closeCreate();
          onCreated(bot);
        }}
        onCancel={closeCreate}
      />
    );
  }

  if (showCreate) {
    return (
      <BotCreationForm
        connectionId={connectionId}
        provider={provider}
        bots={bots}
        botsLoading={loading}
        botsError={error}
        onReloadBots={onReload}
        onCreate={onCreate}
        onCreated={(bot) => {
          closeCreate();
          onCreated(bot);
        }}
        onCancel={() => {
          closeCreate();
          onCreateCancelled?.();
        }}
      />
    );
  }

  if (editingBotRef !== null) {
    return (
      <BotSettingsForm
        botRef={editingBotRef}
        bots={bots}
        botsLoading={loading}
        botsError={error}
        onReloadBots={onReload}
        onSave={onSave}
        onSaved={() => {
          setEditingBotRef(null);
        }}
        onCancel={() => setEditingBotRef(null)}
      />
    );
  }

  return (
    <section className="h-full overflow-y-auto bg-background px-5 py-7 sm:px-8">
      <div className="[-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag] mx-auto mb-6 flex max-w-[704px] flex-wrap items-center justify-between gap-3 motion-safe:animate-[surface-in_180ms_cubic-bezier(0.22,1,0.36,1)_both]">
        <div className="min-w-0">
          <h2 className="m-0 type-page-title">管理助手</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setShowTemplateCreate(true)}>
            从模板创建
          </Button>
          {/* §2.8：空状态由中央创建入口承载唯一主动作。 */}
          {loading || error || bots.length > 0 ? (
            <Button size="sm" onClick={() => setLocalShowCreate(true)}>
              <Plus className="size-[14px]" aria-hidden="true" />
              <span>新建助手</span>
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="max-md:size-[44px]"
                pending={loading}
                aria-label={loading ? "正在刷新 Bot 列表" : "Bot 列表更多操作"}
              >
                {loading ? null : (
                  <MoreHorizontal
                    className="size-[14px] stroke-[1.75] text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  setFilter("provider");
                  setQuery("");
                }}
              >
                浏览 Provider 资源
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onReload} disabled={loading}>
                <RefreshCw className={loading ? "animate-spin" : undefined} aria-hidden="true" />
                {loading ? "刷新中…" : "刷新 Bot 列表"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {loading && bots.length === 0 ? (
        <p className={typography.body} role="status">
          加载中…
        </p>
      ) : null}

      {!loading && !error && bots.length === 0 ? (
        <div className="mx-auto flex min-h-[256px] max-w-[672px] flex-col items-center justify-center p-7 text-center">
          <h3 className={cn(typography.body, "font-semibold mb-1")}>还没有助手</h3>
          <p className={cn(typography.supporting, "text-muted-foreground mb-3")}>
            创建一个助手，开始处理任务。
          </p>
          <Button variant="default" onClick={() => setLocalShowCreate(true)}>
            新建助手
          </Button>
        </div>
      ) : null}

      {bots.length > 0 ? (
        <div className="mx-auto max-w-[704px]">
          <Tabs value={filter} onValueChange={(value) => setFilter(value as BotDirectoryFilter)}>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <TabsList className="grid-cols-3" aria-label="助手范围">
                {(
                  [
                    ["managed", "我的助手", directory.managedCount],
                    ["shared", "团队共享", directory.sharedCount],
                    ["all", "全部", directory.workspaceCount],
                  ] as const
                ).map(([value, label, count]) => (
                  <TabsTrigger key={value} value={value}>
                    {label}{" "}
                    <span className="ml-1 type-caption tabular-nums text-muted-foreground">
                      {count}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
              {filter === "shared" ? <BotSharingHelp /> : null}
              <label className="ml-auto flex h-[var(--control-md)] min-w-0 basis-40 flex-1 items-center gap-2 rounded-[var(--radius-md)] bg-card px-3 ring-1 ring-input focus-within:ring-[var(--input-focus)]">
                <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <Input
                  variant="bare"
                  className="h-full min-w-0"
                  aria-label="搜索助手"
                  placeholder="搜索助手"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant={onlyCoordinators ? "secondary" : "ghost"}
                    aria-label="筛选助手角色"
                  >
                    <ListFilter className="size-3.5" />
                    {onlyCoordinators ? "协调者" : "筛选"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setOnlyCoordinators(false)}>
                    全部角色
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setOnlyCoordinators(true)}>
                    仅协调者
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <TabsContent
              value={filter}
              {...(filter === "provider"
                ? { "aria-labelledby": "", "aria-label": "Provider 资源" }
                : {})}
            >
              {filter === "provider" ? (
                <div className="my-2 px-2">
                  <h3 className="type-body font-semibold">Provider 资源</h3>
                  <p className="type-supporting text-muted-foreground">
                    包含当前连接可见的未分组助手；浏览不代表接管。
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setFilter("managed");
                      setQuery("");
                    }}
                  >
                    返回我的助手
                  </Button>
                </div>
              ) : null}
              <p className="sr-only" role="status">
                显示 {visibleRows.length} 个助手
              </p>
              {visibleRows.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="mb-2 type-supporting text-muted-foreground">
                    {query || onlyCoordinators
                      ? "当前范围没有匹配的助手"
                      : filter === "managed"
                        ? "还没有自己的助手"
                        : filter === "shared"
                          ? "还没有团队共享助手"
                          : filter === "provider"
                            ? "没有可浏览的 Provider 资源。"
                            : "当前工作区范围还没有助手。"}
                  </p>
                  {!query &&
                  !onlyCoordinators &&
                  filter === "shared" &&
                  directory.managedCount > 0 ? (
                    <Button size="sm" variant="secondary" onClick={() => setFilter("managed")}>
                      查看我的助手
                    </Button>
                  ) : null}
                  {onlyCoordinators ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setOnlyCoordinators(false)}
                    >
                      清除角色筛选
                    </Button>
                  ) : null}
                  {query ? (
                    <Button size="sm" variant="secondary" onClick={() => setQuery("")}>
                      清除搜索
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <ul className="flex list-none flex-col p-0">
                {visibleRows.map((row) => (
                  <BotDirectoryRow
                    key={row.bot.ref.agentId}
                    row={row}
                    onOpenChats={onOpenChats}
                    onEdit={onEditBot ?? setEditingBotRef}
                    onSave={onSave}
                    onSetShared={onSetShared}
                    sharingDisabled={loading || error !== null}
                    onRequestArchive={requestArchive}
                  />
                ))}
              </ul>
            </TabsContent>
          </Tabs>
        </div>
      ) : null}

      {error ? (
        <div className="mx-auto mt-4 flex max-w-[672px] items-start gap-2.5">
          <Alert variant="destructive" title="助手列表未更新">
            {error.message}
            <span className="block">{errorText(error)}</span>
          </Alert>
          <Button size="sm" variant="outline" onClick={onReload}>
            重试
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingArchiveBot !== null}
        onOpenChange={(open) => {
          if (!open) closeArchive();
        }}
        title={pendingArchiveBot !== null ? `归档“${pendingArchiveBot.name}”？` : "归档 Bot？"}
        description={
          <span className="flex flex-col gap-2">
            <span>
              该 Bot 将被标记为归档，不会再出现在 Bot 列表中。历史 Chat 与记录不受影响。可在
              Provider 控制台恢复。
            </span>
            {archiveError !== null ? (
              <Alert variant="destructive" title="归档失败">
                {errorText(archiveError)}
              </Alert>
            ) : null}
          </span>
        }
        confirmLabel="归档 Bot"
        confirmVariant="destructive"
        pending={archiving}
        onConfirm={(event) => {
          // 阻止 Radix AlertDialogAction 点击即关闭：失败时弹窗保持打开展示错误，
          // 成功/取消由 confirmArchive/closeArchive 显式关闭。
          event?.preventDefault();
          void confirmArchive();
        }}
        onCancel={closeArchive}
      />
    </section>
  );
}
