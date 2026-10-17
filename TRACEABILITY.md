# Traceability Matrix

| Req ID | Description | Source files | Automated tests |
|---|---|---|---|
| FR-1.1 | Multi-sport taxonomy, event-sourced scoring | backend/src/db/seed.ts | backend/src/common/canonical.spec.ts |
| FR-1.2 | League & tournament setup | _in progress_ | _in progress_ |
| FR-1.3 | Fixture scheduling (RR, Swiss, SE, DE) | _in progress_ | _in progress_ |
| FR-1.4 | Standings & tie-breakers | _in progress_ | _in progress_ |
| FR-2.1 | Club profiles, tenant isolation | backend/src/db/seed.ts | _in progress_ |
| FR-2.2 | Roster & player registry | _in progress_ | _in progress_ |
| FR-2.3 | Merchandise store | _in progress_ | _in progress_ |
| FR-5.1 | Five-tier RBAC | _in progress_ | _in progress_ |
| NFR-3 | Concurrency correctness | _in progress_ | _in progress_ |
| NFR-4 | Offline tolerance | _in progress_ | _in progress_ |
| NFR-5 | Security | backend/src/main.ts, backend/src/common/error.filter.ts | _in progress_ |
| NFR-7 | Reproducibility | docker-compose.yml, backend/Dockerfile | _in progress_ |
