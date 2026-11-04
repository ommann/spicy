# Agent connections

Each connection owns one RPC process, project directory, session cursor, live
state, dialogs and SSE subscriptions. Connections belong to the backend, not to
browser tabs: closing a stream does not stop an agent. Multiple panes or tabs can
intentionally follow the same connection.

## Chat

- **Side by side** uses the existing branch columns. Sending an edited branch
  starts another agent without navigating or interrupting the original branch.
- Each column's **Stop this agent** button (or Escape in its input) affects only
  that column. Sending more text to a working column steers that same agent.
- Click the project path to select an existing **Agent**, start a **New session**,
  or enter another absolute **Project directory** and choose **Open project**.
- Each tab remembers its own selection. A fresh tab starts independently; select
  an existing agent explicitly to follow the same work in another tab.

`/compact [instructions]` summarizes the selected column's entire active context
and starts a new column. The summary is an independent root in the same JSONL,
with the inherited full system prompt saved as its immediate child—not embedded
in the summary. The prompt remains selectable until the first message. No reply
starts automatically, and the original history stays untouched.

## API

Mutations require the existing `X-Lilim-Token` from `GET /api/info`.

- `GET /api/agents`: list connections and their status.
- `POST /api/agents` with `{ "cwd": "/absolute/project/path" }`: create and
  start an independent agent. `cwd` defaults to the backend project directory.
- `POST /api/agents` with `{ "sourceAgentId": "...", "entryId": "..." }`:
  create and start an independent branch. The project defaults to the source's;
  an explicit `cwd` can select another project. The source can still be running.
- Alternatively, `{ "sessionId": "...", "entryId": "..." }` branches a saved
  session from the project selected by `cwd`. Session IDs come from
  `GET /api/sessions?agentId=...`.

Creation returns HTTP 201 with a snapshot containing `agentId`. It does not send
any model prompt. `entryId` is optional and defaults to the source's current leaf.
An explicitly selected user entry branches **before** that message, matching the
existing branch/edit behavior; other selected entries branch after the entry.

For an existing connection, pass `agentId`:

- As a query parameter to `/api/info`, `/api/events`, `/api/sessions`, or
  `/api/session`.
- In the JSON body (or query) of `/api/command`, `/api/branch`, `/api/continue`,
  `/api/ui`, `/api/start`, or `/api/stop`.

Omitting it selects `default`, preserving the current frontend's behavior.
Unknown IDs fail rather than falling back to another connection. `/api/start`
changes only the selected agent; `/api/stop` stops only that agent. Starting a
stopped connection without a session ID resumes its previous session.

## Persistence

A concurrent branch gets a **separate session file** containing the selected
ancestry, with existing entry IDs preserved and `parentSession` pointing to the
source. The creation snapshot also includes `source` (agent, session and branch
entry IDs). Active sources are copied through RPC rather than reading a file
while another process appends to it. Branches then persist independently; their
new entries are not merged back into the source file. The registry refuses to
open the same writable session in two agents.

Connections and their IDs live until the backend exits; session files survive
backend restarts. `PI_SESSION_DIR` overrides the managed session directory
(default: `backend/.sessions`).
