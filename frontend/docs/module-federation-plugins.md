# Dynamic Module Federation for Plugins

SoroTask provides a plugin architecture for dynamically loading UI extensions at runtime with fault-tolerant loading, caching, and fallback support.

## Architecture

| Module | Responsibility |
| --- | --- |
| `src/lib/plugins/registry.ts` | Plugin manifest registration and scope lookup |
| `src/lib/plugins/loader.ts` | Dynamic import with retry, timeout, and fallback |
| `src/lib/plugins/federation.ts` | Unified initialization API |
| `src/components/PluginHost.tsx` | React host component with error boundaries |
| `src/hooks/usePluginLoader.ts` | Hook for loading plugins by scope |

## Plugin manifest

```typescript
{
  id: "analytics-widget",
  name: "Analytics Widget",
  version: "1.0.0",
  entry: "/plugins/analytics/index.js",
  scope: "dashboard",
  fallbackEntry: "/plugins/analytics/fallback.js",
  permissions: ["tasks:read"]
}
```

## Usage

```tsx
import { PluginHost } from "@/src/components/PluginHost";
import { initializeModuleFederation } from "@/src/lib/plugins/federation";

initializeModuleFederation({ plugins: [myPluginManifest] });

function Dashboard() {
  return <PluginHost pluginId="analytics-widget" context={{ workspaceId: "ws-1" }} />;
}
```

## Resilience features

- **Retry logic**: Configurable retry attempts with exponential backoff
- **Timeout protection**: Prevents hung plugin loads
- **Fallback entries**: Secondary entry points when primary fails
- **Lifecycle events**: `sorotask:plugin-lifecycle` for monitoring
- **Caching**: Loaded plugins are cached to avoid duplicate imports

## Security boundaries

- Plugins declare required permissions in their manifest
- Host passes scoped context; plugins cannot access parent state directly
- Failed loads render safe fallback UI instead of crashing the host

## Next.js integration

Plugins are loaded via dynamic `import()` which works with both Turbopack and webpack. For webpack-based deployments, manifests can point to remote module federation entry URLs.
