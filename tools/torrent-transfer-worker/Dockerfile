FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

ENV PORT=8787
ENV WORK_DIR=/data/jobs
RUN mkdir -p /data/jobs

EXPOSE 8787
CMD ["node", "server.mjs"]
