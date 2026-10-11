// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getProviderDisplayName, ProviderBadge } from "./provider-brand";

describe("ProviderBadge", () => {
  it("renders each supported Provider as a direct SVG image", () => {
    const qoder = renderToStaticMarkup(<ProviderBadge provider="qoder" />);
    const bailian = renderToStaticMarkup(<ProviderBadge provider="bailian" />);

    expect(qoder).toContain('data-provider-badge="qoder"');
    expect(qoder).toContain('data-provider-icon="qoder"');
    expect(qoder).toContain("<img");
    expect(qoder).toContain('src="');
    expect(qoder).not.toContain("data:image");
    expect(qoder).not.toContain("mask-image");
    expect(bailian).toContain('data-provider-badge="bailian"');
    expect(bailian).toContain('data-provider-icon="bailian"');
    expect(bailian).toContain("<img");
    expect(bailian).toContain('src="');
    expect(bailian).not.toContain("data:image");
    expect(bailian).not.toContain("mask-image");
  });

  it("keeps unknown Provider values readable without inventing a brand", () => {
    expect(ProviderBadge({ provider: "future-provider" })).toBeNull();
    expect(getProviderDisplayName("future-provider")).toBe("future-provider");
  });
});
