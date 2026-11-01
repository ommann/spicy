# Spicy

Spicy is a Linux frontend/backend fork of Pi with its terminal interface retained.

Customize it with [extensions](docs/extensions.md), [skills](docs/skills.md), [prompt templates](docs/prompt-templates.md), and [themes](docs/themes.md). Local extension folders and package installation are supported.

Use it [interactively](docs/usage.md), automate it in [print or JSON mode](docs/cli.md), control it over [RPC](docs/rpc.md), or build apps with the [TypeScript SDK](docs/sdk.md).

## Getting started

With Node.js 22.19 or newer, run from the repository root:

```bash
npm ci
npm run dev
```

Open http://localhost:5174 for the frontend. Spicy does not install or update itself through upstream Pi installers.

See the [quickstart](docs/quickstart.md) for terminal setup and authentication, or the [documentation](docs/index.md) for full usage instructions.

## Development

From the repository root:

```bash
npm run check
npm run build
```

Run focused coding-agent tests with:

```bash
npm test --workspace=@earendil-works/pi-coding-agent -- test/args.test.ts
```

## License

MIT
