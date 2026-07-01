import React from "react";
import { render, act, renderHook } from "@testing-library/react";
import { useZKProverEngine } from "../useZKProverEngine";

describe("useZKProverEngine", () => {
  let scheduled: Array<{ fn: () => void; ms: number }>;

  function drainScheduled() {
    while (scheduled.length > 0) {
      const { fn } = scheduled.shift()!;
      fn();
    }
  }

  beforeEach(() => {
    scheduled = [];
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("initializes with idle state", () => {
    const { result } = renderHook(() =>
      useZKProverEngine({
        baseDelayMs: 0,
        now: () => 1000,
        schedule: (fn, ms) => {
          scheduled.push({ fn, ms });
        },
      }),
    );

    expect(result.current.state.status).toBe("idle");
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.isVerifying).toBe(false);
    expect(result.current.isBusy).toBe(false);
  });

  it("provides worker stats", () => {
    const { result } = renderHook(() =>
      useZKProverEngine({
        workerCount: 3,
        baseDelayMs: 0,
        now: () => 1000,
        schedule: (fn, ms) => {
          scheduled.push({ fn, ms });
        },
      }),
    );

    expect(result.current.workerStats.total).toBe(3);
    expect(result.current.workerStats.idle).toBe(3);
  });

  it("generates proof and updates state", async () => {
    const { result } = renderHook(() =>
      useZKProverEngine({
        workerCount: 2,
        baseDelayMs: 0,
        now: () => 1000,
        schedule: (fn, ms) => {
          scheduled.push({ fn, ms });
        },
      }),
    );

    let promise: Promise<any>;
    act(() => {
      promise = result.current.generateProof({
        taskCondition: "{}",
        secretData: "{}",
        verifierAddress: "VERIFIER",
        simulateCongestion: false,
        simulateFailure: false,
      });
    });

    expect(result.current.isGenerating).toBe(true);
    expect(result.current.isBusy).toBe(true);

    await act(async () => {
      drainScheduled();
      const proof = await promise!;
      expect(proof.status).toBe("success");
    });

    expect(result.current.state.status).toBe("idle");
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.isBusy).toBe(false);
  });

  it("handles generation failure", async () => {
    const { result } = renderHook(() =>
      useZKProverEngine({
        workerCount: 2,
        baseDelayMs: 0,
        now: () => 1000,
        schedule: (fn, ms) => {
          scheduled.push({ fn, ms });
        },
      }),
    );

    let promise: Promise<any>;
    act(() => {
      promise = result.current.generateProof({
        taskCondition: "{}",
        secretData: "{}",
        verifierAddress: "VERIFIER",
        simulateCongestion: false,
        simulateFailure: true,
      });
    });

    await act(async () => {
      drainScheduled();
      await expect(promise!).rejects.toThrow();
    });

    expect(result.current.state.status).toBe("failed");
    expect(result.current.isGenerating).toBe(false);
  });

  it("resets state", () => {
    const { result } = renderHook(() =>
      useZKProverEngine({
        workerCount: 2,
        baseDelayMs: 0,
        now: () => 1000,
        schedule: (fn, ms) => {
          scheduled.push({ fn, ms });
        },
      }),
    );

    act(() => {
      result.current.reset();
    });

    expect(result.current.state.status).toBe("idle");
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.isVerifying).toBe(false);
  });

  it("sets tasks", () => {
    const { result } = renderHook(() =>
      useZKProverEngine({
        workerCount: 2,
        baseDelayMs: 0,
        now: () => 1000,
        schedule: (fn, ms) => {
          scheduled.push({ fn, ms });
        },
      }),
    );

    act(() => {
      result.current.setTasks([
        {
          id: 1,
          contractAddress: "CAFE1234",
          functionName: "harvest",
          interval: 3600,
          gasBalance: 10,
          status: "active",
        },
      ]);
    });

    expect(result.current.engine.getTasks()).toHaveLength(1);
  });

  it("handles generate and verify lifecycle", async () => {
    const { result } = renderHook(() =>
      useZKProverEngine({
        workerCount: 2,
        baseDelayMs: 0,
        now: () => 1000,
        schedule: (fn, ms) => {
          scheduled.push({ fn, ms });
        },
      }),
    );

    let genPromise: Promise<any>;
    act(() => {
      genPromise = result.current.generateProof({
        taskCondition: "{}",
        secretData: "{}",
        verifierAddress: "VERIFIER",
        simulateCongestion: false,
        simulateFailure: false,
      });
    });

    let proof: any;
    await act(async () => {
      drainScheduled();
      proof = await genPromise!;
    });
    expect(proof.status).toBe("success");

    act(() => {
      result.current.setTasks([
        {
          id: 1,
          contractAddress: "CAFE1234",
          functionName: "harvest",
          interval: 3600,
          gasBalance: 10,
          status: "active",
        },
      ]);
    });

    let verPromise: Promise<any>;
    act(() => {
      verPromise = result.current.verifyProof(
        proof,
        "CAFE1234",
        "VERIFIER",
        "GABC123",
        true,
      );
    });

    await act(async () => {
      drainScheduled();
      const result_ = await verPromise!;
      expect(result_.success).toBe(true);
    });
  });
});
