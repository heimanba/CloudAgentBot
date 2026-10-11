import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Plus, Search } from "lucide-react";
import type { BotMcpBinding, McpCatalogEntry, McpToolOption } from "@shared/models";
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
} from "../../ui/design-system";
import { getDesktopHost } from "../../desktop-host";

const MAX_MCP_SERVERS = 20;

export function BotMcpSelector({
  value,
  disabled,
  showScopeHint = true,
  onChange,
}: {
  value: BotMcpBinding[];
  disabled: boolean;
  showScopeHint?: boolean;
  onChange(value: BotMcpBinding[]): void;
}) {
  const triggerId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<McpCatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [configuringCode, setConfiguringCode] = useState<string | null>(null);
  const [toolOptions, setToolOptions] = useState<McpToolOption[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const timer = window.setTimeout(
      () => {
        const listCatalog = getDesktopHost().bots.listMcpCatalog;
        if (!listCatalog) {
          setError("当前版本不支持 MCP 广场。");
          return;
        }
        setLoading(true);
        setError(null);
        listCatalog(query.trim() || undefined)
          .then((items) => {
            if (active) setCatalog(items);
          })
          .catch(() => {
            if (active) setError("MCP 广场暂时无法加载，请稍后重试。");
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      },
      query ? 250 : 0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const entries = useMemo(() => {
    const selected = draft
      .filter(
        (server) =>
          !query || server.serverName.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      )
      .map<McpCatalogEntry>((server) => {
        const catalogEntry = catalog.find((entry) => entry.serverCode === server.serverCode);
        return {
          ...catalogEntry,
          serverCode: server.serverCode,
          serverName: server.serverName,
          hasFee: catalogEntry?.hasFee ?? false,
          hasFreePlan: catalogEntry?.hasFreePlan ?? false,
        };
      });
    return [
      ...selected,
      ...catalog.filter((entry) => !draft.some((server) => server.serverCode === entry.serverCode)),
    ];
  }, [catalog, draft, query]);
  const selectedToolCount = draft.reduce(
    (total, server) => total + server.tools.filter((tool) => tool.enabled).length,
    0,
  );

  const beginConfigure = async (entry: McpCatalogEntry) => {
    if (configuringCode === entry.serverCode) {
      setConfiguringCode(null);
      return;
    }
    setConfiguringCode(entry.serverCode);
    setError(null);
    const existing = draft.find((server) => server.serverCode === entry.serverCode);
    if (!existing && draft.length >= MAX_MCP_SERVERS) {
      setError(`最多添加 ${MAX_MCP_SERVERS} 个 MCP。`);
      setConfiguringCode(null);
      return;
    }
    setToolsLoading(true);
    setToolOptions([]);
    try {
      const listTools = getDesktopHost().bots.listMcpTools;
      if (!listTools) throw new Error("MCP catalog unavailable");
      const tools = await listTools(entry.serverCode);
      if (tools.length === 0) throw new Error("empty tool list");
      setToolOptions(tools);
    } catch {
      setError(`${entry.serverName} 的工具列表加载失败，请稍后重试。`);
      setConfiguringCode(null);
    } finally {
      setToolsLoading(false);
    }
  };

  const setServerTools = (entry: McpCatalogEntry, names: string[], enabled: boolean) => {
    setDraft((items) => {
      const index = items.findIndex((item) => item.serverCode === entry.serverCode);
      if (index < 0 && (!enabled || items.length >= MAX_MCP_SERVERS)) return items;
      const existing = items[index];
      const tools = [...(existing?.tools ?? [])];
      for (const name of names) {
        const toolIndex = tools.findIndex((tool) => tool.name === name);
        if (toolIndex < 0 && enabled) tools.push({ name, enabled: true });
        else if (toolIndex >= 0) tools[toolIndex] = { name, enabled };
      }
      if (!tools.some((tool) => tool.enabled)) return items.filter((item) => item.serverCode !== entry.serverCode);
      const binding: BotMcpBinding = existing
        ? { ...existing, tools }
        : {
            type: "official",
            serverCode: entry.serverCode,
            serverName: entry.serverName,
            permissionPolicy: "always_allow",
            tools,
          };
      return index < 0
        ? [...items, binding]
        : items.map((item) => (item.serverCode === entry.serverCode ? binding : item));
    });
  };

  const summary =
    value.length === 0
      ? "添加 MCP 服务"
      : value.length <= 2
        ? value.map((item) => item.serverName).join("、")
        : `${value
            .slice(0, 2)
            .map((item) => item.serverName)
            .join("、")} 等 ${value.length} 个`;

  return (
    <Field>
      <FieldLabel htmlFor={triggerId}>MCP（可选）</FieldLabel>
      <Button
        id={triggerId}
        type="button"
        variant="outline"
        className="h-auto min-h-[var(--control-lg)] w-full justify-between px-3 py-2.5 text-left"
        onClick={() => {
          setDraft(value);
          setQuery("");
          setConfiguringCode(null);
          setError(null);
          setOpen(true);
        }}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="block truncate type-control">{summary}</span>
          <span className="block type-caption text-muted-foreground">
            {value.length === 0 ? "浏览百炼公开 MCP 服务" : `已选择 ${value.length} 个`}
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
        <DialogContent className="max-h-[min(760px,calc(100vh-32px))] max-w-[min(760px,calc(100vw-28px))]">
          <div className="border-b border-border px-6 py-5">
            <DialogTitle className="type-section-title">选择 MCP 服务和工具</DialogTitle>
            <DialogDescription className="mt-1 type-supporting text-muted-foreground">
              展开服务，逐个添加工具，或一次添加全部工具。
            </DialogDescription>
            <p className="mt-2 type-caption text-muted-foreground">
              已选择 {draft.length}/{MAX_MCP_SERVERS} 个服务 · {selectedToolCount} 个工具
            </p>
          </div>
          <div className="flex max-h-[570px] flex-col gap-4 overflow-y-auto px-6 py-5">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索 MCP 服务"
                className="pl-9"
              />
            </div>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 type-supporting text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                正在加载 MCP 广场…
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {entries.map((entry) => {
                  const selected = draft.find((server) => server.serverCode === entry.serverCode);
                  const selectedToolNames = selected?.tools
                    .filter((tool) => tool.enabled)
                    .map((tool) => tool.name) ?? [];
                  const expanded = configuringCode === entry.serverCode;
                  const availableTools: McpToolOption[] = expanded
                    ? [
                        ...toolOptions,
                        ...(selected?.tools ?? [])
                          .filter((tool) => !toolOptions.some((option) => option.name === tool.name))
                          .map((tool) => ({ name: tool.name })),
                      ]
                    : [];
                  const allSelected =
                    availableTools.length > 0 &&
                    availableTools.every((tool) =>
                      selected?.tools.some((item) => item.name === tool.name && item.enabled),
                    );
                  return (
                    <article
                      key={entry.serverCode}
                      className={`flex flex-col rounded-lg border p-4 ${expanded ? "border-primary sm:col-span-2" : selected ? "border-primary/50" : "border-border"}`}
                    >
                      <button
                        type="button"
                        className="flex w-full items-start justify-between gap-3 text-left"
                        onClick={() => void beginConfigure(entry)}
                        aria-expanded={expanded}
                      >
                        <span className="min-w-0">
                          <span className="block type-control">{entry.serverName}</span>
                          <span
                            className="mt-1 line-clamp-2 block type-caption text-muted-foreground"
                            title={selected ? selectedToolNames.join("、") : entry.description}
                          >
                            {selected
                              ? `已选择 ${selectedToolNames.length} 个工具：${selectedToolNames.join("、")}`
                              : (entry.description ?? entry.sourceName ?? "百炼官方 MCP 服务")}
                          </span>
                          {entry.hasFee ? (
                            <span className="mt-1 block type-caption text-muted-foreground">
                              {entry.hasFreePlan ? "含免费额度 · 超出后可能收费" : "可能收费"}
                            </span>
                          ) : null}
                        </span>
                        <ChevronDown
                          className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
                        />
                      </button>
                      {expanded ? (
                        <div className="mt-4 border-t border-border pt-4">
                          {toolsLoading ? (
                            <div className="flex items-center gap-2 py-4 type-caption text-muted-foreground">
                              <Loader2 className="size-4 animate-spin" />
                              正在加载工具…
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div className="flex justify-end">
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled={availableTools.length === 0}
                                  onClick={() =>
                                    setServerTools(entry, availableTools.map((tool) => tool.name), !allSelected)
                                  }
                                >
                                  {allSelected ? "移除全部" : "添加全部"}
                                </Button>
                              </div>
                              <div className="grid gap-2">
                              {availableTools.map((tool) => {
                                const added =
                                  selected?.tools.some((item) => item.name === tool.name && item.enabled) ?? false;
                                return <div
                                  key={tool.name}
                                  className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2 type-caption"
                                >
                                  <span className="min-w-0">
                                    <span className="block truncate">{tool.name}</span>
                                    {tool.description ? (
                                      <span className="mt-0.5 line-clamp-2 block text-muted-foreground">
                                        {tool.description}
                                      </span>
                                    ) : null}
                                  </span>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="shrink-0"
                                    onClick={() => setServerTools(entry, [tool.name], !added)}
                                  >
                                    {added ? "移除" : "添加"}
                                  </Button>
                                </div>;
                              })}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
            {!loading && entries.length === 0 && !error ? (
              <p className="py-8 text-center type-supporting text-muted-foreground">
                没有找到匹配的 MCP 服务。
              </p>
            ) : null}
            {error ? (
              <Alert variant="destructive" title="MCP 加载失败">
                {error}
              </Alert>
            ) : null}
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
              确认选择（{draft.length} 个服务 · {selectedToolCount} 个工具）
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Field>
  );
}
