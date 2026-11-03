# Spicy

Spicy is a Linux web frontend/backend fork of Pi.

Extensions, skills, prompt templates, local extension folders, and package installation remain supported, along with print/JSON modes, RPC, and the TypeScript SDK.

## Getting started

With Node.js 22.19 or newer, run from the repository root:

```bash
npm ci
npm run dev
```

Open http://localhost:5174 for the frontend. Spicy does not install or update itself through upstream Pi installers.

Start the web app:

```bash
npm run dev           # web app
```

To use `spicy` from any project directory, run `npm link --ignore-scripts` once at the repository root:

```bash
spicy        # web app
```

Both commands use the current directory as the project (`PI_CWD` overrides it). No build step is required.

The retained [codemode reference](docs/codemode.md) describes script globals, tool discovery, and classifier/image model APIs.

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
