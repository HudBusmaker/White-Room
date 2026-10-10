FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production STORAGE=firestore
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
# Cloud Run sends traffic to $PORT (8080)
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server.js"]
