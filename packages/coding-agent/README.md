# Spicy

Spicy is a Linux frontend/backend fork of Pi with its terminal interface retained.

Extensions, skills, prompt templates, themes, local extension folders, and package installation remain supported, along with the TUI, print/JSON modes, RPC, and TypeScript SDK.

## Getting started

With Node.js 22.19 or newer, run from the repository root:

```bash
npm ci
npm run dev
```

Open http://localhost:5174 for the frontend. Spicy does not install or update itself through upstream Pi installers.

One launcher supports both interfaces:

```bash
npm run dev           # web app
```

To use `spicy` from any project directory, run `npm link --ignore-scripts` once at the repository root:

```bash
spicy        # web app
```

Both use the current directory as the project (`PI_CWD` overrides it for the web app). No build step is required. Use `/login` in the TUI to connect a provider and `/model` to select a model.

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
