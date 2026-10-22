import * as geo from 'geolib';
import { runSearch } from './routingCore.mjs';

// Network and React state stay outside the search worker.
let context = {};
onmessage = function({ data }) {
  if (data.type === 'init') { context = data; return; }
  try {
    const result = runSearch({ ...context, ...data }, { geo, onProgress: progress => postMessage({ status: 'progress', progress, searchId: data.searchId }) });
    postMessage({ status: 'finished', ...result, searchId: data.searchId });
  } catch (error) {
    postMessage({ status: 'error', message: error.message, searchId: data.searchId });
  }
};
