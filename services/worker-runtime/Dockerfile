FROM golang:1.23-alpine AS build

WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download

COPY . .
RUN go build -o /out/worker ./cmd/worker

FROM alpine:3.20

WORKDIR /app
COPY --from=build /out/worker /app/worker

CMD ["/app/worker"]
