FROM node:20-alpine
RUN apk add --no-cache openssl openssl-dev libc6-compat
WORKDIR /app

# Pasang dependencies
COPY package*.json ./
RUN npm install

# Jana Prisma Client
COPY prisma ./prisma
RUN npx prisma generate

# Salin kod
COPY . .

EXPOSE 4000
RUN chmod +x docker-entrypoint.sh
ENTRYPOINT ["./docker-entrypoint.sh"]
