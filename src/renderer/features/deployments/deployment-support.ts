/** 具备定时任务（Deployment）能力的 Provider。 */
export function supportsDeployments(provider: string | undefined): boolean {
  return provider === "bailian" || provider === "qoder";
}
