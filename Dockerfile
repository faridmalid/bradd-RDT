FROM node:18-bullseye

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json ./

# Copy workspace definitions
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/
COPY packages/client/package.json ./packages/client/

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build web frontend
RUN npm run build -w packages/web

# Build server
RUN npm run build -w packages/server

# Environment variables
ENV NODE_ENV=production
ENV PORT=5000
ENV DB_PATH=/data/database.sqlite

# Create data directory
RUN mkdir -p /data

# Expose port
EXPOSE 5000

# Start server (using node directly on built files for better performance)
# We need to set the working directory to the server package so relative paths work if any
WORKDIR /app/packages/server
CMD ["node", "dist/index.js"]