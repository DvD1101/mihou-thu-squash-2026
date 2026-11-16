FROM node:24-slim

ENV NODE_ENV=production \
    PORT=10000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

WORKDIR /app

COPY package.json server.mjs ./
COPY public ./public

RUN mkdir -p /data

EXPOSE 10000

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||10000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
