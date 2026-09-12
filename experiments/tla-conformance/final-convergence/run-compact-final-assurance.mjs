import { runCompactCommand } from "../../../scripts/compact-assurance-pipeline.mjs";
// Updated only after successful independent pristine certification; this is verifier authority, not evidence data.
const COMPACT_CERTIFICATE_COMMIT = "d3d8f24c68aff2cc819243f349e7498285436222";
await runCompactCommand({ moduleUrl: import.meta.url, mode: process.argv[2] ?? "verify", certificateCommit: COMPACT_CERTIFICATE_COMMIT });
