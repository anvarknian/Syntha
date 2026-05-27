FROM golang:1.26.3-alpine AS build

WORKDIR /src/apps/api
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download
COPY apps/api/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/syntha-api .

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/syntha-api /syntha-api
EXPOSE 8080 9090
USER nonroot:nonroot
ENTRYPOINT ["/syntha-api"]
