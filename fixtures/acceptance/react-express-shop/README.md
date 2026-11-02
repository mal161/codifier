# Shop (Codifier acceptance fixture)

A small React + Express shop used by Codifier's Phase 6 acceptance walkthrough
(`fixtures/acceptance/walkthrough.ts`). It is not part of Codifier and is never
executed: Codifier analyzes it statically. Dependencies are declared but not
installed.

## Intended architecture

| Component          | Code                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Web UI             | `client/src/main.tsx`, `client/src/App.tsx`, `client/src/pages/*`, `client/src/components/*` |
| Client data access | `client/src/api/*`, `client/src/hooks/*`                                                     |
| HTTP API           | `server/src/index.ts`, `server/src/app.ts`, `server/src/routes/*`, `server/src/middleware/*` |
| Domain services    | `server/src/services/*`                                                                      |
| Persistence        | `server/src/db/*`                                                                            |
| Shared contracts   | `shared/src/*`                                                                               |

Intended dependencies: Web UI → Client data access, Web UI → Shared contracts,
Client data access → Shared contracts, HTTP API → Domain services,
Domain services → Persistence, Domain services → Shared contracts,
Persistence → Shared contracts.

## Known drift (deliberate)

`server/src/routes/cart.ts` clears the cart by calling `cartRepository`
directly instead of going through `cartService`, so the HTTP API depends on
Persistence. The walkthrough expects Codifier to report this, then fixes it.
