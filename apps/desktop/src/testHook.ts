/**
 * Only in a test build (VITE_GA_TEST=1, see vite.config.ts): the services the interface's buttons call, for the
 * regression pass (tools/gameaccess-mcp) to call with the same parameters inside an installed app, where the
 * frontend's source is not there to import. A normal build does not include this file.
 */
import * as DigitalCatalog from "./catalog/DigitalCatalog";
import * as DigitalDownloadService from "./catalog/DigitalDownloadService";
import * as DigitalProcessManager from "./catalog/DigitalProcessManager";
import * as activation from "./activation";
import * as catalogCache from "./catalogCache";
import * as catalogFilterParams from "./catalogFilterParams";
import * as freezeJobs from "./freezeJobs";
import * as librarySearch from "./librarySearch";
import * as parentalControl from "./parentalControl";
import * as tasteProfile from "./tasteProfile";

// Named by their path under src, as the pass imports them from Vite in a development instance.
(window as unknown as { __gameAccessTest: unknown }).__gameAccessTest = {
  modules: {
    "catalog/DigitalCatalog.ts": DigitalCatalog,
    "catalog/DigitalDownloadService.ts": DigitalDownloadService,
    "catalog/DigitalProcessManager.ts": DigitalProcessManager,
    "activation.ts": activation,
    "catalogCache.ts": catalogCache,
    "catalogFilterParams.ts": catalogFilterParams,
    "freezeJobs.ts": freezeJobs,
    "librarySearch.ts": librarySearch,
    "parentalControl.ts": parentalControl,
    "tasteProfile.ts": tasteProfile,
  },
};
