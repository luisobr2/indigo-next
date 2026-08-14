@AGENTS.md

## Import convention: explicit `.ts` extensions for test-reachable modules

Any module that `node --test` loads — directly (a `*.test.ts` file) or
transitively (a project module that file imports, and so on down the
chain) — must import other project modules with an explicit `.ts`
extension (e.g. `import { x } from "./foo.ts"`, not `"./foo"`). Node's
native TS loader needs the extension to resolve the file; `npm test` runs
`node --test "src/**/*.test.ts"` with no bundler in front of it. `next
build` compiles extensioned imports fine too, including through the Edge
middleware chain, so there's no cost to applying this everywhere a module
might end up under test.
