import {
  createPluginLoader,
  getPluginLoader,
  resetPluginLoader,
} from "../loader";
import { getPluginRegistry, resetPluginRegistry } from "../registry";
import { PLUGIN_EVENT_NAME, type PluginManifest } from "../types";

const mockComponent = () => null;

jest.mock(
  "/plugins/analytics/index.js",
  () => ({ default: mockComponent }),
  { virtual: true },
);

const sampleManifest: PluginManifest = {
  id: "analytics-widget",
  name: "Analytics Widget",
  version: "1.0.0",
  entry: "/plugins/analytics/index.js",
  scope: "dashboard",
};

describe("plugin loader", () => {
  beforeEach(() => {
    resetPluginRegistry();
    resetPluginLoader();
    getPluginRegistry([sampleManifest]);
  });

  afterEach(() => {
    resetPluginRegistry();
    resetPluginLoader();
  });

  it("loads a registered plugin", async () => {
    const loader = createPluginLoader({ defaultTimeoutMs: 5000 });
    const result = await loader.loadById("analytics-widget");

    expect(result.error).toBeNull();
    expect(result.plugin?.status).toBe("ready");
    expect(result.plugin?.component).toBeDefined();
  });

  it("returns error for unknown plugin", async () => {
    const loader = createPluginLoader();
    const result = await loader.loadById("missing-plugin");

    expect(result.plugin).toBeNull();
    expect(result.error?.message).toContain("not registered");
  });

  it("caches loaded plugins", async () => {
    const loader = createPluginLoader();
    await loader.loadById("analytics-widget");

    const cached = loader.getCached("analytics-widget");
    expect(cached?.status).toBe("ready");
  });

  it("emits lifecycle events", async () => {
    const listener = jest.fn();
    window.addEventListener(PLUGIN_EVENT_NAME, listener);

    const loader = createPluginLoader();
    loader.clearCache("analytics-widget");
    await loader.loadById("analytics-widget");

    expect(listener).toHaveBeenCalled();
    window.removeEventListener(PLUGIN_EVENT_NAME, listener);
  });

  it("reuses singleton loader", () => {
    const first = getPluginLoader();
    const second = getPluginLoader();
    expect(first).toBe(second);
  });
});
