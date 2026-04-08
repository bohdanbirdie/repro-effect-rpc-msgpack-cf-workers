# Reproduction: @effect/rpc msgPack fails on Cloudflare Workers

Minimal Cloudflare Worker demonstrating that `RpcSerialization.msgPack` silently fails when decoding messages with 3+ same-structure objects.

## The bug

`new Packr()` with no options enables msgpackr's record/structure path (`undefined != false` is `true`). When the Unpackr encounters 3+ objects with the same key structure in a single decode, it JIT-compiles a fast reader via `new Function()` — which CF Workers blocks during request handling.

The error is silently swallowed by `RpcSerialization.msgPack`'s `catch { return [] }`.

## Prerequisites

- Cloudflare account (miniflare does **not** enforce `new Function()` restriction)
- `allow_eval_during_startup` compat flag (default for `compatibility_date >= 2025-06-01`)

## Deploy and test

```bash
npm install
npx wrangler deploy
curl https://<your-worker>.workers.dev
```

## Expected output

```json
{
  "bug": {
    "raw_error": "EvalError: Code generation from strings disallowed for this context",
    "rpcSerialization_result": [],
    "rpcSerialization_length": 0,
    "silently_swallowed": true
  },
  "fix": {
    "useRecords_false_result": [{ "_tag": "Chunk", ... }],
    "useRecords_false_length": 1
  }
}
```

- `bug.raw_error` — the actual EvalError from `new Function()` being blocked
- `bug.silently_swallowed` — `true` because `catch { return [] }` hides the error
- `fix` — `{ useRecords: false }` prevents the JIT path entirely

## Fix

PR: https://github.com/Effect-TS/effect/pull/6161

```typescript
// Before (silently fails on CF Workers with nested objects)
RpcSerialization.layerMsgPack

// After
RpcSerialization.layerMsgPack({ useRecords: false })
```

## References

- [CF Workers `new Function()` restriction](https://developers.cloudflare.com/workers/reference/security-model/)
- [msgpackr `useRecords` docs](https://github.com/kriszyp/msgpackr#records--structures)
- [CF `allow_eval_during_startup` compat flag](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#dynamic-code-evaluation)
- [livestore investigation](https://github.com/livestorejs/livestore/pull/1163)
