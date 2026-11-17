# @flash-tunnel/sdk

面向程序化集成的 Tunnel SDK。它接收一个已经运行的本地 origin，负责启动 Cloudflare Tunnel、等待公网地址，并在停止时清理本次会话创建的资源。

```ts
import { startTunnel } from '@flash-tunnel/sdk'

const session = await startTunnel({
  localUrl: 'http://127.0.0.1:4317',
  mode: 'quick'
})

console.log(session.publicUrl)
await session.stop()
```

Named tunnels can receive a DNS adapter from an orchestration layer. This
keeps DNS ownership outside the tunnel SDK while preserving the standalone
Cloudflare adapter by default:

```ts
const session = await startTunnel({
  localUrl: 'http://127.0.0.1:4317',
  mode: 'named',
  hostname: 'preview.example.com',
  zone: 'example.com',
  dnsAdapter
})
```

Set `manageDns: false` when the caller has already created the DNS record and
only wants the tunnel lifecycle.

For named Cloudflare tunnels, the SDK loads `cwd/.env` when it exists. Pass
`envFile` to use another file. `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_ZONE_ID` are resolved automatically
unless explicit options are provided.

宿主程序负责本地服务、进程信号和业务协议；SDK 不安装全局信号处理器，也不依赖 CLI UI。运行仍然需要开发机安装 `cloudflared`。
