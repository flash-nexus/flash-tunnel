# flash-tunnel

**Run a local origin through Cloudflare Tunnel.**

`flash-tunnel` is the low-level tunnel package in the Flash Nexus network. It
owns the Cloudflare tunnel adapter and the `cloudflared` lifecycle. DNS
records, public hostname naming, and environment orchestration belong to
`flash-nexus`, while DNS record operations are implemented by `flash-dns`.

The three packages have clear boundaries:

```text
flash-nexus       orchestration and one-command workflow
├── flash-dns     DNS records, naming and ownership
└── flash-tunnel  Tunnel adapters and cloudflared lifecycle
```

Use `flash-tunnel` when a local origin already has a public hostname or when
you only need a temporary `trycloudflare.com` URL. Use `flash-nexus` when the
same workflow must create the DNS record, start the Tunnel and clean both up
together.

> Early preview (`0.x`). APIs may change between minor versions.

## Quick start

For a temporary public URL:

```bash
npx flash-tunnel --mode quick --url http://127.0.0.1:4317
```

For a standalone named tunnel, create the DNS record with `flash-dns` first,
then pass the existing hostname:

```bash
npx flash-tunnel \
  --mode named \
  --hostname preview.example.com \
  --url http://127.0.0.1:4317
```

The named tunnel requires `CLOUDFLARE_API_TOKEN` and, when Cloudflare cannot
infer it, `CLOUDFLARE_ACCOUNT_ID`.

## CLI

| Option | Description |
| --- | --- |
| `--url <url>` | Existing local origin URL |
| `--command <command>` | Start a local server command |
| `--port <port>` | Preferred local server port |
| `--mode quick\|named` | Tunnel mode |
| `--hostname <fqdn>` | Hostname already configured in DNS for named mode |
| `--name <name>` | Cloudflare tunnel name |
| `--auto-stop <duration>` | Stop after `30m`, `2h`, and similar durations |
| `--keep` | Keep the tunnel after the process exits |
| `--dry-run` | Print resolved tunnel configuration |
| `--json` | Print machine-readable output |

`flash-tunnel` never creates, updates, or deletes DNS records. `flash-dns` can
manage those records independently, while `flash-nexus` composes both packages
for a single session.

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

Named sessions require a hostname that already resolves to the tunnel:

```ts
const session = await startTunnel({
  localUrl: 'http://127.0.0.1:4317',
  mode: 'named',
  hostname: 'preview.example.com'
})
```

The SDK loads `cwd/.env` by default. Pass `envFile` to load another file.

## Configuration

`flash-tunnel.ts` only describes the local server and tunnel:

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

Use `flash-nexus.config.ts` when DNS naming and provider configuration are
part of the same workflow. The integrated CLI and SDK are published from the
[flash-nexus repository](https://github.com/flash-nexus/flash-nexus).

## Development

```bash
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

Requires Node.js `>=22.14` and `cloudflared` on `PATH`.

## License

[MIT](https://github.com/flash-nexus/flash-tunnel/blob/main/LICENSE)
