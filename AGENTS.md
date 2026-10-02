# centTrace agent instructions

For centTrace implementation, Catalyst configuration, deployment, authentication, Data Store, CRM lookup, or data migration work, read [`docs/CENTTRACE_PROJECT_CONTEXT.md`](docs/CENTTRACE_PROJECT_CONTEXT.md) first. Treat it as the durable project handoff and update it when architecture, schemas, deployment targets, or important behavior changes.

The active application is the React wrapper in `cent-trace/`, the tracker assets in `cent-trace/public/tracker/`, and the Advanced I/O function in `functions/cent_trace_function/`. The older HTML, CSS, and JavaScript files at the repository root are prototypes and are not deployed.

Before deployment:

1. Run `node --check` for every changed tracker JavaScript file.
2. Run `npm run build` from `cent-trace/`.
3. Bump the relevant query-string cache version in `cent-trace/public/tracker/index.html` and the iframe version in `cent-trace/src/App.js` when client assets change.
4. Confirm the active Catalyst account and project with `catalyst whoami` and `catalyst project:list`.
5. Deploy from the repository root with `catalyst deploy` only after the checks pass.

CRM integration in centTrace is read-only. Do not add code that modifies the CRM Release organization unless the user explicitly changes that requirement.

