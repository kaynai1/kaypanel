FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY . .
RUN go mod tidy && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /kaypanel .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /kaypanel /usr/local/bin/kaypanel
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["kaypanel", "-config", "/data/config.yaml", "-listen", ":8080"]
