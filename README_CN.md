# flash-tunnel

**将本地服务通过 Cloudflare Tunnel 暴露出去。**

`flash-tunnel` 是 Flash Nexus 网络中的底层隧道包，只负责 Cloudflare
隧道适配器和 `cloudflared` 生命周期。DNS 记录由 `flash-dns` 管理，公网
域名命名和整体环境编排由 `flash-nexus` 负责。

三个包的边界如下：

```text
flash-nexus       编排和一条命令的完整工作流
├── flash-dns     DNS 记录、命名和归属管理
└── flash-tunnel  隧道适配器和 cloudflared 生命周期
```

如果本地服务已经有公网域名，或者只需要临时的
`trycloudflare.com` 地址，可以直接使用 `flash-tunnel`。如果需要在同一
次会话中创建 DNS 记录、启动隧道并在结束时一起清理，则使用
`flash-nexus`。

## 快速开始

临时公网地址：

```bash
npx flash-tunnel --mode quick --url http://127.0.0.1:4317
```

独立使用命名隧道时，先用 `flash-dns` 准备 DNS 记录，再传入已经存在的域名：

```bash
npx flash-tunnel \
  --mode named \
  --hostname preview.example.com \
  --url http://127.0.0.1:4317
```

命名隧道需要 `CLOUDFLARE_API_TOKEN`。如果账号无法自动判断，再设置
`CLOUDFLARE_ACCOUNT_ID`。

## CLI 参数

| 参数 | 说明 |
| --- | --- |
| `--url <url>` | 已运行的本地服务地址 |
| `--command <command>` | 启动本地服务的命令 |
| `--port <port>` | 本地服务端口 |
| `--mode quick\|named` | 隧道模式 |
| `--hostname <fqdn>` | 命名模式下已经配置好的公网域名 |
| `--name <name>` | Cloudflare 隧道名称 |
| `--auto-stop <duration>` | 自动停止，例如 `30m`、`2h` |
| `--keep` | 退出后保留隧道 |
| `--dry-run` | 输出解析后的隧道配置 |
| `--json` | 输出机器可读 JSON |

`flash-tunnel` 不会创建、修改或删除 DNS 记录。`flash-dns` 可以独立管理
这些记录，`flash-nexus` 则负责把两个包组合到同一个会话中。

## SDK

```ts
import { startTunnel } from '@flash-tunnel/sdk'

const session = await startTunnel({
  localUrl: 'http://127.0.0.1:4317',
  mode: 'quick'
})

console.log(session.publicUrl)
await session.stop()
```

命名隧道要求域名已经解析到对应隧道：

```ts
const session = await startTunnel({
  localUrl: 'http://127.0.0.1:4317',
  mode: 'named',
  hostname: 'preview.example.com'
})
```

SDK 默认读取 `cwd/.env`，也可以通过 `envFile` 指定其他文件。

## 配置

`flash-tunnel.ts` 只描述本地服务和隧道：

```ts
import { defineConfig } from 'flash-tunnel'

export default defineConfig({
  server: {
    command: 'pnpm dev',
    port: 5173
  },
  tunnel: {
    mode: 'named',
    hostname: 'preview.example.com'
  }
})
```

需要同时处理 DNS 命名和 provider 配置时，使用 `flash-nexus.config.ts`。
完整的集成 CLI 和 SDK 见
[flash-nexus 仓库](https://github.com/flash-nexus/flash-nexus)。

## 开发

```bash
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

需要 Node.js `>=22.14`，并确保 `cloudflared` 在 `PATH` 中。

## License

[MIT](https://github.com/flash-nexus/flash-tunnel/blob/main/LICENSE)
