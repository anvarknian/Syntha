FROM golang:1.26-alpine AS build

WORKDIR /src/services/orchestrator
COPY services/orchestrator/go.mod services/orchestrator/go.sum* ./
RUN go mod download
COPY services/orchestrator/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/syntha-orchestrator .

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/syntha-orchestrator /syntha-orchestrator
USER nonroot:nonroot
ENTRYPOINT ["/syntha-orchestrator"]
