import { runCompactCommand } from "../../../scripts/compact-assurance-pipeline.mjs";
await runCompactCommand({ moduleUrl: import.meta.url, mode: "registry" });
