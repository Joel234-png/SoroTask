const express = require('express');
const { ApolloServer } = require('apollo-server-express');
const cors = require('cors');
const { typeDefs } = require('./graphql/schema');
const { resolvers } = require('./graphql/resolvers');
const { createContext } = require('./graphql/auth');
const dbHelpers = require('./graphql/db');
const { ensureSchema, buildMerkleProofResponse } = require('./merkleStore');
const { metricsHandler } = require('./metrics');
const { createRateLimiter } = require('./rateLimiter');
const { traceContextMiddleware } = require('../../scripts/traceContext');

/**
 * Register REST routes that live alongside the GraphQL endpoint.
 * Exposed separately so it can be mounted on a bare Express app in tests.
 */
function registerRestRoutes(app, deps = dbHelpers) {
  // Attach W3C TraceContext middleware
  app.use(traceContextMiddleware('indexer'));

  // Attach rate limiter middleware
  app.use(createRateLimiter());

  // Metrics endpoint
  app.get('/metrics', metricsHandler);

  // Health and protected endpoint routes for REST API
  app.get('/api/health', (req, res) => {
    const context = createContext({ req });
    res.json({ status: 'ok', user: context.user });
  });

  app.get('/api/protected', (req, res) => {
    const context = createContext({ req });
    if (!context.user || context.user.role === 'ANONYMOUS') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json({ message: 'Access granted' });
  });

  // Issue #863: cryptographic Merkle inclusion proofs for a ledger's events.
  app.get('/events/:ledger/merkle-proof', async (req, res) => {
    const ledger = Number(req.params.ledger);
    if (!Number.isInteger(ledger)) {
      return res.status(400).json({ error: 'ledger must be an integer' });
    }
    try {
      const { status, body } = await buildMerkleProofResponse(
        deps,
        ledger,
        req.query.eventId,
      );
      return res.status(status).json(body);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  return app;
}

function createExpressApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  registerRestRoutes(app);

  return app;
}

async function startApiServer(port = 4000) {
  const app = createExpressApp();
  await ensureSchema(dbHelpers);

  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: createContext,
    introspection: true,
  });

  await server.start();
  server.applyMiddleware({ app, path: '/graphql' });

  return new Promise((resolve) => {
    const httpServer = app.listen(port, () => {
      console.log(`GraphQL API ready at http://localhost:${port}${server.graphqlPath}`);
      console.log(`Prometheus Metrics ready at http://localhost:${port}/metrics`);
      resolve(httpServer);
    });
  });
}

module.exports = { createExpressApp, startApiServer, registerRestRoutes };
