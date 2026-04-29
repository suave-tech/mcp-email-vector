export interface Config {
  apiUrl: string;
  token: string;
}

const DEFAULTS: Config = {
  apiUrl: "http://localhost:3000",
  token: "",
};

export async function getConfig(): Promise<Config> {
  const stored = await chrome.storage.local.get(["apiUrl", "token"]);
  return {
    apiUrl: (stored.apiUrl as string | undefined) ?? DEFAULTS.apiUrl,
    token: (stored.token as string | undefined) ?? DEFAULTS.token,
  };
}

export async function setConfig(partial: Partial<Config>): Promise<void> {
  await chrome.storage.local.set(partial);
}
