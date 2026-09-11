# Institution Backend (v0.1 · Slice B)

最小 Institution Backend：Organization / User mapping / Entitlement 编排，调用 LiteLLM management API。

**不接** Electron / Talk / Digital Self / Relay。  
**不自研** gateway / quota / virtual key engine。

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | backend + LiteLLM health |
| POST | `/v0/admin/bootstrap` | seed Demo Telecom + 2 users |
| GET | `/v0/organization` | current demo org |
| POST | `/v0/session/exchange` | mock identity → gateway + virtual key |
| GET | `/v0/entitlement?institutionUserId=` | entitlement + live LiteLLM budget |
| GET | `/v0/usage/summary` | per-user usage metadata from LiteLLM |

## Run

Requires Slice A LiteLLM stack on `:4000`.

```powershell
# optional: reuse spike .env (gitignored)
node institution/backend/server.cjs

# real verification (starts backend, seeds, chats, privacy checks)
node institution/backend/run-verify.cjs
```

Success verdict:

`INSTITUTION_DISTRIBUTION_V01_BACKEND_ACCEPTED`

## Data boundary

Institution store (`data/store.json`, gitignored) may hold:

- organization metadata
- institution user ids / status
- entitlement group refs
- LiteLLM virtual key refs (user-scoped)

Must never hold:

- provider master keys
- prompt / response / Digital Self / memory
