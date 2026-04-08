/**
 * Reproduction: @effect/rpc RpcSerialization.msgPack fails on Cloudflare Workers
 *
 * new Packr() enables records by default (undefined != false → this.structures = []).
 * When a single pack() contains 3+ objects with the same key structure, the Unpackr's
 * readObject.count exceeds inlineObjectReadThreshold (2) and triggers JIT compilation
 * via new Function() — which CF Workers blocks during request handling.
 *
 * RpcSerialization.msgPack's catch block silently swallows the error and returns [].
 *
 * Prerequisites:
 *   - Deployed to CF Workers (miniflare does not enforce new Function() restriction)
 *   - allow_eval_during_startup compat flag (so msgpackr's startup probe passes)
 *
 * Deploy: cd packages/rpc/repro-cf-worker && npx wrangler deploy
 * Test:   curl https://<worker>.workers.dev/test
 */

import { Packr, Unpackr } from "msgpackr"

// Reproduces the exact decode logic from RpcSerialization.ts lines 358-391
function rpcDecode(unpackr: Unpackr, bytes: Uint8Array): ReadonlyArray<unknown> {
  try {
    return unpackr.unpackMultiple(bytes)
  } catch (error_) {
    const error = error_ as any
    if (error.incomplete) {
      return error.values ?? []
    }
    return [] // ← THE BUG: silently swallows EvalError from blocked new Function()
  }
}

// Typical @effect/rpc message shape — 4 nested objects sharing {_tag, ...} structure
const RPC_PAYLOAD = {
  _tag: "Chunk",
  requestId: "1",
  values: [
    { _tag: "Exit", requestId: "1", exit: { _tag: "Success", value: { _tag: "Ok", data: "a" } } },
    { _tag: "Exit", requestId: "2", exit: { _tag: "Success", value: { _tag: "Ok", data: "b" } } },
    { _tag: "Exit", requestId: "3", exit: { _tag: "Success", value: { _tag: "Ok", data: "c" } } },
    { _tag: "Exit", requestId: "4", exit: { _tag: "Success", value: { _tag: "Ok", data: "d" } } },
  ]
}

export default {
  async fetch(): Promise<Response> {
    // Same as RpcSerialization.msgPack: new Packr()/Unpackr() with no options
    const packr = new Packr()
    const unpackr = new Unpackr()

    const encoded = packr.pack(RPC_PAYLOAD)

    // 1. Raw decode — shows the actual error
    let rawError: string | null = null
    try {
      unpackr.unpackMultiple(encoded)
    } catch (e: any) {
      rawError = `${e.constructor.name}: ${e.message}`
    }

    // 2. RpcSerialization-style decode — silently returns []
    const swallowed = rpcDecode(new Unpackr(), encoded)

    // 3. Fixed: useRecords: false — no JIT, no error
    const fixedPackr = new Packr({ useRecords: false })
    const fixedUnpackr = new Unpackr({ useRecords: false })
    const fixedEncoded = fixedPackr.pack(RPC_PAYLOAD)
    let fixedResult: unknown[]
    try {
      fixedResult = fixedUnpackr.unpackMultiple(fixedEncoded) as unknown[]
    } catch (e: any) {
      fixedResult = [{ error: e.message }]
    }

    return Response.json({
      bug: {
        raw_error: rawError,
        rpcSerialization_result: swallowed,
        rpcSerialization_length: swallowed.length,
        silently_swallowed: swallowed.length === 0 && rawError !== null
      },
      fix: {
        useRecords_false_result: fixedResult,
        useRecords_false_length: fixedResult.length
      }
    }, { headers: { "content-type": "application/json" } })
  }
}
