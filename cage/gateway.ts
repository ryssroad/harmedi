// Zero-secret outbound gateway for Fly.io Sprites Connectors.
//
// Inside a Sprite:
//   Auto-discovers connected providers from https://api.sprites.dev/v1/gateway/list
//   (no secrets live on the VM — the gateway authenticates the Sprite and injects tokens).
//   Any <PROVIDER>_GATEWAY env var overrides auto-discovery.
//
// Local dev fallback:
//   If no gateway is found, falls back to <PROVIDER>_KEY + direct API URL.

export type Provider =
  | "github"
  | "typesafe"
  | "pinecone"
  | "agentmail"
  | "anthropic"
  | "openai"
  | "ollama"
  | "gemini";

export type ConnectorInfo = {
  provider: string;
  id: string;
  display_name?: string;
  username?: string;
  gateway_base_url: string;
  mode: "sprite-gateway" | "local-key";
};

const DIRECT: Partial<Record<Provider, string>> = {
  github: "https://api.github.com",
  typesafe: "https://api.typesafe.ai",
  agentmail: "https://api.agentmail.to",
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  ollama: "https://ollama.com",
  gemini: "https://generativelanguage.googleapis.com",
};

const bearer = (k: string): Record<string, string> => ({ authorization: `Bearer ${k}` });

const AUTH: Record<Provider, (k: string) => Record<string, string>> = {
  github: bearer,
  typesafe: bearer,
  agentmail: bearer,
  openai: bearer,
  ollama: bearer,
  anthropic: (k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }),
  pinecone: (k) => ({ "api-key": k }),
  gemini: (k) => ({ "x-goog-api-key": k }),
};

let discovered: Map<string, ConnectorInfo> | null = null;
let lastDiscovery = 0;

export async function discoverConnectors(force = false): Promise<Map<string, ConnectorInfo>> {
  if (discovered && !force && Date.now() - lastDiscovery < 30_000) return discovered;
  const map = new Map<string, ConnectorInfo>();

  // 1. Live Sprite gateway discovery
  try {
    const res = await fetch("https://api.sprites.dev/v1/gateway/list", {
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const data = (await res.json()) as { connections?: any[] };
      for (const c of data.connections ?? []) {
        if (!c?.provider || !c?.gateway_base_url) continue;
        if (!map.has(c.provider)) {
          map.set(c.provider, {
            provider: c.provider,
            id: c.id ?? "",
            display_name: c.display_name,
            username: c.username ?? c.provider_account_name,
            gateway_base_url: c.gateway_base_url,
            mode: "sprite-gateway",
          });
        }
      }
    }
  } catch {
    // Not on a Sprite or gateway unreachable — fall through to env vars.
  }

  // 2. Explicit *_GATEWAY overrides or local *_KEY fallbacks
  const providers: Provider[] = [
    "github",
    "typesafe",
    "pinecone",
    "agentmail",
    "anthropic",
    "openai",
    "ollama",
    "gemini",
  ];
  for (const p of providers) {
    const upper = p.toUpperCase();
    const gw = process.env[`${upper}_GATEWAY`];
    if (gw) {
      map.set(p, {
        provider: p,
        id: "env-override",
        gateway_base_url: gw,
        mode: "sprite-gateway",
      });
      continue;
    }
    if (!map.has(p) && process.env[`${upper}_KEY`]) {
      const direct =
        p === "pinecone"
          ? process.env.PINECONE_INDEX_HOST || process.env.PINECONE_DIRECT_URL || ""
          : process.env[`${upper}_DIRECT_URL`] ?? DIRECT[p] ?? "";
      if (direct) {
        map.set(p, {
          provider: p,
          id: "local-key",
          gateway_base_url: direct,
          mode: "local-key",
        });
      }
    }
  }

  discovered = map;
  lastDiscovery = Date.now();
  return map;
}

export async function getConnector(provider: Provider): Promise<ConnectorInfo | null> {
  const map = await discoverConnectors();
  return map.get(provider) ?? null;
}

export async function listConnected(): Promise<ConnectorInfo[]> {
  const map = await discoverConnectors();
  return [...map.values()];
}

const joinUrl = (base: string, path: string) =>
  base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");

export async function call(
  provider: Provider,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const conn = await getConnector(provider);
  if (!conn) {
    throw new Error(`Connector '${provider}' is not connected (neither Sprite gateway nor ${provider.toUpperCase()}_KEY).`);
  }

  const headers = new Headers(init.headers);
  if (conn.mode === "local-key") {
    const key = process.env[`${provider.toUpperCase()}_KEY`]!;
    for (const [k, v] of Object.entries(AUTH[provider](key))) {
      headers.set(k, v);
    }
  } else if (provider === "anthropic" && !headers.has("anthropic-version")) {
    headers.set("anthropic-version", "2023-06-01");
  }

  const url = joinUrl(conn.gateway_base_url, path);
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 500);
    throw new Error(`${provider} ${init.method ?? "GET"} ${path} -> ${res.status}: ${snippet}`);
  }
  return res;
}

export async function json<T = any>(
  provider: Provider,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const init: RequestInit =
    body === undefined
      ? { method: "GET", headers: extraHeaders }
      : {
          method: "POST",
          headers: { "content-type": "application/json", ...extraHeaders },
          body: JSON.stringify(body),
        };
  return (await call(provider, path, init)).json() as Promise<T>;
}
