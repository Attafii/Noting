# Task 1 - Workspace Scaffolding
## Deviations from Original Plan
1. Tailwind v4 PostCSS: Added @tailwindcss/postcss dep. postcss.config.js uses '@tailwindcss/postcss': {} instead of tailwindcss: {}.
2. TanStack Router v1 requires tsr.config.json (routesDirectory + generatedRouteTree) for file-based routing generation.
3. Build order: 'tsr generate && tsc && vite build' if route tree not committed. With tree committed, 'tsc && vite build' works.
4. Placeholder src/main.tsx + src/routes/{__root,index}.tsx created as stubs for build. Replaced by Task 2.
5. @tanstack/router-cli (npx) needed for initial route tree generation. Not added as dev dep — cli is ephemeral.
