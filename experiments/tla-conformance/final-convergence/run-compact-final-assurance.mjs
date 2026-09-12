import { runCompactCommand } from "../../../scripts/compact-assurance-pipeline.mjs";
// Updated only after successful independent pristine certification; this is verifier authority, not evidence data.
const COMPACT_CERTIFICATE_COMMIT = "013da8617c993db1c8e6506a492cf7882ada1842";
await runCompactCommand({ moduleUrl: import.meta.url, mode: process.argv[2] ?? "verify", certificateCommit: COMPACT_CERTIFICATE_COMMIT });
