FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
# Add python/make/g++ for building native modules like sqlite3
RUN apk add --no-cache python3 make g++
RUN npm install --legacy-peer-deps
COPY . .
# Start the indexer
CMD ["node", "src/index.js"]
