import { useEffect, useMemo, useState } from "react";
import type { ChatArtifactView, ChatRef, ChatTimelineItemView, HostError } from "@shared/models";
import { Download, Maximize2, Minimize2, X } from "lucide-react";
import {
  Alert,
  Button,
  CopyAction,
  RefreshAction,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../ui/design-system";
import { getDesktopHost } from "../../desktop-host";
import { cn } from "../../lib/utils";
import { ChatContent } from "./chat-content";

type ArtifactItem = Extract<ChatTimelineItemView, { kind: "artifact" }>;

export type ArtifactWorkspaceLayout = "sheet" | "inline";

const PREVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline' data: blob: http: https:; img-src data: blob: http: https:; font-src data: http: https:; media-src data: blob: http: https:";

function isHtml(artifact: ChatArtifactView | ArtifactItem): boolean {
  return (
    (artifact.contentType ?? "").toLowerCase().includes("html") ||
    /\.html?$/i.test(artifact.filename)
  );
}

function isRasterImage(artifact: ChatArtifactView | ArtifactItem): boolean {
  const contentType = (artifact.contentType ?? "").toLowerCase().split(";")[0];
  const previewableImageType = ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(contentType);
  return (
    previewableImageType || /\.(png|jpe?g|gif|webp)$/i.test(artifact.filename)
  );
}

function isSvg(artifact: ChatArtifactView | ArtifactItem): boolean {
  const contentType = (artifact.contentType ?? "").toLowerCase().split(";")[0];
  return contentType === "image/svg+xml" || /\.svg$/i.test(artifact.filename);
}

function isMarkdown(artifact: ChatArtifactView | ArtifactItem): boolean {
  const contentType = (artifact.contentType ?? "").toLowerCase().split(";")[0];
  return (
    ["text/markdown", "text/x-markdown", "application/markdown"].includes(contentType) ||
    /\.(md|markdown)$/i.test(artifact.filename)
  );
}

function countExternalScripts(content: string): number {
  return new DOMParser().parseFromString(content, "text/html").querySelectorAll("script[src]")
    .length;
}

function artifactErrorText(error: HostError): string {
  if (error.code === "not-found") return "这个产物不存在，或不属于当前任务。";
  if (error.code === "permission" || error.code === "authentication")
    return "没有权限访问这个产物，请重新连接后重试。";
  return "暂时无法获取这个产物，请稍后重试。";
}

export function ArtifactWorkspace({
  artifact,
  chatRef,
  open,
  onClose,
  layout = "sheet",
  fullscreen = false,
  onToggleFullscreen,
}: {
  artifact: ArtifactItem;
  chatRef: ChatRef;
  open: boolean;
  onClose(): void;
  layout?: ArtifactWorkspaceLayout;
  fullscreen?: boolean;
  onToggleFullscreen?(): void;
}) {
  const [data, setData] = useState<ChatArtifactView | null>(null);
  const [error, setError] = useState<HostError | null>(null);
  const [loading, setLoading] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [imageLoadError, setImageLoadError] = useState(false);

  useEffect(() => {
    if (!open || artifact.fileId.length === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const { getArtifact } = getDesktopHost().chats;
      if (typeof getArtifact !== "function") {
        setUnsupported(true);
        setLoading(false);
        return;
      }
      setUnsupported(false);
      getArtifact(chatRef, artifact.fileId, { includeContent: true })
        .then((result) => {
          if (!cancelled) {
            setData(result);
            setImageLoadError(false);
            setLoading(false);
          }
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setData(null);
          setLoading(false);
          setError(
            cause && typeof cause === "object" && "code" in cause
              ? (cause as HostError)
              : { code: "unavailable", message: "artifact unavailable" },
          );
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [artifact.fileId, chatRef, open, reloadToken]);

  const externalScripts = useMemo(
    () => (data?.content === undefined ? 0 : countExternalScripts(data.content)),
    [data],
  );
  const activeArtifact = data ?? artifact;
  const imagePreview = isRasterImage(activeArtifact);
  const svgPreview = isSvg(activeArtifact);
  const markdownPreview = isMarkdown(activeArtifact);
  const previewImageUrl = useMemo(() => {
    if (data?.previewData !== undefined) {
      return URL.createObjectURL(
        new Blob([data.previewData.bytes], { type: data.previewData.contentType }),
      );
    }
    if (data?.content !== undefined && isSvg(data)) {
      return URL.createObjectURL(new Blob([data.content], { type: "image/svg+xml" }));
    }
    return null;
  }, [data]);
  useEffect(() => {
    if (previewImageUrl === null) return;
    return () => URL.revokeObjectURL(previewImageUrl);
  }, [previewImageUrl]);
  const previewNotice = imagePreview
    ? "图片预览"
    : svgPreview
      ? "SVG 图片预览：脚本已禁用"
      : markdownPreview
        ? "文档预览"
    : externalScripts > 0
      ? `安全预览：已禁用 ${externalScripts} 个外部脚本`
      : "安全预览：脚本已禁用";

  const openDownload = () => {
    if (data?.downloadUrl) {
      window.open(data.downloadUrl, "_blank", "noopener,noreferrer");
    }
  };


  const workspace = (
    <>
      <SheetHeader
        className={cn(
          "flex-row items-center justify-between gap-3 border-b border-border/70 px-4 py-3 pr-3",
          layout === "inline" && "app-chat-topbar",
        )}
      >
        <div className="app-chat-topbar min-w-0">
          {layout === "sheet" ? (
            <SheetTitle className="truncate" title={artifact.filename}>
              {artifact.filename}
            </SheetTitle>
          ) : (
            <h2 className="truncate type-section-title font-semibold" title={artifact.filename}>
              {artifact.filename}
            </h2>
          )}
          {layout === "sheet" ? (
            <SheetDescription>
              {previewNotice}
            </SheetDescription>
          ) : (
            <p className="type-supporting text-muted-foreground">
              {previewNotice}
            </p>
          )}
        </div>
        {layout === "inline" ? (
          <>
            <div
              className="min-w-0 flex-1 self-stretch [-webkit-app-region:drag]"
              data-slot="window-drag-region"
              aria-hidden="true"
            />
            <div className="flex shrink-0 items-center gap-1">
              {onToggleFullscreen ? (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={onToggleFullscreen}
                  aria-label={fullscreen ? "退出全屏" : "全屏展示"}
                  title={fullscreen ? "退出全屏" : "全屏展示"}
                >
                  {fullscreen ? (
                    <Minimize2 className="size-[14px]" aria-hidden="true" />
                  ) : (
                    <Maximize2 className="size-[14px]" aria-hidden="true" />
                  )}
                </Button>
              ) : null}
              <Button
                size="icon"
                variant="ghost"
                onClick={onClose}
                aria-label="关闭产物预览"
                title="关闭产物预览"
              >
                <X className="size-[14px]" aria-hidden="true" />
              </Button>
            </div>
          </>
        ) : null}
      </SheetHeader>
      <Tabs defaultValue="preview" className="flex min-h-0 flex-1 flex-col">
        <div className="app-chat-topbar flex min-h-[44px] shrink-0 items-center justify-between gap-2 border-b border-border/70 px-4 py-1.5">
          {isHtml(activeArtifact) ? (
            <TabsList className="w-[176px]">
              <TabsTrigger value="preview">预览</TabsTrigger>
              <TabsTrigger value="source">源码</TabsTrigger>
            </TabsList>
          ) : (
            <span className="type-supporting text-muted-foreground">
              {imagePreview || svgPreview ? "图片" : markdownPreview ? "文档" : "文件"}
            </span>
          )}
          <div className="flex items-center gap-1">
            <RefreshAction
              label="重新获取产物"
              refreshing={loading}
              onRefresh={() => setReloadToken((token) => token + 1)}
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={openDownload}
              disabled={!data}
              aria-label="下载产物"
              title="下载产物"
            >
              <Download className="size-[14px]" aria-hidden="true" />
            </Button>
          </div>
        </div>
        {loading ? (
          <p className="px-4 type-supporting text-muted-foreground" role="status">
            正在获取产物…
          </p>
        ) : null}
        {error ? (
          <div className="px-4">
            <Alert variant="destructive" title="无法预览产物">
              {artifactErrorText(error)}
            </Alert>
          </div>
        ) : null}
        {unsupported ? (
          <div className="px-4">
            <Alert title="需要重启应用">
              当前应用进程还在使用旧版下载能力。请退出并重新启动 CloudAgentBot，然后再预览产物。
            </Alert>
          </div>
        ) : null}
        {!loading && !error && data?.content !== undefined && isHtml(activeArtifact) ? (
          <>
            <TabsContent value="preview" className="min-h-0 flex-1">
              <iframe
                title={`${artifact.filename} 安全预览`}
                srcDoc={data.content}
                sandbox=""
                className="h-full w-full border-0 bg-white"
                {...({ csp: PREVIEW_CSP } as Record<string, string>)}
              />
            </TabsContent>
            <TabsContent value="source" className="min-h-0 flex-1 overflow-hidden">
              <div className="relative h-full overflow-auto px-4 pb-4">
                <CopyAction
                  value={data.content}
                  label="复制 HTML 源码"
                  className="absolute top-2 right-6"
                />
                <pre className="m-0 whitespace-pre-wrap break-words font-mono type-supporting">
                  {data.content}
                </pre>
              </div>
            </TabsContent>
          </>
        ) : null}
        {!loading && !error ? (
          (imagePreview || svgPreview) && previewImageUrl !== null ? (
            <TabsContent value="preview" className="min-h-0 flex-1">
              <div className="flex h-full items-center justify-center overflow-auto bg-muted/20 p-4">
                {imageLoadError ? (
                  <Alert title="图片解码失败">可以下载后在本地应用中查看这个文件。</Alert>
                ) : (
                  <img
                    src={previewImageUrl}
                    alt={artifact.filename}
                    className="max-h-full max-w-full object-contain"
                    onError={() => setImageLoadError(true)}
                  />
                )}
              </div>
            </TabsContent>
          ) : imagePreview && data !== null ? (
            <div className="px-4">
              <Alert title="需要重启应用">
                当前应用进程还在使用旧版图片预览能力。请退出并重新启动 CloudAgentBot，然后再预览产物。
              </Alert>
            </div>
          ) : markdownPreview && data?.content !== undefined ? (
            <TabsContent value="preview" className="min-h-0 flex-1 overflow-auto">
              <div className="h-full px-4 pb-4">
                <ChatContent content={data.content} className="max-w-none" />
              </div>
            </TabsContent>
          ) : data?.content === undefined ? (
            <div className="px-4">
              <Alert title="暂不支持内置预览">可以下载后在本地应用中查看这个文件。</Alert>
            </div>
          ) : null
        ) : null}
      </Tabs>
    </>
  );

  if (layout === "inline") {
    return (
      <aside
        className="flex h-full min-w-[360px] flex-1 flex-col bg-card max-md:fixed max-md:inset-0 max-md:min-w-0 max-md:z-50"
        aria-label="产物预览"
      >
        {workspace}
      </aside>
    );
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full gap-0 border-l-0 pr-12 sm:max-w-[min(760px,90vw)]">
        {workspace}
      </SheetContent>
    </Sheet>
  );
}
