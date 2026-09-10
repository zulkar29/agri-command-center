# syntax=docker/dockerfile:1
# The whole app in one image: build the dashboard, build the Go API, then
# serve both from a single binary/port (the API serves STATIC_DIR=/web too).
FROM node:22-alpine AS web
WORKDIR /app
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/ .
RUN npm run build

FROM golang:1.25-alpine AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/farm-api ./cmd/server

FROM alpine:3.21
RUN adduser -D -u 10001 app && apk add --no-cache ca-certificates tzdata
USER app
COPY --from=build /out/farm-api /usr/local/bin/farm-api
COPY --from=web /app/dist /web
ENV TZ=Asia/Dhaka STATIC_DIR=/web
EXPOSE 8000
ENTRYPOINT ["farm-api"]
