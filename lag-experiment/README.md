# First-connection lag investigation

## Goal
Find why Spicy's initial WebSocket fails while terminal Pi's succeeds. No forced SSE fallback, longer timeouts, test-suite edits, or real model requests from these scripts.

## Evidence
- Matched saved requests: same model (`gpt-6.1-sol`) and thinking level (`low`). Pi completed in 7 seconds; Spicy in 22 seconds, with a 15-second WebSocket failure before SSE fallback.
- Pi's saved prefix-watch metadata confirms its successful request used WebSocket.
- Both processes use the same Node executable, network namespace and resolver configuration. Neither has proxy environment variables.
- RPC mode starts a background model-catalog refresh with a 15-second limit (`main.ts:819`). That is a hypothesis to investigate, not a proven explanation.
- System resolver measurements previously took 5–10 seconds. A later controlled DNS-contention run completed in 32–119 ms and did NOT reproduce the stall. Do not claim DNS contention is established.
- The experimental 20-second connection timeout has been removed from production source.

## Scripts
- `node lag-experiment/dns-contention.mjs`: measures `localhost` lookup behind four `pi.dev` DNS lookups. DNS only; no HTTP/inference. Results: `dns-contention-results.jsonl`.
- `trace-preload.mjs`: optional passive tracing of real process DNS lookups and Undici connection events. No requests initiated. No headers, credentials, prompts, paths or bodies recorded. Output: `connection-trace.jsonl`.

Enable tracing on a command:

```sh
NODE_OPTIONS="--import=$PWD/lag-experiment/trace-preload.mjs" node spicy.mjs --global-user-dir
```

For a matching terminal Pi trace (absolute path works from another project):

```sh
NODE_OPTIONS="--import=/home/olli/Development/spicy/lag-experiment/trace-preload.mjs" /home/olli/.npm-global/bin/pi
```

Next evidence needed: actual first-connection DNS and socket timings. Distinguish resolver delay/worker contention from TCP/TLS or WebSocket handshake delay before choosing a fix.
