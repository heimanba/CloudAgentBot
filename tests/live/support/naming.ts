const STAMP_LENGTH = 14;
const DEFAULT_SUFFIX_LENGTH = 8;

/** UTC 时间戳（yyyymmddhhmmss），与既有 live 资源命名格式一致。 */
export function testRunStamp(now: Date = new Date()): string {
  return now
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, STAMP_LENGTH);
}

/** 小写字母数字随机后缀，长度精确可控（单个 32 进制片段不足时追加生成）。 */
export function testRunSuffix(length: number = DEFAULT_SUFFIX_LENGTH): string {
  let suffix = "";
  while (suffix.length < length) {
    suffix += Math.random().toString(36).slice(2);
  }
  return suffix.slice(0, length);
}

/** 唯一测试前缀：openagentbot-<label>-<stamp>-<suffix>；资源名与 metadata test_run 共用。 */
export function uniqueTestPrefix(label: string, now: Date = new Date()): string {
  return `openagentbot-${label}-${testRunStamp(now)}-${testRunSuffix()}`;
}
