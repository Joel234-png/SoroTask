const express = require('express');
const { ApolloServer } = require('apollo-server-express');
const cors = require('cors');
const { typeDefs } = require('./graphql/schema');
const { resolvers } = require('./graphql/resolvers');
const { createContext } = require('./graphql/auth');

async function startApiServer(port = 4000) {
  const app = express();
  app.use(cors());

  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: createContext,
    // Enable introspection in MVP to test the API easily
    introspection: true,
  });

  await server.start();
  server.applyMiddleware({ app, path: '/graphql' });

  return new Promise((resolve) => {
    const httpServer = app.listen(port, () => {
      console.log(`🚀 GraphQL API ready at http://localhost:${port}${server.graphqlPath}`);
      resolve(httpServer);
    });
  });
}

module.exports = { startApiServer };
