import { PflegehelferService } from "../src/core/service.js";
import { clinicalWorkspaceFromEnvironment } from "../src/infrastructure/medplum-workspace.js";

if (process.env.PFH_STORAGE_MODE === undefined)
  process.env.PFH_STORAGE_MODE = "medplum";

const service = new PflegehelferService();
const workspace = clinicalWorkspaceFromEnvironment();
await workspace.initialize(service.fhirResources());
const status = await workspace.status();
if (!status.ready) throw new Error(status.message);
console.log(JSON.stringify(status, null, 2));
