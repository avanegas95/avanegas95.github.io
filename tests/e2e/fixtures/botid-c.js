// Test stand-in for BotID's challenge script (`.../a-4-a/c.js`), served by stubBotId().
// botid/client/core's getChallenge() appends this script, then waits for a value pushed onto
// window.V_C (its constructor already replaced V_C.push with the promise resolver). The value
// is sent as the `x-is-human` header. `b: 0` would make the client load the Kasada SDK
// (p.js) and re-run the request; any other `b` makes it send the request straight through.
// So: push a challenge with b = 1 and no real proof. The server-side check is mocked/absent
// in E2E because /api/chat itself is intercepted.
(window.V_C = window.V_C || []).push({ b: 1, d: 0 });
