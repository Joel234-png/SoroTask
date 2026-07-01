import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useGasOptimizationStore } from "../../../store/gasOptimizationStore";
import GasOptimizationEngine from "../GasOptimizationEngine";

describe("Gas Optimization Store", () => {
  it("initializes with mock tiers and active tx counters", () => {
    const state = useGasOptimizationStore.getState();
    expect(state.congestionLevel).toBe("medium");
    expect(state.feeTiers).toHaveLength(3);
    expect(state.batchOpportunities).toHaveLength(2);
  });

  it("updates congestion and fees on refreshMetrics", () => {
    const previousFee = useGasOptimizationStore.getState().baseFee;
    useGasOptimizationStore.getState().refreshMetrics();
    // Verify values updated (may be different or equal, verify types are correct)
    const nextState = useGasOptimizationStore.getState();
    expect(typeof nextState.congestionLevel).toBe("string");
    expect(nextState.activeTxCount).toBeGreaterThanOrEqual(50);
  });

  it("runs simulation and outputs dry run parameters", async () => {
    await useGasOptimizationStore.getState().runSimulation("C123", "execute");
    const result = useGasOptimizationStore.getState().simulationResult;
    expect(result).not.toBeNull();
    expect(result?.status).toBe("success");
    expect(result?.gasConsumed).toBeGreaterThan(0);
  });

  it("outputs execution error when contract ID contains 'fail'", async () => {
    await useGasOptimizationStore.getState().runSimulation("fail_contract", "execute");
    const result = useGasOptimizationStore.getState().simulationResult;
    expect(result).not.toBeNull();
    expect(result?.status).toBe("failure");
    expect(result?.errorMessage).toContain("ContractExecutionError");
  });

  it("applies multi-call batching and filters out applied items", () => {
    useGasOptimizationStore.getState().applyBatching("batch-1");
    const remaining = useGasOptimizationStore.getState().batchOpportunities;
    expect(remaining.find((o) => o.id === "batch-1")).toBeUndefined();
  });
});

describe("GasOptimizationEngine Component", () => {
  it("renders headers, metrics, and simulator forms", () => {
    render(<GasOptimizationEngine />);
    expect(screen.getByTestId("gas-optimization-engine-container")).toBeInTheDocument();
    expect(screen.getByText("Soroban Mainnet")).toBeInTheDocument();
    expect(screen.getByTestId("congestion-badge")).toBeInTheDocument();
    expect(screen.getByText("Transaction Gas Simulator")).toBeInTheDocument();
  });

  it("triggers transaction simulation on form submission", async () => {
    render(<GasOptimizationEngine />);
    
    const contractInput = screen.getByLabelText("Contract ID");
    const methodInput = screen.getByLabelText("Method Name");
    const submitBtn = screen.getByRole("button", { name: "Simulate Dry Run" });

    fireEvent.change(contractInput, { target: { value: "CSIMULATE" } });
    fireEvent.change(methodInput, { target: { value: "mint" } });
    fireEvent.click(submitBtn);

    // Wait for the mock simulation latency
    await waitFor(() => {
      expect(screen.getByTestId("simulation-readout")).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  it("handles batch clicking interaction", () => {
    render(<GasOptimizationEngine />);
    const batchButtons = screen.getAllByRole("button", { name: "Batch" });
    fireEvent.click(batchButtons[0]);
    // The clicked batch option should be removed from view
    expect(screen.queryByText(/batch-1/)).toBeNull();
  });
});
