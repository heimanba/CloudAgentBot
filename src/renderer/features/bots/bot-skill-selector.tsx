import { useEffect, useId, useState } from "react";
import { ChevronRight, Plus, Search } from "lucide-react";
import type { BotSkillOption, BotSkillRef, HostError, SkillCatalogEntry } from "@shared/models";
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
} from "../../ui/design-system";

const MAX_SKILLS = 20;
type SkillTab = "installed" | "marketplace";

function keyOf(skill: BotSkillRef): string {
  return `${skill.type}:${skill.skillId}`;
}

function formatDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function metadataText(
  skill: BotSkillOption,
  selected: BotSkillRef | undefined,
  availability: "available" | "verifying" | "unknown" | "unavailable",
) {
  if (availability === "verifying") return "正在验证可用性";
  if (availability === "unknown") return "暂时无法验证";
  if (availability === "unavailable") return "当前不可用";
  const parts = [skill.type === "official" ? "官方" : "自定义"];
  if (selected?.version && skill.latestVersion && selected.version !== skill.latestVersion) {
    parts.push(`已绑定 ${selected.version}`, `最新 ${skill.latestVersion}`);
  } else if (selected?.version) parts.push(`当前版本 ${selected.version}`);
  else if (skill.latestVersion) parts.push(`最新 ${skill.latestVersion}`);
  const date = formatDate(skill.updatedAt);
  if (date) parts.push(`${date} 更新`);
  return parts.join(" · ");
}

function normalizedSkillName(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_-]+/g, "-");
}

function findInstalledMarketplaceSkill(
  marketSkill: SkillCatalogEntry,
  installed: BotSkillOption[],
): BotSkillOption | undefined {
  return installed.find(
    (skill) =>
      (marketSkill.addedRef && keyOf(skill) === keyOf(marketSkill.addedRef)) ||
      skill.marketplaceSkillId === marketSkill.catalogId ||
      [marketSkill.sourceName, marketSkill.name]
        .map(normalizedSkillName)
        .filter(Boolean)
        .includes(normalizedSkillName(skill.name)),
  );
}

function MarketplaceList({
  marketplace,
  query,
  installError,
  installed,
  selectedKeys,
  onSelectExisting,
  onInstall,
}: {
  marketplace: {
    loading: boolean;
    options: SkillCatalogEntry[];
    error: HostError | null;
    installingId: string | null;
    search(query?: string): Promise<void>;
  };
  query: string;
  installError: HostError | null;
  installed: BotSkillOption[];
  selectedKeys: Set<string>;
  onSelectExisting(skill: BotSkillOption): void;
  onInstall(skill: SkillCatalogEntry): Promise<void>;
}) {
  if (marketplace.loading && marketplace.options.length === 0) {
    return <p className="type-supporting text-muted-foreground">正在加载技能广场…</p>;
  }
  if (marketplace.error) {
    return (
      <Alert variant="warning" title="技能广场暂时不可用">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void marketplace.search(query)}
        >
          重试
        </Button>
      </Alert>
    );
  }
  return (
    <div>
      {installError ? (
        <Alert variant="destructive" title="安装 Skill 失败">
          请稍后重试。
        </Alert>
      ) : null}
      {marketplace.options.length === 0 ? (
        <p className="type-supporting text-muted-foreground">没有找到匹配的市场 Skill。</p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 py-1 sm:grid-cols-2">
        {marketplace.options.map((skill) => {
          const installedSkill = findInstalledMarketplaceSkill(skill, installed);
          const selected = installedSkill ? selectedKeys.has(keyOf(installedSkill)) : false;
          return (
            <article
              key={skill.catalogId}
              className="flex min-h-36 flex-col rounded-lg border border-border p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="m-0 line-clamp-1 type-control">{skill.name}</h3>
                <span className="shrink-0 type-caption text-muted-foreground">
                  {installedSkill
                    ? "已添加"
                    : skill.installCount !== undefined
                      ? `${skill.installCount.toLocaleString("zh-CN")} 次安装`
                      : ""}
                </span>
              </div>
              {skill.description ? (
                <p
                  className="mt-2 mb-3 line-clamp-2 type-supporting text-muted-foreground"
                  title={skill.description}
                >
                  {skill.description}
                </p>
              ) : null}
              <div className="mt-auto flex items-center justify-between gap-3">
                <span className="truncate type-caption text-muted-foreground">
                  {skill.author ? `By @${skill.author}` : (skill.version ?? "技能广场")}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  pending={!installedSkill && marketplace.installingId === skill.catalogId}
                  disabled={selected || (!installedSkill && marketplace.installingId !== null)}
                  onClick={() =>
                    installedSkill ? onSelectExisting(installedSkill) : void onInstall(skill)
                  }
                >
                  {selected
                    ? "已选择"
                    : installedSkill
                      ? "选择已有"
                      : marketplace.installingId === skill.catalogId
                        ? "安装中…"
                        : "安装并选择"}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function BotSkillSelector({
  value,
  options,
  loading,
  error,
  disabled,
  showScopeHint = true,
  onChange,
  onRetry,
  marketplace,
}: {
  value: BotSkillRef[];
  options: BotSkillOption[];
  loading: boolean;
  error: HostError | null;
  disabled: boolean;
  showScopeHint?: boolean;
  onChange(value: BotSkillRef[]): void;
  onRetry(): void;
  marketplace: {
    loaded: boolean;
    loading: boolean;
    options: SkillCatalogEntry[];
    error: HostError | null;
    installingId: string | null;
    search(query?: string): Promise<void>;
    install(skillId: string): Promise<BotSkillOption | null>;
  };
}) {
  const triggerId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<BotSkillRef[]>(value);
  const [newlyInstalled, setNewlyInstalled] = useState<BotSkillOption[]>([]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<SkillTab>("installed");
  const [installError, setInstallError] = useState<HostError | null>(null);
  const catalogLoaded = marketplace.loaded;
  const catalogLoading = marketplace.loading;
  const searchCatalog = marketplace.search;

  // 已有配置只持久化 Provider 引用，不持久化展示名。配置页挂载后立即读取目录，
  // 让触发器和“我的 Skills”都能恢复名称，而不是等用户切换到技能广场才加载。
  useEffect(() => {
    if (value.length > 0 && !catalogLoaded && !catalogLoading) {
      void searchCatalog();
    }
  }, [catalogLoaded, catalogLoading, searchCatalog, value.length]);

  const relevantKeys = new Set([...value, ...draft].map(keyOf));
  const selectedCatalogOptions: BotSkillOption[] = marketplace.options.flatMap((entry) => {
    if (!entry.addedRef || !relevantKeys.has(keyOf(entry.addedRef))) return [];
    return [
      {
        ...entry.addedRef,
        name: entry.name,
        ...(entry.description ? { description: entry.description } : {}),
        ...(entry.version ? { latestVersion: entry.version } : {}),
      },
    ];
  });
  const optionByKey = new Map(
    [...options, ...selectedCatalogOptions, ...newlyInstalled].map(
      (option) => [keyOf(option), option] as const,
    ),
  );

  const openDialog = () => {
    setDraft(value);
    setQuery("");
    setTab("installed");
    setInstallError(null);
    setOpen(true);
    if (!marketplace.loaded || query.trim() !== "") void marketplace.search();
  };
  const selectedByKey = new Map(draft.map((skill) => [keyOf(skill), skill]));
  const sortedOptions = [...optionByKey.values()].sort((left, right) => {
    const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : 0;
    const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : 0;
    return rightTime - leftTime;
  });
  const rows: BotSkillOption[] = [
    ...draft
      .filter((skill) => !optionByKey.has(keyOf(skill)))
      .map((skill) => ({ ...skill, name: skill.skillId })),
    ...sortedOptions.map((option) => ({ ...option, ...selectedByKey.get(keyOf(option)) })),
  ];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredRows = rows.filter((skill) => {
    if (!normalizedQuery) return true;
    return [skill.name, skill.description, skill.skillId].some((field) =>
      field?.toLocaleLowerCase().includes(normalizedQuery),
    );
  });
  const selectedNames = value.map((skill) => optionByKey.get(keyOf(skill))?.name ?? skill.skillId);
  const selectionSummary =
    selectedNames.length === 0
      ? "添加 Skills"
      : selectedNames.length <= 2
        ? selectedNames.join("、")
        : `${selectedNames.slice(0, 2).join("、")} 等 ${selectedNames.length} 个`;

  return (
    <Field>
      <FieldLabel htmlFor={triggerId}>Skills（可选）</FieldLabel>
      <Button
        id={triggerId}
        type="button"
        variant="outline"
        className="h-auto min-h-[var(--control-lg)] w-full justify-between px-3 py-2.5 text-left"
        onClick={openDialog}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="block truncate type-control">{selectionSummary}</span>
          <span className="block type-caption text-muted-foreground">
            {value.length === 0
              ? "从我的 Skills 或技能广场添加"
              : `已选择 ${value.length}/${MAX_SKILLS}`}
          </span>
        </span>
        {value.length === 0 ? (
          <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </Button>
      {showScopeHint ? (
        <FieldDescription>配置同步后仅用于新建 Chat，已有 Chat 保持原配置。</FieldDescription>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[min(680px,calc(100vh-48px))] max-w-[min(640px,calc(100vw-28px))]">
          <div className="border-b border-border px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle className="type-section-title">选择 Skills</DialogTitle>
                <DialogDescription className="mt-1 type-supporting text-muted-foreground">
                  从我的 Skills 选择，或从技能广场添加。
                </DialogDescription>
              </div>
              <span className="type-supporting text-muted-foreground">
                已选择 {draft.length}/{MAX_SKILLS}
              </span>
            </div>
            <div
              className="mt-4 flex gap-1 border-b border-border"
              role="tablist"
              aria-label="Skill 来源"
            >
              {(["installed", "marketplace"] as SkillTab[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={tab === item}
                  className={`border-b-2 px-3 py-2 type-control ${
                    tab === item
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground"
                  }`}
                  onClick={() => {
                    setTab(item);
                    setQuery("");
                    if (item === "marketplace" && !marketplace.loaded) {
                      void marketplace.search();
                    } else if (item === "installed" && query.trim() !== "") {
                      // 市场搜索结果是过滤集合；回到“我的 Skills”前恢复完整目录，
                      // 避免把未命中当前搜索的已绑定引用误判为不可用。
                      void marketplace.search();
                    }
                  }}
                >
                  {item === "installed" ? "我的 Skills" : "技能广场"}
                </button>
              ))}
            </div>
            <div className="relative mt-4">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && tab === "marketplace") {
                    event.preventDefault();
                    void marketplace.search(query);
                  }
                }}
                placeholder="搜索名称、描述或 Skill ID"
                className="pl-9"
                aria-label="搜索 Skills"
              />
            </div>
            {tab === "marketplace" ? (
              <p className="mt-3 type-caption text-muted-foreground">
                安装会将 Skill 添加到当前 Connection 的“我的 Skills”；取消本次选择不会卸载。
              </p>
            ) : null}
            {tab === "marketplace" ? (
              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void marketplace.search(query)}
                >
                  搜索市场
                </Button>
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
            {tab === "marketplace" ? (
              <MarketplaceList
                marketplace={marketplace}
                query={query}
                installError={installError}
                installed={[...optionByKey.values()]}
                selectedKeys={new Set(draft.map(keyOf))}
                onSelectExisting={(installed) => {
                  if (
                    draft.length >= MAX_SKILLS ||
                    draft.some((item) => keyOf(item) === keyOf(installed))
                  )
                    return;
                  setDraft([...draft, installed]);
                  setTab("installed");
                }}
                onInstall={async (skill) => {
                  setInstallError(null);
                  try {
                    const installed = await marketplace.install(skill.catalogId);
                    if (!installed) return;
                    const key = keyOf(installed);
                    setNewlyInstalled((current) => [
                      ...current.filter((item) => keyOf(item) !== key),
                      installed,
                    ]);
                    if (!draft.some((item) => keyOf(item) === key) && draft.length < MAX_SKILLS) {
                      setDraft([...draft, installed]);
                    }
                    setTab("installed");
                  } catch (error) {
                    setInstallError(
                      typeof error === "object" && error !== null && "code" in error
                        ? (error as HostError)
                        : { code: "unavailable", message: "install marketplace skill failed" },
                    );
                  }
                }}
              />
            ) : (
              <>
                {loading && rows.length === 0 ? (
                  <p className="type-supporting text-muted-foreground" role="status">
                    正在加载 Skills…
                  </p>
                ) : null}
                {error !== null ? (
                  <Alert variant="warning" title="无法加载 Skill 列表">
                    <div className="flex items-center justify-between gap-3">
                      <span>当前已选择的 Skill 不受影响。</span>
                      <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
                        重试
                      </Button>
                    </div>
                  </Alert>
                ) : null}
                {!loading && error === null && rows.length === 0 ? (
                  <p className="type-supporting text-muted-foreground">
                    当前 Connection 没有可用 Skill。
                  </p>
                ) : null}
                {rows.length > 0 && filteredRows.length === 0 ? (
                  <p className="type-supporting text-muted-foreground">
                    没有匹配“{query.trim()}”的 Skill。
                  </p>
                ) : null}
                <div className="divide-y divide-border">
                  {filteredRows.map((skill) => {
                    const key = keyOf(skill);
                    const selected = selectedByKey.get(key);
                    const checked = selected !== undefined;
                    const availability = optionByKey.has(key)
                      ? "available"
                      : loading || marketplace.loading || !marketplace.loaded
                        ? "verifying"
                        : error !== null || marketplace.error !== null
                          ? "unknown"
                          : "unavailable";
                    const limitReached = draft.length >= MAX_SKILLS && !checked;
                    return (
                      <label key={key} className="flex cursor-pointer items-start gap-3 py-3.5">
                        <Checkbox
                          checked={checked}
                          disabled={limitReached}
                          onCheckedChange={(next) => {
                            if (next === true && !limitReached) setDraft([...draft, skill]);
                            else if (next === false)
                              setDraft(draft.filter((item) => keyOf(item) !== key));
                          }}
                          aria-label={skill.name}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-3">
                            <span className="truncate type-control">{skill.name}</span>
                            <span className="shrink-0 type-caption text-muted-foreground">
                              {skill.type === "official" ? "官方" : "自定义"}
                            </span>
                          </span>
                          {skill.description ? (
                            <span
                              className="mt-0.5 line-clamp-1 block type-supporting text-muted-foreground"
                              title={skill.description}
                            >
                              {skill.description}
                            </span>
                          ) : null}
                          <span className="mt-1 block type-caption text-muted-foreground">
                            {metadataText(skill, selected, availability)}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
            >
              确认选择（{draft.length}）
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Field>
  );
}
