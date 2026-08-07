FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY dist/relay-service ./dist/relay-service
COPY dist/subject-comm ./dist/subject-comm
ENV RELAY_HOST=0.0.0.0
ENV RELAY_PORT=8787
ENV RELAY_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "dist/relay-service/server.js"]
