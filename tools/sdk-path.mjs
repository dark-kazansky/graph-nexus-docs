// Where the docs and the Graph Nexus SDK live, for the tools that render or read the SDK.
// The SDK is a separate repository: set GRAPH_NEXUS_SDK, or check it out next to this one
// (../graph-nexus or "../Graph Nexus").
import { existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const docsRoot = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));

export function sdkRoot() {
  const candidates = [process.env.GRAPH_NEXUS_SDK, join(docsRoot, '..', 'graph-nexus'), join(docsRoot, '..', 'Graph Nexus')].filter(Boolean);
  const found = candidates.find(p => existsSync(join(p, 'src', 'graph-nexus.js')));
  if (!found) throw new Error(`Graph Nexus SDK not found (tried ${candidates.join(', ')}). Set GRAPH_NEXUS_SDK.`);
  return normalize(found);
}
