import { useCallback, useRef, useState } from "react";
import type { HostError, MessageAttachment } from "@shared/models";
import {
  FileCode2,
  FileCog,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Paperclip,
  X,
} from "lucide-react";
import { getDesktopHost } from "../../desktop-host";
import { Button } from "../../ui/design-system";
import { cn } from "../../lib/utils";

/** 单文件上限：与 Main 校验一致（百炼 multipart 直传 50 MB）。 */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const IMAGE_EXTENSIONS = new Set([
  "svg", "png", "jpg", "jpeg", "gif", "bmp", "webp", "avif", "ico", "tif", "tiff", "heic", "heif",
]);
const SPREADSHEET_EXTENSIONS = new Set(["csv"]);
const DATA_EXTENSIONS = new Set(["json", "xml", "yaml", "yml", "graphql", "gql"]);
const CONFIG_EXTENSIONS = new Set([
  "toml", "ini", "conf", "cfg", "env", "dockerfile", "makefile", "gitignore", "editorconfig",
  "eslintrc", "prettierrc",
]);
const CODE_EXTENSIONS = new Set([
  "html", "htm", "css", "scss", "less", "js", "jsx", "ts", "tsx", "vue", "svelte", "py",
  "go", "rs", "java", "kt", "scala", "c", "cpp", "cc", "h", "hpp", "rb", "php", "swift",
  "r", "lua", "pl", "sh", "bash", "zsh", "fish", "ps1", "sql", "proto",
]);

const BAILIAN_SUPPORTED_EXTENSIONS = new Set<string>([
  "txt", "md", "csv", "json", "xml", "yaml", "yml", "toml", "ini", "conf", "cfg",
  "env", "log", "html", "htm", "css", "scss", "less", "js", "jsx", "ts", "tsx",
  "vue", "svelte", "py", "go", "rs", "java", "kt", "scala", "c", "cpp", "cc", "h",
  "hpp", "rb", "php", "swift", "r", "lua", "pl", "sh", "bash", "zsh", "fish", "ps1",
  "sql", "graphql", "gql", "proto", "dockerfile", "makefile", "gitignore", "editorconfig",
  "eslintrc", "prettierrc", "tex", "rst", "adoc", "org", "svg",
  "png", "jpg", "jpeg", "gif", "bmp", "webp", "avif", "ico", "tif", "tiff", "heic", "heif",
]);

const QODER_SUPPORTED_EXTENSIONS = new Set<string>([
  "txt", "md", "csv", "json", "xml", "yaml", "yml", "toml", "ini", "conf", "cfg",
  "env", "log", "html", "htm", "css", "scss", "less", "js", "jsx", "ts", "tsx",
  "vue", "svelte", "py", "go", "rs", "java", "kt", "scala", "c", "cpp", "cc", "h",
  "hpp", "rb", "php", "swift", "r", "lua", "pl", "sh", "bash", "zsh", "fish", "ps1",
  "sql", "graphql", "gql", "proto", "dockerfile", "makefile", "gitignore", "editorconfig",
  "eslintrc", "prettierrc", "tex", "rst", "adoc", "org", "svg",
  "png", "jpg", "jpeg", "gif", "bmp", "webp", "avif", "ico", "tif", "tiff", "heic", "heif",
]);

function supportedExtensions(provider?: string): Set<string> {
  return provider === "qoder" ? QODER_SUPPORTED_EXTENSIONS : BAILIAN_SUPPORTED_EXTENSIONS;
}

function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

export function attachmentTypeLabel(filename: string, mimeType?: string): string {
  const extension = fileExtension(filename);
  if (extension) return extension.toUpperCase();
  const subtype = mimeType?.split("/", 2)[1]?.split(/[;+]/, 1)[0];
  return subtype ? subtype.toUpperCase() : "文件";
}

export function AttachmentTypeIcon({
  filename,
  mimeType,
  kind,
  className,
}: {
  filename: string;
  mimeType?: string;
  kind?: "image" | "video" | "file";
  className?: string;
}) {
  const extension = fileExtension(filename);
  const isImage =
    kind === "image" || mimeType?.startsWith("image/") || IMAGE_EXTENSIONS.has(extension);
  const isVideo = kind === "video" || mimeType?.startsWith("video/");
  const Icon = isImage
    ? FileImage
    : isVideo
      ? FileVideo
      : SPREADSHEET_EXTENSIONS.has(extension)
        ? FileSpreadsheet
        : DATA_EXTENSIONS.has(extension)
          ? FileJson
          : CONFIG_EXTENSIONS.has(extension)
            ? FileCog
            : CODE_EXTENSIONS.has(extension)
              ? FileCode2
              : FileText;
  const iconType = isImage
    ? "image"
    : isVideo
      ? "video"
      : SPREADSHEET_EXTENSIONS.has(extension)
        ? "spreadsheet"
        : DATA_EXTENSIONS.has(extension)
          ? "data"
          : CONFIG_EXTENSIONS.has(extension)
            ? "config"
            : CODE_EXTENSIONS.has(extension)
              ? "code"
              : "text";

  return (
    <Icon
      className={cn("size-3 shrink-0 text-muted-foreground", className)}
      data-file-icon={iconType}
      aria-hidden="true"
    />
  );
}

function acceptAttr(provider?: string): string {
  return Array.from(supportedExtensions(provider), (ext) => `.${ext}`).join(",");
}

function unsupportedFileError(filename: string, provider?: string): HostError | null {
  const ext = fileExtension(filename);
  if (ext && supportedExtensions(provider).has(ext)) return null;
  return { code: "invalid-input", message: "不支持的文件类型" };
}

export interface AttachmentDraft {
  localId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: "pending" | "uploading" | "ready" | "error";
  file: File;
  fileId?: string;
  error?: HostError;
}

export interface UseAttachmentsResult {
  items: AttachmentDraft[];
  uploading: boolean;
  addFiles(files: FileList | File[]): void;
  uploadAll(): Promise<MessageAttachment[] | null>;
  remove(localId: string): void;
  clear(): void;
}

/** 文件选择只保存在 Renderer 草稿中；用户发送时才上传到 Provider。 */
export function useAttachments(connectionId: string | null, provider?: string): UseAttachmentsResult {
  const [items, setItems] = useState<AttachmentDraft[]>([]);
  const counter = useRef(0);
  const uploadingRef = useRef(false);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const drafts = Array.from(files, (file): AttachmentDraft => {
        const draft: AttachmentDraft = {
          localId: `att_${Date.now()}_${(counter.current += 1)}`,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          status: "pending",
          file,
        };
        if (file.size === 0 || file.size > MAX_FILE_BYTES) {
          return {
            ...draft,
            status: "error",
            error: { code: "invalid-input", message: "文件为空或超过 50MB 上限" },
          };
        }
        const typeError = unsupportedFileError(file.name, provider);
        return typeError ? { ...draft, status: "error", error: typeError } : draft;
      });
      setItems((previous) => [...previous, ...drafts]);
    },
    [provider],
  );

  const uploadAll = useCallback(async (): Promise<MessageAttachment[] | null> => {
    if (uploadingRef.current) return null;
    if (items.length === 0) return [];
    if (connectionId === null || items.some((item) => item.error?.code === "invalid-input")) {
      return null;
    }

    uploadingRef.current = true;
    setItems((previous) =>
      previous.map((item) =>
        item.status === "ready" ? item : { ...item, status: "uploading", error: undefined },
      ),
    );
    try {
      const uploadedItems = await Promise.all(
        items.map(async (item): Promise<MessageAttachment | null> => {
          if (item.status === "ready" && item.fileId) {
            return {
              fileId: item.fileId,
              filename: item.filename,
              ...(item.mimeType ? { mimeType: item.mimeType } : {}),
            };
          }
          try {
            const uploaded = await getDesktopHost().chats.uploadFile(connectionId, {
              filename: item.filename,
              mimeType: item.mimeType,
              bytes: await item.file.arrayBuffer(),
            });
            setItems((previous) =>
              previous.map((entry) =>
                entry.localId === item.localId
                  ? { ...entry, status: "ready", fileId: uploaded.fileId, error: undefined }
                  : entry,
              ),
            );
            return {
              fileId: uploaded.fileId,
              filename: item.filename,
              ...(item.mimeType ? { mimeType: item.mimeType } : {}),
            };
          } catch (cause) {
            const error: HostError =
              cause && typeof cause === "object" && "code" in cause
                ? (cause as HostError)
                : { code: "unavailable", message: "上传失败" };
            setItems((previous) =>
              previous.map((entry) =>
                entry.localId === item.localId ? { ...entry, status: "error", error } : entry,
              ),
            );
            return null;
          }
        }),
      );
      return uploadedItems.every((item) => item !== null)
        ? (uploadedItems as MessageAttachment[])
        : null;
    } finally {
      uploadingRef.current = false;
    }
  }, [connectionId, items]);

  const remove = useCallback((localId: string) => {
    setItems((previous) => previous.filter((item) => item.localId !== localId));
  }, []);

  const clear = useCallback(() => setItems([]), []);
  const uploading = items.some((item) => item.status === "uploading");

  return { items, uploading, addFiles, uploadAll, remove, clear };
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

export function AttachmentChips({
  items,
  onRemove,
  disabled,
}: {
  items: AttachmentDraft[];
  onRemove(localId: string): void;
  disabled?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5" aria-label="附件">
      {items.map((item) => (
        <span
          key={item.localId}
          className="inline-flex max-w-[220px] items-center gap-1.5 rounded-[var(--radius-md)] bg-surface-subtle px-2 py-1 type-caption"
          title={
            item.status === "error"
              ? `${item.filename}：${item.error?.message ?? "上传失败"}`
              : item.filename
          }
        >
          <AttachmentTypeIcon filename={item.filename} mimeType={item.mimeType} />
          <span className="min-w-0 truncate">{item.filename}</span>
          <span className="shrink-0 text-muted-foreground">
            {attachmentTypeLabel(item.filename, item.mimeType)}
          </span>
          <span className="shrink-0 text-muted-foreground">
            {item.status === "uploading"
              ? "上传中…"
              : item.status === "error"
                ? "失败"
                : formatSize(item.sizeBytes)}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="size-4 shrink-0"
            disabled={disabled}
            aria-label={`移除附件 ${item.filename}`}
            onClick={() => onRemove(item.localId)}
          >
            <X className="size-3" aria-hidden="true" />
          </Button>
        </span>
      ))}
    </div>
  );
}

export function AttachButton({
  onFiles,
  provider,
  disabled,
  className,
}: {
  onFiles(files: FileList): void;
  provider?: string;
  disabled?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={acceptAttr(provider)}
        className="hidden"
        aria-hidden="true"
        onChange={(event) => {
          if (event.target.files && event.target.files.length > 0) onFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className={className}
        disabled={disabled}
        aria-label="添加附件"
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="size-[16px]" aria-hidden="true" />
      </Button>
    </>
  );
}
