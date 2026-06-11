// Server configuration. CONFIG_PATH env points at a JSON file (default ./config.json);
// PORT and BASE_URL env vars override whatever the file says.

export interface ServerConfig {
  server: { port: number; baseURL: string };
  limits: { maxFileBytes: number };
  retention: { purgeAfterDays: number };
}

const DEFAULTS: ServerConfig = {
  server: { port: 8000, baseURL: 'http://localhost:8000' },
  limits: { maxFileBytes: 26_214_400 },
  retention: { purgeAfterDays: 30 },
};

export async function loadConfig(env: Record<string, string | undefined> = process.env): Promise<ServerConfig> {
  const path = env.CONFIG_PATH ?? './config.json';
  let file: Partial<Record<keyof ServerConfig, object>> = {};
  const f = Bun.file(path);
  if (await f.exists()) {
    try {
      file = await f.json();
    } catch (e) {
      throw new Error(`config file ${path} is not valid JSON: ${e instanceof Error ? e.message : e}`);
    }
  }
  const cfg: ServerConfig = {
    server: { ...DEFAULTS.server, ...file.server },
    limits: { ...DEFAULTS.limits, ...file.limits },
    retention: { ...DEFAULTS.retention, ...file.retention },
  };
  if (env.PORT) {
    const port = Number.parseInt(env.PORT, 10);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`invalid PORT: ${env.PORT}`);
    cfg.server.port = port;
  }
  if (env.BASE_URL) cfg.server.baseURL = env.BASE_URL;
  cfg.server.baseURL = cfg.server.baseURL.replace(/\/+$/, '');
  if (!/^https?:\/\//.test(cfg.server.baseURL)) throw new Error(`baseURL must be http(s): ${cfg.server.baseURL}`);
  return cfg;
}
