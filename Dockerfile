# XibataPaterna não tem dependências: a imagem é só o runtime + o código.
FROM node:22-alpine

# su-exec derruba o privilégio no entrypoint, depois de ajustar o volume.
RUN apk add --no-cache su-exec

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    TZ_APP=America/Sao_Paulo

WORKDIR /app
COPY package.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY scripts/ ./scripts/
COPY docker-entrypoint.sh /usr/local/bin/

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /data \
    && chown -R node:node /data /app

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Sobe como root só para ajustar o volume; o entrypoint troca para o usuário node.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
