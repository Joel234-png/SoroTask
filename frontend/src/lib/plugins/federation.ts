import { createPluginLoader, getPluginLoader, resetPluginLoader } from "./loader";
import { createPluginRegistry, getPluginRegistry, resetPluginRegistry } from "./registry";
import type {
  FederationConfig,
  PluginManifest,
  PluginRegistryEntry,
} from "./types";

export type ModuleFederationOptions = FederationConfig & {
  plugins?: PluginManifest[];
};

export function initializeModuleFederation(
  options: ModuleFederationOptions = {},
) {
  const registry = createPluginRegistry(options.plugins ?? []);
  const loader = createPluginLoader({
    defaultTimeoutMs: options.defaultTimeoutMs,
    retryAttempts: options.retryAttempts,
    retryDelayMs: options.retryDelayMs,
    onLoadError: options.onLoadError,
  });

  return {
    registry,
    loader,
    registerPlugin: (manifest: PluginManifest): PluginRegistryEntry =>
      registry.register(manifest),
    loadPlugin: (pluginId: string) => loader.loadById(pluginId),
    loadScope: (scope: string) => loader.loadByScope(scope),
    listPlugins: () => registry.list(),
  };
}

export function getModuleFederation() {
  return {
    registry: getPluginRegistry(),
    loader: getPluginLoader(),
  };
}

export function resetModuleFederation(): void {
  resetPluginRegistry();
  resetPluginLoader();
}

export {
  createPluginLoader,
  getPluginLoader,
  resetPluginLoader,
} from "./loader";
export {
  createPluginRegistry,
  getPluginRegistry,
  resetPluginRegistry,
} from "./registry";
export {
  PLUGIN_EVENT_NAME,
  type FederationConfig,
  type LoadedPlugin,
  type PluginComponentProps,
  type PluginLifecycleEvent,
  type PluginLoadResult,
  type PluginManifest,
  type PluginRegistryEntry,
  type PluginStatus,
} from "./types";
