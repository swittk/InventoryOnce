import { runCompactCommand } from "../../../scripts/compact-assurance-pipeline.mjs";
// Updated only after successful independent pristine certification; this is verifier authority, not evidence data.
const COMPACT_CERTIFICATE_COMMIT = "de015dba358b1ea8b3afc1b26eff4248bc6d0e8d";
await runCompactCommand({ moduleUrl: import.meta.url, mode: process.argv[2] ?? "verify", certificateCommit: COMPACT_CERTIFICATE_COMMIT });
