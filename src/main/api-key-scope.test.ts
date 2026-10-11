import { describe, expect, it } from "vitest";
import { apiKeyScopeId, classifyApiKeyScope } from "./api-key-scope";

describe("API Key scope", () => {
  it("is stable across connections and changes with Provider or exact credential", () => {
    const sameDeviceCredential = apiKeyScopeId("qoder", "pat-one");
    expect(apiKeyScopeId("qoder", "pat-one")).toBe(sameDeviceCredential);
    expect(apiKeyScopeId("qoder", "pat-two")).not.toBe(sameDeviceCredential);
    expect(apiKeyScopeId("bailian", "pat-one")).not.toBe(sameDeviceCredential);
  });

  it("classifies only explicit matching metadata as current scope", () => {
    expect(classifyApiKeyScope("scope-one", "scope-one")).toBe("current");
    expect(classifyApiKeyScope("scope-two", "scope-one")).toBe("other");
    expect(classifyApiKeyScope(undefined, "scope-one")).toBe("ungrouped");
    expect(classifyApiKeyScope("", "scope-one")).toBe("ungrouped");
  });
});
