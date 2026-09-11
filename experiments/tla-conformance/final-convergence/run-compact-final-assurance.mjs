import { runCompactCommand } from "../../../scripts/compact-assurance-pipeline.mjs";
// Updated only after successful independent pristine certification; this is verifier authority, not evidence data.
const COMPACT_CERTIFICATE_COMMIT = "88842dd74980121b7dbb54245fda92f932588427";
await runCompactCommand({ moduleUrl: import.meta.url, mode: process.argv[2] ?? "verify", certificateCommit: COMPACT_CERTIFICATE_COMMIT });
