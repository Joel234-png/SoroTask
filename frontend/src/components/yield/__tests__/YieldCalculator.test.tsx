import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { calculateYieldForecast } from "../../../lib/yield/calculator";
import { useYieldStore } from "../../../store/yieldStore";
import YieldCalculator from "../YieldCalculator";

describe("Yield Calculator Logic", () => {
  it("computes simple and gross compounding interest correctly", () => {
    const config = {
      principal: 1000,
      apr: 10,
      frequency: "annually" as const,
      durationYears: 2,
      gasFeePerTx: 0,
      keeperFeePerTx: 0,
      multiplier: 1.0,
    };

    const result = calculateYieldForecast(config);
    expect(result.finalSimple).toBe(1200); // 1000 + 1000*0.1*2
    expect(result.finalCompound).toBe(1210); // 1000 * (1.1)^2
    expect(result.finalNetCompound).toBe(1210); // no fees
    expect(result.totalFeesPaid).toBe(0);
    expect(result.depleted).toBe(false);
  });

  it("deducts transaction fees and flags depletion", () => {
    const config = {
      principal: 100,
      apr: 5,
      frequency: "daily" as const,
      durationYears: 1,
      gasFeePerTx: 2.0, // High fee
      keeperFeePerTx: 1.0,
      multiplier: 1.0,
    };

    const result = calculateYieldForecast(config);
    expect(result.depleted).toBe(true);
    expect(result.finalNetCompound).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("Yield Zustand Store", () => {
  it("initializes with default inputs and updates outputs on change", () => {
    const store = useYieldStore.getState();
    store.reset();
    expect(useYieldStore.getState().principal).toBe(1000);

    useYieldStore.getState().setInputs({ principal: 2000 });
    expect(useYieldStore.getState().principal).toBe(2000);
    expect(useYieldStore.getState().finalSimple).toBeGreaterThan(2000);
  });
});

describe("YieldCalculator Component", () => {
  it("renders parameters section and charts metrics", () => {
    render(<YieldCalculator />);
    expect(screen.getByTestId("yield-calculator-container")).toBeInTheDocument();
    expect(screen.getByText("Yield Configuration")).toBeInTheDocument();
    expect(screen.getByText("Gross Compounded Yield")).toBeInTheDocument();
    expect(screen.getByTestId("yield-chart-container")).toBeInTheDocument();
  });

  it("reacts to input slider events", () => {
    render(<YieldCalculator />);
    const sliders = screen.getAllByRole("slider");
    // Slider 0 is Principal slider
    fireEvent.change(sliders[0], { target: { value: "5000" } });
    expect(useYieldStore.getState().principal).toBe(5000);
  });
});
