/** Project Document 使用的工具名。Qoder 由 OpenAgentPack 转为 Provider 原生名称。 */
export const BAILIAN_DEFAULT_BUILTIN_TOOLS = ["bash", "write", "read", "edit", "glob", "grep"] as const;
export const BAILIAN_BUILTIN_TOOLS = [
  ...BAILIAN_DEFAULT_BUILTIN_TOOLS,
  "web_search", "web_fetch", "mark_artifacts",
] as const;
export const QODER_BUILTIN_TOOLS = [
  "bash",
  "read",
  "write",
  "edit",
  "glob",
  "grep",
  "web_fetch",
  "web_search",
  "image_search",
  "image_gen",
  "deliver_artifacts",
] as const;

export const BUILTIN_TOOL_LABELS: Record<string, { label: string; description: string }> = {
  bash: { label: "Bash", description: "执行 Shell 命令，可安装依赖、运行脚本或调用 API" },
  read: { label: "Read", description: "读取文件内容，用于查看代码或挂载文件" },
  write: { label: "Write", description: "创建或覆盖文件，用于生成报告和其他产物" },
  edit: { label: "Edit", description: "局部修改文件，用于调整代码或配置" },
  glob: { label: "Glob", description: "按通配符查找文件路径" },
  grep: { label: "Grep", description: "按关键词搜索文件内容" },
  web_fetch: { label: "WebFetch", description: "通过 HTTP GET 获取单个网页或文档" },
  web_search: { label: "WebSearch", description: "联网搜索网页和资料" },
  image_search: { label: "ImageSearch", description: "联网搜索任务所需的图片素材" },
  image_gen: { label: "ImageGen", description: "根据文字描述生成图片" },
  deliver_artifacts: { label: "DeliverArtifacts", description: "将 /data/ 下的文件投递给用户下载" },
  mark_artifacts: { label: "mark_artifacts", description: "标记对话生成的结果文件" },
};

export const BAILIAN_BUILTIN_TOOL_DESCRIPTIONS: Record<string, string> = {
  bash: "在沙箱中执行 Shell 命令，可运行脚本、安装包或调用 CLI",
  write: "写入文件，用于生成报告或保存中间结果",
  read: "读取文件内容，例如挂载的 CSV、日志或配置文件",
  edit: "按字符串替换修改文件，适合小范围改动",
  glob: "按模式查找文件，例如定位 *.csv 文件",
  grep: "在文件中搜索文本，用于排查日志或定位关键词",
  web_search: "搜索互联网信息，返回网页标题、链接和摘要",
  web_fetch: "读取指定网页的正文并转换为文本",
  mark_artifacts: "标记结果文件并返回 file_id，供业务侧下载或展示",
};

export function availableBuiltinTools(provider: string): readonly string[] {
  return provider === "bailian" ? BAILIAN_BUILTIN_TOOLS : QODER_BUILTIN_TOOLS;
}
