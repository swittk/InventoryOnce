import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import { runInventoryFormalStorageRefinementSuite } from "./formal-storage-refinement-suite.js";

runInventoryFormalStorageRefinementSuite("memory", ({ failpoint }) =>
  createInMemoryInventoryDurableStorage(
    failpoint === undefined ? {} : { failpoint }
  )
);
