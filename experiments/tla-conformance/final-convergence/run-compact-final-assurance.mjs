import { runCompactCommand } from "../../../scripts/compact-assurance-pipeline.mjs";
// Updated only after successful independent pristine certification; this is verifier authority, not evidence data.
const COMPACT_CERTIFICATE_COMMIT = "ee6be70876706e4a5f038bd7f5b3e49552e7a8dd";
await runCompactCommand({ moduleUrl: import.meta.url, mode: process.argv[2] ?? "verify", certificateCommit: COMPACT_CERTIFICATE_COMMIT });
