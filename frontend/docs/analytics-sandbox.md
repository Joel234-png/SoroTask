# Analytics Sandbox

The Analytics Sandbox is available at `/analytics-sandbox`. It lets users model a task execution against a forked testnet snapshot without signing, submitting, or mutating live workflow state.

## Architecture

- `src/lib/analytics-sandbox/simulation.ts` contains the typed input model, validation, cost projection, fallback handling, and error tracking.
- `src/components/AnalyticsSandbox.tsx` renders the client-side sandbox and keeps UI state separate from simulation math.
- `app/analytics-sandbox/page.tsx` exposes the route.

## Security Notes

- The sandbox does not call wallet signing APIs.
- The simulator rejects non-HTTPS RPC URLs except localhost test endpoints.
- Invalid task, contract, interval, gas, ledger, and keeper-count inputs return a blocked result with tracked critical errors.
- Remote simulation failures degrade to deterministic local projection and are recorded as warning-level errors.

## Testing

Run:

```bash
npm test -- analytics-sandbox
```

The tests cover validation, local projections, fallback behavior, and the interactive page flow.
