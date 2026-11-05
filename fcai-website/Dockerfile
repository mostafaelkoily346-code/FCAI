FROM node:24-alpine

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV TRUST_PROXY=1
ENV PORT=8080

WORKDIR /app
COPY --chown=node:node index.html package.json js css assets backend ./
USER node

EXPOSE 8080
CMD ["npm", "start"]
