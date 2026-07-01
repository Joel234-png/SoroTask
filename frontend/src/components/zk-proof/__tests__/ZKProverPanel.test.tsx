import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ZKProverPanel } from "../ZKProverPanel";
import type { ZkTask } from "@/src/lib/zk-proof";

const mockTasks: ZkTask[] = [
  {
    id: 1,
    contractAddress: "CAFE1234",
    functionName: "harvest_yield",
    interval: 3600,
    gasBalance: 10,
    status: "active",
  },
  {
    id: 2,
    contractAddress: "BEEF5678FAILS",
    functionName: "claim_yield",
    interval: 600,
    gasBalance: 5,
    status: "active",
  },
];

describe("ZKProverPanel", () => {
  const mockOnZkVerified = jest.fn();
  const mockOnAddLog = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    Element.prototype.scrollIntoView = jest.fn();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders the panel header", () => {
    render(
      <ZKProverPanel
        tasks={mockTasks}
        walletConnected={false}
        walletAddress={null}
        onZkVerified={mockOnZkVerified}
      />,
    );
    expect(
      screen.getByText("Zero-Knowledge (ZK) Proof Verification"),
    ).toBeInTheDocument();
  });

  it("shows task select options", () => {
    render(
      <ZKProverPanel
        tasks={mockTasks}
        walletConnected={false}
        walletAddress={null}
        onZkVerified={mockOnZkVerified}
      />,
    );
    expect(screen.getByText("Task #1 - harvest_yield (CAFE1234...)")).toBeInTheDocument();
    expect(screen.getByText("Task #2 - claim_yield (BEEF5678FA...)")).toBeInTheDocument();
  });

  it("shows warning when no tasks available", () => {
    render(
      <ZKProverPanel
        tasks={[]}
        walletConnected={false}
        walletAddress={null}
        onZkVerified={mockOnZkVerified}
      />,
    );
    expect(
      screen.getByText("No registered tasks available. Create a task first."),
    ).toBeInTheDocument();
  });

  it("switches between workspace and diagnostics tabs", () => {
    render(
      <ZKProverPanel
        tasks={mockTasks}
        walletConnected={false}
        walletAddress={null}
        onZkVerified={mockOnZkVerified}
      />,
    );

    fireEvent.click(screen.getByText("Diagnostics"));
    expect(screen.getByText("System Healthy")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Workspace"));
    expect(screen.getByText("1. ZK Generation Setup")).toBeInTheDocument();
  });

  it("generates proof and shows verify button", async () => {
    render(
      <ZKProverPanel
        tasks={mockTasks}
        walletConnected={true}
        walletAddress="GABC123"
        onZkVerified={mockOnZkVerified}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } });
    fireEvent.click(
      screen.getByText("Generate Zero-Knowledge Proof"),
    );

    act(() => { jest.advanceTimersByTime(300); });
    act(() => { jest.advanceTimersByTime(300); });
    act(() => { jest.advanceTimersByTime(300); });

    await waitFor(() => {
      expect(
        screen.getByText("Submit & Verify Proof On-Chain"),
      ).toBeInTheDocument();
    });
  });

  it("handles proof generation failure", async () => {
    render(
      <ZKProverPanel
        tasks={mockTasks}
        walletConnected={true}
        walletAddress="GABC123"
        onZkVerified={mockOnZkVerified}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } });
    fireEvent.click(screen.getByLabelText("Simulate Computational Proof Failure"));
    fireEvent.click(
      screen.getByText("Generate Zero-Knowledge Proof"),
    );

    act(() => { jest.advanceTimersByTime(300); });
    act(() => { jest.advanceTimersByTime(300); });

    await waitFor(() => {
      expect(
        screen.getByText(/Computational failure detected/i),
      ).toBeInTheDocument();
    });
  });

  it("handles full generate and verify lifecycle", async () => {
    render(
      <ZKProverPanel
        tasks={mockTasks}
        walletConnected={true}
        walletAddress="GABC123"
        onZkVerified={mockOnZkVerified}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } });
    fireEvent.click(
      screen.getByText("Generate Zero-Knowledge Proof"),
    );

    act(() => { jest.advanceTimersByTime(300); });
    act(() => { jest.advanceTimersByTime(300); });
    act(() => { jest.advanceTimersByTime(300); });

    await waitFor(() => {
      expect(
        screen.getByText("Submit & Verify Proof On-Chain"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Submit & Verify Proof On-Chain"));

    act(() => { jest.advanceTimersByTime(200); });
    act(() => { jest.advanceTimersByTime(200); });
    act(() => { jest.advanceTimersByTime(200); });
    act(() => { jest.advanceTimersByTime(200); });
    act(() => { jest.advanceTimersByTime(200); });

    await waitFor(() => {
      expect(
        screen.getByText("Verified & Secured On-Chain"),
      ).toBeInTheDocument();
    });
  });

  it("handles on-chain verification failure", async () => {
    render(
      <ZKProverPanel
        tasks={mockTasks}
        walletConnected={true}
        walletAddress="GABC123"
        onZkVerified={mockOnZkVerified}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } });
    fireEvent.click(
      screen.getByText("Generate Zero-Knowledge Proof"),
    );

    act(() => { jest.advanceTimersByTime(300); });
    act(() => { jest.advanceTimersByTime(300); });
    act(() => { jest.advanceTimersByTime(300); });

    await waitFor(() => {
      expect(
        screen.getByText("Submit & Verify Proof On-Chain"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Submit & Verify Proof On-Chain"));

    act(() => { jest.advanceTimersByTime(200); });
    act(() => { jest.advanceTimersByTime(200); });
    act(() => { jest.advanceTimersByTime(200); });
    act(() => { jest.advanceTimersByTime(200); });
    act(() => { jest.advanceTimersByTime(200); });

    await waitFor(() => {
      expect(
        screen.getByText(/On-chain verifier rejected the proof validity/i),
      ).toBeInTheDocument();
    });
  });

  it("copies proof JSON to clipboard", async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(
      <ZKProverPanel
        tasks={mockTasks}
        walletConnected={true}
        walletAddress="GABC123"
        onZkVerified={mockOnZkVerified}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } });
    fireEvent.click(
      screen.getByText("Generate Zero-Knowledge Proof"),
    );

    act(() => { jest.advanceTimersByTime(300); });
    act(() => { jest.advanceTimersByTime(300); });
    act(() => { jest.advanceTimersByTime(300); });

    await waitFor(() => {
      expect(screen.getByText("Copy Proof JSON")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Copy Proof JSON"));
    expect(writeTextMock).toHaveBeenCalled();
  });

  it("shows status badge during generating state", async () => {
    render(
      <ZKProverPanel
        tasks={mockTasks}
        walletConnected={true}
        walletAddress="GABC123"
        onZkVerified={mockOnZkVerified}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } });
    fireEvent.click(
      screen.getByText("Generate Zero-Knowledge Proof"),
    );

    expect(screen.getByText("Generating Proof")).toBeInTheDocument();

    act(() => { jest.advanceTimersByTime(300); });
    act(() => { jest.advanceTimersByTime(300); });
    act(() => { jest.advanceTimersByTime(300); });
  });

  it("shows error count on diagnostics tab", async () => {
    render(
      <ZKProverPanel
        tasks={mockTasks}
        walletConnected={true}
        walletAddress="GABC123"
        onZkVerified={mockOnZkVerified}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } });
    fireEvent.click(screen.getByLabelText("Simulate Computational Proof Failure"));
    fireEvent.click(
      screen.getByText("Generate Zero-Knowledge Proof"),
    );

    act(() => { jest.advanceTimersByTime(300); });
    act(() => { jest.advanceTimersByTime(300); });

    await waitFor(() => {
      const diagnosticsBtn = screen.getByText("Diagnostics");
      expect(diagnosticsBtn.querySelector("span")).toBeInTheDocument();
    });
  });

  it("calls onZkVerified after successful verification", async () => {
    render(
      <ZKProverPanel
        tasks={mockTasks}
        walletConnected={true}
        walletAddress="GABC123"
        onZkVerified={mockOnZkVerified}
        onAddLog={mockOnAddLog}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } });
    fireEvent.click(
      screen.getByText("Generate Zero-Knowledge Proof"),
    );

    act(() => { jest.advanceTimersByTime(300); });
    act(() => { jest.advanceTimersByTime(300); });
    act(() => { jest.advanceTimersByTime(300); });

    await waitFor(() => {
      expect(
        screen.getByText("Submit & Verify Proof On-Chain"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Submit & Verify Proof On-Chain"));

    act(() => { jest.advanceTimersByTime(200); });
    act(() => { jest.advanceTimersByTime(200); });
    act(() => { jest.advanceTimersByTime(200); });
    act(() => { jest.advanceTimersByTime(200); });
    act(() => { jest.advanceTimersByTime(200); });

    await waitFor(() => {
      expect(mockOnZkVerified).toHaveBeenCalledWith(1, expect.any(String));
      expect(mockOnAddLog).toHaveBeenCalled();
    });
  });
});
