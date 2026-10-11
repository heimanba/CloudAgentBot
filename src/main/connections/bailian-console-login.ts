import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { hostError } from "@shared/errors";

const CONSOLE_ORIGIN = "https://bailian.console.aliyun.com";
const CALLBACK_METHODS = new Set(["GET", "POST", "PUT", "PATCH"]);
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const WORKSPACE_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export interface BailianConsoleCredentials {
  apiKey: string;
  workspaceId: string;
}

export interface BailianConsoleLoginOptions {
  openExternal(url: string): Promise<void>;
  timeoutMs?: number;
}

function constantTimeStateMatches(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

async function readBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw hostError("invalid-input", "login callback is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function bodyFields(raw: string, contentType: string): URLSearchParams {
  if (!raw) return new URLSearchParams();
  if (contentType.includes("application/json")) {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw hostError("invalid-input", "invalid login callback JSON");
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw hostError("invalid-input", "invalid login callback body");
    }
    const fields = new URLSearchParams();
    for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
      if (typeof field === "string") fields.set(key, field);
    }
    return fields;
  }
  if (contentType.includes("application/x-www-form-urlencoded")) return new URLSearchParams(raw);
  throw hostError("invalid-input", "unsupported login callback content type");
}

function firstField(query: URLSearchParams, body: URLSearchParams, ...names: string[]): string {
  for (const name of names) {
    const value = query.get(name) ?? body.get(name);
    if (value?.trim()) return value.trim();
  }
  return "";
}

/** Main-only browser broker. A login attempt is memory-only and single-use. */
export class BailianConsoleLogin {
  readonly #openExternal: (url: string) => Promise<void>;
  readonly #timeoutMs: number;
  #cancelActive: (() => void) | null = null;

  constructor(options: BailianConsoleLoginOptions) {
    this.#openExternal = options.openExternal;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async start(): Promise<BailianConsoleCredentials> {
    if (this.#cancelActive !== null)
      throw hostError("conflict", "a Bailian login is already active");

    const state = randomBytes(16).toString("hex");
    let settle: ((result: BailianConsoleCredentials) => void) | null = null;
    let fail: ((error: unknown) => void) | null = null;
    let consumed = false;
    const result = new Promise<BailianConsoleCredentials>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });

    const server = http.createServer(async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      try {
        if (consumed || request.url === undefined) {
          response.writeHead(409).end("Login callback is no longer active.\n");
          return;
        }
        const url = new URL(request.url, "http://127.0.0.1");
        if (url.pathname !== "/") {
          response.writeHead(404).end("Not found.\n");
          return;
        }
        if (!constantTimeStateMatches(url.searchParams.get("state"), state)) {
          response.writeHead(400).end("Invalid login state.\n");
          return;
        }
        const origin = request.headers.origin;
        if (origin !== undefined && origin !== CONSOLE_ORIGIN) {
          response.writeHead(403).end("Invalid login origin.\n");
          return;
        }
        if (origin === CONSOLE_ORIGIN) {
          response.setHeader("Access-Control-Allow-Origin", CONSOLE_ORIGIN);
          response.setHeader("Vary", "Origin");
        }
        if (request.method === "OPTIONS") {
          response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS");
          response.setHeader("Access-Control-Allow-Headers", "Content-Type");
          if (request.headers["access-control-request-private-network"] === "true") {
            response.setHeader("Access-Control-Allow-Private-Network", "true");
          }
          response.writeHead(204).end();
          return;
        }
        if (!CALLBACK_METHODS.has(request.method ?? "")) {
          response.writeHead(405).end("Method not allowed.\n");
          return;
        }
        const body =
          request.method !== "GET"
            ? bodyFields(await readBody(request), String(request.headers["content-type"] ?? ""))
            : new URLSearchParams();
        const apiKey = firstField(url.searchParams, body, "api_key", "apiKey");
        const workspaceId = firstField(url.searchParams, body, "workspace_id", "workspaceId");
        const site = firstField(url.searchParams, body, "console_site", "consoleSite");
        const region = firstField(url.searchParams, body, "console_region", "consoleRegion");
        if (!apiKey || !WORKSPACE_ID.test(workspaceId)) {
          response.writeHead(400).end("Missing API key or workspace.\n");
          return;
        }
        if ((site && site !== "domestic") || (region && region !== "cn-beijing")) {
          response.writeHead(400).end("Only the China Beijing site is supported.\n");
          return;
        }
        consumed = true;
        response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Authorization received. You can return to CloudAgentBot.\n");
        settle?.({ apiKey, workspaceId });
        server.close();
      } catch (error) {
        response.writeHead(400).end("Invalid login callback.\n");
        if (!consumed) {
          consumed = true;
          fail?.(error);
          server.close();
        }
      }
    });
    server.requestTimeout = 10_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 1_000;
    server.maxHeadersCount = 32;

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      server.close();
      throw hostError("unavailable", "could not start Bailian login callback");
    }

    const finishWithError = (error: unknown) => {
      if (consumed) return;
      consumed = true;
      server.close();
      fail?.(error);
    };
    this.#cancelActive = () => finishWithError(hostError("unavailable", "Bailian login cancelled"));
    const timeout = setTimeout(
      () => finishWithError(hostError("unavailable", "Bailian login timed out")),
      this.#timeoutMs,
    );
    timeout.unref();

    const loginUrl = `${CONSOLE_ORIGIN}/console-login?notice=127.0.0.1:${address.port}?state=${encodeURIComponent(state)}&needapikey=true`;
    try {
      await this.#openExternal(loginUrl);
    } catch (error) {
      finishWithError(error);
      await result.catch(() => undefined);
      clearTimeout(timeout);
      this.#cancelActive = null;
      server.close();
      throw hostError("unavailable", "could not open Bailian login page");
    }
    try {
      return await result;
    } finally {
      clearTimeout(timeout);
      this.#cancelActive = null;
      server.close();
    }
  }

  cancel(): void {
    this.#cancelActive?.();
  }
}
