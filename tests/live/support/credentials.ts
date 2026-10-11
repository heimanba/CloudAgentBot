import { readLiveEnv } from "../env.mjs";

type EnvValues = Record<string, string | undefined>;

/** 校验单个变量：缺失或空白时报错；消息只含变量名，值绝不进入错误文本。 */
function required(name: string, values: EnvValues): string {
  const value = values[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for live validation (repository .env or environment)`);
  }
  return value;
}

export interface QoderAndBailianCredentials {
  qoderPat: string;
  bailianApiKey: string;
  bailianWorkspaceId: string;
}

export interface BailianCredentials {
  bailianApiKey: string;
  bailianWorkspaceId: string;
}

/**
 * live 用例的凭据入口：默认读取当前仓库 .env（显式环境变量优先）。
 * 可注入 values 以便单测；生产路径永远走 readLiveEnv 的仓库边界。
 */
export function requireQoderPat(values: EnvValues = readLiveEnv()): string {
  return required("QODER_PAT", values);
}

export function requireBailian(values: EnvValues = readLiveEnv()): BailianCredentials {
  return {
    bailianApiKey: required("DASHSCOPE_API_KEY", values),
    bailianWorkspaceId: required("BAILIAN_WORKSPACE_ID", values),
  };
}

/** 跨 Provider 用例一次校验全部变量，避免半套凭据跑到一半才失败。 */
export function requireQoderAndBailian(
  values: EnvValues = readLiveEnv(),
): QoderAndBailianCredentials {
  return {
    qoderPat: required("QODER_PAT", values),
    bailianApiKey: required("DASHSCOPE_API_KEY", values),
    bailianWorkspaceId: required("BAILIAN_WORKSPACE_ID", values),
  };
}
