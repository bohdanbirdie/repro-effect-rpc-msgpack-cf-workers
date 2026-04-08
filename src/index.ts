/**
 * FIXED: Uses patched @effect/rpc with configurable msgpackr options.
 *
 * The patch changes RpcSerialization.msgPack from a value to a function
 * accepting optional msgpackr.Options, and fixes the silent error swallowing.
 *
 * Compare with the `main` branch to see the "before" state.
 *
 * Deploy: npx wrangler deploy
 * Test:   curl https://<worker>.workers.dev
 */

import { RpcSerialization } from "@effect/rpc"

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
    // FIXED: pass { useRecords: false } to avoid msgpackr JIT new Function()
    const parser = RpcSerialization.msgPack({ useRecords: false }).unsafeMake()

    const encoded = parser.encode(RPC_PAYLOAD)
    const decoded = parser.decode(encoded as Uint8Array)

    // Without the fix (default options) — would throw EvalError, silently swallowed to []
    let defaultError: string | null = null
    try {
      const defaultParser = RpcSerialization.msgPack().unsafeMake()
      const defaultEncoded = defaultParser.encode(RPC_PAYLOAD)
      defaultParser.decode(defaultEncoded as Uint8Array)
    } catch (e: any) {
      // With the patch, errors are rethrown instead of silently returning []
      defaultError = `${e.constructor.name}: ${e.message}`
    }

    return Response.json({
      fixed: {
        useRecords_false: true,
        decoded_length: decoded.length,
        decoded: decoded
      },
      default_options: {
        error: defaultError,
        note: defaultError
          ? "Default options trigger JIT new Function() — now properly rethrown instead of silently swallowed"
          : "No error (JIT threshold may not have been reached)"
      }
    })
  }
}
