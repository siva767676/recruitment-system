# Frontend image: build the Vite app, then serve the static bundle with nginx.
# nginx also reverse-proxies /api to the backend container so the SPA can keep
# using same-origin /api/* paths (matching the Vite dev proxy) with no code change.
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
