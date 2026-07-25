const express = require('express');
const { ApolloServer } = require('apollo-server-express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const { typeDefs } = require('./graphql/schema');
const { resolvers } = require('./graphql/resolvers');
const { createContext, expressJwtAuth, requireRole, ROLES } = require('./graphql/auth');
const { metricsHandler } = require('./metrics');
const { createRateLimiter } = require('./rateLimiter');
const { openApiSpec } = require('./openapi');

function createExpressApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // OpenAPI v3 / Swagger UI (no auth required — public docs)
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
    customSiteTitle: 'SoroTask Indexer API Docs',
    swaggerOptions: { persistAuthorization: true },
  }));
  // Expose raw spec for programmatic consumers
  app.get('/api-docs.json', (_req, res) => res.json(openApiSpec));

  // Prometheus Metrics endpoint (exempt from rate limit/auth for scraper access)
  app.get('/metrics', metricsHandler);

  // Apply JWT Auth Middleware and Rate Limiter Engine across REST routes
  const rateLimiter = createRateLimiter({ defaultLimit: 100, windowSeconds: 60 });
  app.use(expressJwtAuth);
  app.use(rateLimiter);

  // REST API Routes
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      user: req.user || { role: ROLES.ANONYMOUS },
    });
  });

  app.get('/api/protected', requireRole(ROLES.USER), (req, res) => {
    res.json({
      message: 'Access granted to protected endpoint',
      user: req.user,
    });
  });

  return app;
}

async function startApiServer(port = 4000) {
  const app = createExpressApp();

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
      console.log(`OpenAPI v3 Docs ready at http://localhost:${port}/api-docs`);
      resolve(httpServer);
    });
  });
}

module.exports = { startApiServer, createExpressApp };
