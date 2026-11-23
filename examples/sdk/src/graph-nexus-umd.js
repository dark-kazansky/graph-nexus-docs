/**
 * UMD/IIFE build entry.
 *
 * esbuild with `--global-name=GraphNexus --format=iife` assigns this module's
 * default export to `window.GraphNexus`, so `GraphNexus.create(...)` resolves
 * to the object built in `graph-nexus.js`.
 */
import GraphNexus from './graph-nexus.js';

export default GraphNexus;
