import WebSocket from "ws";

// @medplum/core reads WebSocket.CLOSING/CLOSED while its module is evaluated.
// Node normally exposes a built-in implementation, but restricted or older
// runtimes may not. Install the explicit server implementation before loading
// Medplum so the API does not depend on the process launch directory.
if (typeof globalThis.WebSocket === "undefined") {
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: WebSocket,
    writable: true,
  });
}
