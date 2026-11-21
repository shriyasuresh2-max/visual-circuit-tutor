import { useEffect, useState, useSyncExternalStore } from 'react';
import { buildGraph, layoutCircuit } from '../circuit/circuitLayout.js';

const API_URL = 'http://127.0.0.1:8000/api/analyze-image';
const acceptedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const idle = { status: 'idle', file: null };

export const analysisIsPending = (status) => ['uploading', 'analyzing', 'reconstructing'].includes(status);

export function canOpenWorkspace(state, file) {
  return Boolean(file && state?.file === file && state.status === 'success' && state.workspace);
}

function responseError(status, detail) {
  const message = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map(({ msg }) => msg).filter(Boolean).join('; ') : '';
  if ([429, 503].includes(status) || /high demand|overloaded/i.test(message)) {
    return 'The analysis service is busy. Please wait a moment, then choose Retry Analysis.';
  }
  return message || `The image could not be analyzed (server error ${status}).`;
}

// The upload event separates the file transfer from the wait for analysis.
export function requestAnalysis(file, { signal, onUploaded }) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const finish = (callback, value) => {
      signal.removeEventListener('abort', abort);
      callback(value);
    };
    if (signal.aborted) { reject(new DOMException('Request cancelled', 'AbortError')); return; }
    request.open('POST', API_URL);
    request.responseType = 'json';
    request.upload.addEventListener('load', onUploaded);
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) finish(resolve, request.response);
      else finish(reject, new Error(responseError(request.status, request.response?.detail)));
    });
    request.addEventListener('abort', () => finish(reject, new DOMException('Request cancelled', 'AbortError')));
    request.addEventListener('error', () => finish(reject, new Error('Could not reach the analysis service. Check that the backend is running, then try again.')));
    const body = new FormData();
    body.append('file', file);
    signal.addEventListener('abort', abort, { once: true });
    try {
      request.send(body);
    } catch (error) {
      finish(reject, error);
    }
  });
}

function reconstruct(result) {
  if (result?.contains_circuit === false || (Array.isArray(result?.components) && result.components.length === 0)) {
    throw new Error('No circuit was detected. Try a clearer image that shows the full circuit.');
  }
  const { components, connections = [], unclear_details: details = [] } = result ?? {};
  if (!Array.isArray(components) || !Array.isArray(connections) || connections.some((connection) => !connection) ||
      !Array.isArray(details) || details.some((note) => typeof note !== 'string') ||
      components.some((component) => typeof component?.id !== 'string' || !component.id.trim() ||
        typeof component.type !== 'string' || !component.type.trim()) ||
      new Set(components.map(({ id }) => id.trim())).size !== components.length) {
    throw new Error('The analysis service returned an invalid circuit response. Please try again.');
  }
  const graph = buildGraph(result);
  const layout = layoutCircuit(result, graph);
  // Incomplete but drawable circuits can still be inspected and corrected.
  if (!layout?.ok || !layout.components?.length) throw new Error('The detected circuit could not be drawn. Try a clearer image or retry the analysis.');
  return { graph, layout };
}

export function createCircuitAnalysis({ request = requestAnalysis, beforeReconstruction = () => new Promise((resolve) => setTimeout(resolve, 0)) } = {}) {
  let state = idle;
  let active = null;
  const listeners = new Set();
  const publish = (next) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const cancel = () => {
    const previous = active;
    active = null;
    previous?.abort();
  };

  async function analyzeImage(file) {
    if (!file) return;
    cancel();
    if (!acceptedTypes.has(file.type)) {
      publish({ status: 'error', file, error: 'Unsupported format. Please choose a PNG, JPG, or WebP image.' });
      return;
    }
    const controller = new AbortController();
    active = controller;
    const isLatest = () => active === controller;
    publish({ status: 'uploading', file });
    try {
      const result = await request(file, { signal: controller.signal, onUploaded: () => {
        if (isLatest() && state.status === 'uploading') publish({ status: 'analyzing', file });
      } });
      if (!isLatest()) return;
      publish({ status: 'reconstructing', file });
      await beforeReconstruction();
      if (!isLatest()) return;
      const workspace = reconstruct(result);
      publish({ status: 'success', file, result, workspace });
    } catch (error) {
      if (isLatest()) publish({ status: 'error', file, error: error?.message || 'The circuit could not be analyzed. Please try again.', canRetry: true });
    } finally {
      if (isLatest()) active = null;
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    analyzeImage,
    openWorkspace(file, onReady) {
      if (canOpenWorkspace(state, file)) onReady();
    },
    retryAnalysis(file) {
      if (state.file === file && state.status === 'error' && state.canRetry) return analyzeImage(file);
    },
    clearAnalysis() {
      cancel();
      publish(idle);
    },
    cancel,
  };
}

export function useCircuitAnalysis() {
  const [analysis] = useState(() => createCircuitAnalysis());
  const analysisState = useSyncExternalStore(analysis.subscribe, analysis.getSnapshot, analysis.getSnapshot);
  useEffect(() => analysis.cancel, [analysis]);
  return { analysisState, openWorkspace: analysis.openWorkspace, analyzeImage: analysis.analyzeImage,
    retryAnalysis: analysis.retryAnalysis, clearAnalysis: analysis.clearAnalysis };
}
