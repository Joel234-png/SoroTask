import React from "react";
import { render, screen } from "@testing-library/react";
import {
  ZKProverProvider,
  useZKProverEngineContext,
} from "../ZKProverProvider";

describe("ZKProverProvider", () => {
  it("provides engine context to children", () => {
    function TestChild() {
      const ctx = useZKProverEngineContext();
      return (
        <div>
          <span>Status: {ctx.state.status}</span>
          <span>Workers: {ctx.workerStats.total}</span>
        </div>
      );
    }

    render(
      <ZKProverProvider config={{ workerCount: 4, baseDelayMs: 0 }}>
        <TestChild />
      </ZKProverProvider>,
    );

    expect(screen.getByText("Status: idle")).toBeInTheDocument();
    expect(screen.getByText("Workers: 4")).toBeInTheDocument();
  });

  it("throws error when used outside provider", () => {
    function TestChild() {
      useZKProverEngineContext();
      return null;
    }

    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<TestChild />)).toThrow(
      "useZKProverEngineContext must be used within a ZKProverProvider",
    );
    consoleSpy.mockRestore();
  });

  it("accepts config overrides", () => {
    function TestChild() {
      const ctx = useZKProverEngineContext();
      return <div>Workers: {ctx.workerStats.total}</div>;
    }

    render(
      <ZKProverProvider config={{ workerCount: 8, baseDelayMs: 0 }}>
        <TestChild />
      </ZKProverProvider>,
    );

    expect(screen.getByText("Workers: 8")).toBeInTheDocument();
  });
});
