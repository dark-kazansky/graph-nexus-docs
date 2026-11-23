/**
 * Web worker for slow work off the main thread:
 *  - graph measures (betweenness, closeness): loads the items, runs the measure, and posts
 *    progress then the result;
 *  - layouts ({ layout, nodes, links, opts }): runs runLayout on the copies it was sent and
 *    posts the positioned nodes back.
 */
import { createGraphEngine } from './graphEngine.js';
import { runLayout } from './layouts.js';

self.onmessage = async ({ data }) => {
  try {
    if (data.layout) {
      runLayout(data.layout, data.nodes, data.links, data.opts);
      self.postMessage({ result: data.nodes });
      return;
    }
    const engine = createGraphEngine(data.engineOptions);
    engine.load({ items: data.items });
    const result = await engine[data.method]({ ...data.opts, onProgress: progress => self.postMessage({ progress }) });
    self.postMessage({ result });
  } catch (err) {
    self.postMessage({ error: String((err && err.message) || err) });
  }
};
