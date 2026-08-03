const {
  detectAvailableBackends,
  selectProverBackend,
  withProofTiming,
  KNOWN_BACKENDS,
} = require('./lib/prover-backend');

describe('prover backend selection (Issue #850)', () => {
  test('detectAvailableBackends always reports CPU and never claims real acceleration', () => {
    const report = detectAvailableBackends({ env: {} });
    expect(report.cpu).toBe(true);
    expect(report.accelerationAvailable).toBe(false);
    expect(report.signals).toHaveProperty('cudaVisibleDevices');
    expect(report.signals).toHaveProperty('nvidiaSmi');
  });

  test('detectAvailableBackends reports the CUDA_VISIBLE_DEVICES signal when present', () => {
    const report = detectAvailableBackends({ env: { CUDA_VISIBLE_DEVICES: '0' } });
    expect(report.signals.cudaVisibleDevices).toBe(true);
    // A detected signal must NOT be mistaken for a working backend.
    expect(report.accelerationAvailable).toBe(false);
  });

  test('selectProverBackend defaults to CPU with no PROVER_BACKEND set', () => {
    const selection = selectProverBackend({ env: {} });
    expect(selection.backend).toBe('cpu');
    expect(selection.accelerated).toBe(false);
  });

  test('selectProverBackend treats PROVER_BACKEND=cpu as the CPU path', () => {
    const selection = selectProverBackend({ env: { PROVER_BACKEND: 'cpu' } });
    expect(selection.backend).toBe('cpu');
    expect(selection.accelerated).toBe(false);
  });

  test('selectProverBackend FAILS FAST when cuda is requested with no real backend', () => {
    expect(() => selectProverBackend({ env: { PROVER_BACKEND: 'cuda' } })).toThrow(
      /no real GPU backend is available/i,
    );
  });

  test('selectProverBackend FAILS FAST when metal is requested with no real backend', () => {
    expect(() => selectProverBackend({ env: { PROVER_BACKEND: 'metal' } })).toThrow(
      /no real GPU backend is available/i,
    );
  });

  test('selectProverBackend uses an injected GPU backend when one is provided', () => {
    const fakeCuda = { name: 'fake-cuda' };
    const selection = selectProverBackend({
      env: { PROVER_BACKEND: 'cuda' },
      gpuBackends: { cuda: fakeCuda },
    });
    expect(selection.backend).toBe('cuda');
    expect(selection.accelerated).toBe(true);
    expect(selection.impl).toBe(fakeCuda);
  });

  test('selectProverBackend rejects an unknown backend value', () => {
    expect(() => selectProverBackend({ env: { PROVER_BACKEND: 'quantum' } })).toThrow(
      /Unknown PROVER_BACKEND/,
    );
    expect(KNOWN_BACKENDS).toContain('cpu');
  });

  test('withProofTiming records a real wall-clock duration for a CPU proof call', async () => {
    const timed = await withProofTiming(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return { proofId: 'test' };
      },
      { backend: 'cpu', label: 'unit-test' },
    );
    expect(timed.result).toEqual({ proofId: 'test' });
    expect(typeof timed.durationMs).toBe('number');
    expect(timed.durationMs).toBeGreaterThan(0);
    expect(timed.backend).toBe('cpu');
    expect(timed.label).toBe('unit-test');
  });
});
