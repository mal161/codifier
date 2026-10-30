# TypeScript workspace monorepo fixture

This synthetic repository verifies inherited TypeScript path aliases and
resolution of package-root and package-subpath imports from local package
manifests. Workspace packages are identified by their in-repository
`package.json` names; package export targets must remain inside the package and
resolve to inventoried source files.
