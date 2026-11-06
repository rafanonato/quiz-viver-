FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# O Cloud Run define a variável PORT (padrão 8080); o server.js já a respeita.
EXPOSE 8080
USER node
CMD ["node", "server.js"]
