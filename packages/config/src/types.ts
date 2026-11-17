export type ConfigTunnelMode = 'named' | 'quick'

export interface ServerConfig {
  command?: string
  cwd?: string
  port?: number
  url?: string
  dir?: string
  timeout?: number
}

export interface TunnelConfig {
  provider?: string
  mode?: ConfigTunnelMode
  name?: string
  hostname?: string
}

export interface CloudflareOriginRequestConfig {
  httpHostHeader?: string
  noTLSVerify?: boolean
}

export interface CloudflareProviderConfig {
  accountId?: string
  cloudflaredPath?: string
  originRequest?: CloudflareOriginRequestConfig
}

export interface ProvidersConfig {
  cloudflare?: CloudflareProviderConfig
  [providerId: string]: unknown
}

export interface FlashTunnelConfig {
  server?: ServerConfig
  tunnel?: TunnelConfig
  providers?: ProvidersConfig
  autoStopAfter?: string | number
}

export function defineConfig<T extends FlashTunnelConfig>(config: T): T {
  return config
}
