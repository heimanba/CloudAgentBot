import { cn } from "../../lib/utils";
import bailianIconUrl from "./assets/bailian.svg?no-inline";
import qoderIconUrl from "./assets/qoder.svg?no-inline";

const PROVIDER_BRANDS = {
  qoder: { name: "Qoder", iconUrl: qoderIconUrl },
  bailian: { name: "百炼", iconUrl: bailianIconUrl },
} as const;

function getProviderBrand(provider?: string) {
  if (!provider) return null;
  return PROVIDER_BRANDS[provider as keyof typeof PROVIDER_BRANDS] ?? null;
}

export function getProviderDisplayName(provider?: string): string {
  return getProviderBrand(provider)?.name ?? provider ?? "Provider";
}

export function ProviderIcon({ provider, className }: { provider?: string; className?: string }) {
  const brand = getProviderBrand(provider);
  if (brand === null) return null;

  return (
    <img
      alt=""
      aria-hidden="true"
      className={cn("block size-full object-contain", className)}
      data-provider-icon={provider}
      draggable={false}
      src={brand.iconUrl}
    />
  );
}

export function ProviderBadge({ provider, className }: { provider?: string; className?: string }) {
  if (getProviderBrand(provider) === null) return null;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-[16px] shrink-0 place-items-center rounded-full border border-border bg-card p-[2px] text-foreground",
        className,
      )}
      data-provider-badge={provider}
    >
      <ProviderIcon provider={provider} />
    </span>
  );
}
