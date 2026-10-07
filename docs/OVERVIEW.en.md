# Documentation overview (English)

The detailed design docs are written in Bangla. This page tells an English reader where to look.

| Topic | Where |
|---|---|
| API routes, roles, conventions, errors (English) | [09-api-reference.md](09-api-reference.md) |
| Code layout, auth, adding a page or endpoint, testing | [08-developer-guide.md](08-developer-guide.md) (Bangla, code samples in English) |
| System architecture: devices, bridge, server, clients | [03-architecture.md](03-architecture.md) |
| Device telemetry format and safety rules | [05-device-protocol.md](05-device-protocol.md) |
| Roadmap and remaining work | [06-roadmap.md](06-roadmap.md) |
| Business ideas | [07-business.md](07-business.md) |
| Service-layer conventions | [../dashboard/src/services/README.md](../dashboard/src/services/README.md), [../mobile/src/services/README.md](../mobile/src/services/README.md) |

In short: a Go + Gin + PostgreSQL/TimescaleDB backend, a React dashboard and an Expo mobile app
that share one REST API under `/api/v1`. The pump rules are a pure function with unit tests, and
the mobile app queues writes while offline. The hardware side (ESP32, MQTT) is not built yet.
