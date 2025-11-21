FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080

COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm i --production

COPY src ./src

EXPOSE 8080

CMD ["npm", "start"]
