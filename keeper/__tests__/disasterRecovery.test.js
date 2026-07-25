const { MultiRegionRPCClient } = require('../src/disasterRecovery');

describe('MultiRegionRPCClient', () => {
  function createFakeServerFactory(handlersByUrl) {
    return (url) => {
      const handlers = handlersByUrl[url] || {};
      return {
        serverURL: { toString: () => url },
        getNetwork: handlers.getNetwork || (async () => ({ passphrase: 'test' })),
        getHealth: handlers.getHealth || (async () => ({ status: 'healthy' })),
        getLatestLedger: handlers.getLatestLedger || (async () => ({ sequence: 1 })),
      };
    };
  }

  test('uses active endpoint when healthy', async () => {
    const client = new MultiRegionRPCClient(['https://a.example', 'https://b.example'], {
      serverFactory: createFakeServerFactory({
        'https://a.example': {
          getNetwork: async () => ({ passphrase: 'A' }),
        },
      }),
    });

    const server = client.getServerFacade();
    const result = await server.getNetwork();

    expect(result.passphrase).toBe('A');
    expect(client.getStateSnapshot().activeRegion).toContain('a.example');
  });

  test('fails over to secondary endpoint after primary failure', async () => {
    const metrics = { increment: jest.fn(), updateFailoverState: jest.fn() };
    const client = new MultiRegionRPCClient(['https://a.example', 'https://b.example'], {
      metrics,
      failureThreshold: 1,
      serverFactory: createFakeServerFactory({
        'https://a.example': {
          getNetwork: async () => {
            throw new Error('primary down');
          },
        },
        'https://b.example': {
          getNetwork: async () => ({ passphrase: 'B' }),
        },
      }),
    });

    const server = client.getServerFacade();
    const result = await server.getNetwork();

    expect(result.passphrase).toBe('B');
    expect(client.getStateSnapshot().activeRegion).toContain('b.example');
    expect(metrics.increment).toHaveBeenCalledWith('failoverEventsTotal', 1);
    expect(metrics.increment).toHaveBeenCalledWith('failoverSwitchesTotal', 1);
  });

  test('throws structured error if all endpoints fail', async () => {
    const client = new MultiRegionRPCClient(['https://a.example', 'https://b.example'], {
      failureThreshold: 1,
      serverFactory: createFakeServerFactory({
        'https://a.example': {
          getNetwork: async () => {
            throw new Error('a down');
          },
        },
        'https://b.example': {
          getNetwork: async () => {
            throw new Error('b down');
          },
        },
      }),
    });

    const server = client.getServerFacade();

    await expect(server.getNetwork()).rejects.toMatchObject({
      code: 'RPC_MULTI_REGION_FAILOVER_EXHAUSTED',
    });
  });

  test('health checks recover endpoint after cooldown', async () => {
    let failHealth = true;
    const client = new MultiRegionRPCClient(['https://a.example', 'https://b.example'], {
      failureThreshold: 1,
      cooldownMs: 1,
      serverFactory: createFakeServerFactory({
        'https://a.example': {
          getHealth: async () => {
            if (failHealth) {
              throw new Error('unhealthy');
            }
            return { status: 'healthy' };
          },
        },
      }),
    });

    await client.runHealthCheck();
    expect(client.getStateSnapshot().endpoints[0].unavailable).toBe(true);

    failHealth = false;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await client.runHealthCheck();

    expect(client.getStateSnapshot().endpoints[0].unavailable).toBe(false);
  });

  test('returns latency heatmap matrix', async () => {
    const client = new MultiRegionRPCClient(['https://a.example', 'https://b.example'], {
      serverFactory: createFakeServerFactory({
        'https://a.example': {
          getNetwork: async () => ({ passphrase: 'A' }),
        },
      }),
    });

    const server = client.getServerFacade();
    await server.getNetwork();

    const heatmap = server.getLatencyHeatmap();
    expect(Array.isArray(heatmap)).toBe(true);
    expect(heatmap.length).toBe(2);
    expect(heatmap[0]).toHaveProperty('avgLatencyMs');
    expect(heatmap[0]).toHaveProperty('status');
  });
});
