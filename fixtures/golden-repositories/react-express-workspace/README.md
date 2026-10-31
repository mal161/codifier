# React and Express workspace fixture

This representative monorepo has separate frontend and backend TypeScript
projects. Each project uses the same `@/*` alias for a different source tree;
resolution must use the nearest project configuration rather than applying one
repository-wide alias map. The fixture contains no external dependencies and is
not executed by the analyzer.
