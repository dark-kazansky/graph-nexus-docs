"""Where the Graph Nexus SDK lives, for the tools that read it (see sdk-path.mjs)."""
import os


def sdk_root(docs_root):
    candidates = [os.environ.get('GRAPH_NEXUS_SDK'), os.path.join(docs_root, '..', 'graph-nexus'), os.path.join(docs_root, '..', 'Graph Nexus')]
    for path in filter(None, candidates):
        if os.path.exists(os.path.join(path, 'src', 'graph-nexus.js')):
            return os.path.normpath(path)
    raise SystemExit('Graph Nexus SDK not found (tried %s). Set GRAPH_NEXUS_SDK.' % ', '.join(filter(None, candidates)))
