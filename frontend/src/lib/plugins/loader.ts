import type { ComponentType } from "react";
import type {
  FederationConfig,
  LoadedPlugin,
  PluginComponentProps,
  PluginLifecycleEvent,
  PluginLoadResult,
  PluginManifest,
  PluginStatus,
} from "./types";
import { PLUGIN_EVENT_NAME } from "./types";
import { getPluginRegistry } from "./registry";

type PluginModule = {
  default: ComponentType<PluginComponentProps>;
};

const pluginCache = new Map<string, LoadedPlugin>();

function emitLifecycle(event: PluginLifecycleEvent): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<PluginLifecycleEvent>(PLUGIN_EVENT_NAME, {
        detail: event,
      }),
    );
  }
}

function updateStatus(
  pluginId: string,
  status: PluginStatus,
  error?: string,
): void {
  emitLifecycle({
    pluginId,
    status,
    timestamp: new Date().toISOString(),
    error,
  });
}

async function importPluginModule(
  entry: string,
  timeoutMs: number,
): Promise<PluginModule> {
  const importPromise = import(/* webpackIgnore: true */ entry) as Promise<PluginModule>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Plugin load timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([importPromise, timeoutPromise]);
}

async function loadWithRetry(
  entry: string,
  attempts: number,
  delayMs: number,
  timeoutMs: number,
): Promise<PluginModule> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await importPluginModule(entry, timeoutMs);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  throw lastError ?? new Error("Plugin load failed");
}

export function createPluginLoader(config: FederationConfig = {}) {
  const timeoutMs = config.defaultTimeoutMs ?? 10000;
  const retryAttempts = config.retryAttempts ?? 2;
  const retryDelayMs = config.retryDelayMs ?? 500;

  const load = async (manifest: PluginManifest): Promise<PluginLoadResult> => {
    const cached = pluginCache.get(manifest.id);
    if (cached?.status === "ready") {
      return { plugin: cached, error: null, usedFallback: false };
    }

    updateStatus(manifest.id, "loading");

    try {
      const pluginModule = await loadWithRetry(
        manifest.entry,
        retryAttempts,
        retryDelayMs,
        timeoutMs,
      );

      const component =
        (pluginModule as { default?: ComponentType<PluginComponentProps> })?.default ??
        (pluginModule as ComponentType<PluginComponentProps>);

      const loaded: LoadedPlugin = {
        manifest,
        component,
        status: "ready",
        loadedAt: new Date().toISOString(),
      };

      pluginCache.set(manifest.id, loaded);
      updateStatus(manifest.id, "ready");

      return { plugin: loaded, error: null, usedFallback: false };
    } catch (primaryError) {
      const error =
        primaryError instanceof Error
          ? primaryError
          : new Error(String(primaryError));

      config.onLoadError?.(manifest.id, error);

      if (manifest.fallbackEntry) {
        try {
          const fallbackModule = await loadWithRetry(
            manifest.fallbackEntry,
            1,
            retryDelayMs,
            timeoutMs,
          );

          const loaded: LoadedPlugin = {
            manifest,
            component: fallbackModule.default,
            status: "fallback",
            loadedAt: new Date().toISOString(),
            error: error.message,
          };

          pluginCache.set(manifest.id, loaded);
          updateStatus(manifest.id, "fallback", error.message);

          return { plugin: loaded, error, usedFallback: true };
        } catch {
          // Fall through to error state
        }
      }

      const failed: LoadedPlugin = {
        manifest,
        component: () => null,
        status: "error",
        loadedAt: new Date().toISOString(),
        error: error.message,
      };

      pluginCache.set(manifest.id, failed);
      updateStatus(manifest.id, "error", error.message);

      return { plugin: failed, error, usedFallback: false };
    }
  };

  const loadById = async (pluginId: string): Promise<PluginLoadResult> => {
    const registry = getPluginRegistry();
    const entry = registry.get(pluginId);

    if (!entry) {
      const notFound = new Error(`Plugin "${pluginId}" is not registered`);
      return { plugin: null, error: notFound, usedFallback: false };
    }

    if (!entry.enabled) {
      const disabled = new Error(`Plugin "${pluginId}" is disabled`);
      return { plugin: null, error: disabled, usedFallback: false };
    }

    return load(entry);
  };

  const loadByScope = async (scope: string): Promise<PluginLoadResult[]> => {
    const registry = getPluginRegistry();
    const entries = registry.findByScope(scope);
    return Promise.all(entries.map((entry) => load(entry)));
  };

  const getCached = (pluginId: string): LoadedPlugin | undefined => {
    return pluginCache.get(pluginId);
  };

  const clearCache = (pluginId?: string): void => {
    if (pluginId) {
      pluginCache.delete(pluginId);
    } else {
      pluginCache.clear();
    }
  };

  return {
    load,
    loadById,
    loadByScope,
    getCached,
    clearCache,
  };
}

let globalLoader: ReturnType<typeof createPluginLoader> | null = null;

export function getPluginLoader(
  config?: FederationConfig,
): ReturnType<typeof createPluginLoader> {
  if (!globalLoader) {
    globalLoader = createPluginLoader(config);
  }
  return globalLoader;
}

export function resetPluginLoader(): void {
  globalLoader = null;
}
