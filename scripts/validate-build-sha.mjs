import { validateSuppliedBuildSha } from "./build-identity.mjs";

const sourceSha = validateSuppliedBuildSha();
if (sourceSha)
  console.log(`build identity: validated ${sourceSha.slice(0, 12)}`);
else
  console.log(
    "build identity: PFH_BUILD_SHA not supplied; artifact identity will remain unavailable without Git metadata",
  );
