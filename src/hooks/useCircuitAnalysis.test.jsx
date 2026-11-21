import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LandingPage from '../components/LandingPage.jsx';
import { createCircuitAnalysis } from './useCircuitAnalysis.js';
import validCircuit from '../../tests/fixtures/sample_extracted_analysis.json';

const image = (name) => new File(['image'], name, { type: 'image/png' });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function render(state) {
  return renderToStaticMarkup(<LandingPage imageFile={state.file} imagePreviewUrl={state.file ? 'blob:image' : null}
    analysisState={state} />);
}

const isDisabled = (markup) => /<button[^>]*class="btn-continue-workspace"[^>]*disabled/.test(markup);

afterEach(() => vi.unstubAllGlobals());

describe('workspace entry waits for the latest circuit', () => {
  it('keeps the button and navigation unavailable when idle, uploading, analyzing, and reconstructing', async () => {
    const result = deferred();
    const validation = deferred();
    const request = vi.fn(() => result.promise);
    const analyzer = createCircuitAnalysis({ request, beforeReconstruction: () => validation.promise });
    const statuses = [];
    const unsubscribe = analyzer.subscribe(() => statuses.push(analyzer.getSnapshot().status));
    const open = vi.fn();
    const file = image('circuit.png');
    const currentMarkup = () => render(analyzer.getSnapshot());
    analyzer.openWorkspace(null, open);
    expect(analyzer.getSnapshot().status).toBe('idle');
    expect(isDisabled(currentMarkup())).toBe(true);
    expect(currentMarkup()).toContain('Continue to Workspace');

    const analysis = analyzer.analyzeImage(file);
    analyzer.openWorkspace(file, open);
    expect(isDisabled(currentMarkup())).toBe(true);
    expect(currentMarkup()).toContain('Uploading circuit image…');
    expect(currentMarkup()).toContain('Analyzing Circuit…');
    request.mock.calls[0][1].onUploaded();
    analyzer.openWorkspace(file, open);
    expect(isDisabled(currentMarkup())).toBe(true);
    expect(currentMarkup()).toContain('Analyzing circuit image…');
    result.resolve(validCircuit);
    await Promise.resolve();
    analyzer.openWorkspace(file, open);
    expect(currentMarkup()).toContain('Reconstructing and validating circuit…');
    expect(isDisabled(currentMarkup())).toBe(true);
    expect(open).not.toHaveBeenCalled();

    validation.resolve();
    await analysis;
    analyzer.openWorkspace(file, open);
    expect(open).toHaveBeenCalledOnce();
    expect(analyzer.getSnapshot().workspace.layout.ok).toBe(true);
    expect(isDisabled(currentMarkup())).toBe(false);
    expect(currentMarkup()).toContain('Continue to Workspace');
    expect(statuses).toEqual(['uploading', 'analyzing', 'reconstructing', 'success']);
    unsubscribe();
  });

  it('reports high demand and retries the same file only on request', async () => {
    class MockRequest extends EventTarget {
      static requests = [];
      upload = new EventTarget();
      open = vi.fn();
      send(body) { MockRequest.requests.push({ request: this, body }); }
      respond(status, response) {
        Object.assign(this, { status, response });
        this.dispatchEvent(new Event('load'));
      }
    }
    vi.stubGlobal('XMLHttpRequest', MockRequest);
    const analyzer = createCircuitAnalysis({ beforeReconstruction: async () => {} });
    const file = image('same-circuit.png');
    const open = vi.fn();
    const initial = analyzer.analyzeImage(file);
    MockRequest.requests[0].request.upload.dispatchEvent(new Event('load'));
    expect(analyzer.getSnapshot().status).toBe('analyzing');
    MockRequest.requests[0].request.respond(500, { detail: 'This model is currently experiencing high demand. Please try again later.' });
    await initial;
    expect(analyzer.getSnapshot()).toMatchObject({ status: 'error', file, canRetry: true });
    const markup = render(analyzer.getSnapshot());
    expect(markup).toContain('The analysis service is busy');
    expect(markup).toContain('Retry Analysis');
    expect(isDisabled(markup)).toBe(true);
    analyzer.openWorkspace(file, open);
    expect(open).not.toHaveBeenCalled();
    expect(MockRequest.requests).toHaveLength(1);

    const retry = analyzer.retryAnalysis(file);
    analyzer.retryAnalysis(file);
    expect(MockRequest.requests).toHaveLength(2);
    expect(MockRequest.requests.map(({ body }) => body.get('file').name)).toEqual(['same-circuit.png', 'same-circuit.png']);
    expect(analyzer.getSnapshot()).not.toHaveProperty('error');
    expect(isDisabled(render(analyzer.getSnapshot()))).toBe(true);
    MockRequest.requests[1].request.respond(200, validCircuit);
    await retry;
    analyzer.openWorkspace(file, open);
    expect(open).toHaveBeenCalledOnce();
  });

  it('ignores old responses and upload events even if the transport ignores abort', async () => {
    const old = deferred();
    const latest = deferred();
    const firstFile = image('first.png');
    const nextFile = image('next.png');
    const request = vi.fn().mockImplementationOnce(() => old.promise).mockImplementationOnce(() => latest.promise);
    const analyzer = createCircuitAnalysis({ request, beforeReconstruction: async () => {} });
    const first = analyzer.analyzeImage(firstFile);
    const second = analyzer.analyzeImage(nextFile);
    expect(request.mock.calls[0][1].signal.aborted).toBe(true);
    request.mock.calls[0][1].onUploaded();
    expect(analyzer.getSnapshot()).toEqual({ status: 'uploading', file: nextFile });
    latest.resolve(validCircuit);
    await second;
    const state = analyzer.getSnapshot();
    const open = vi.fn();
    analyzer.openWorkspace(firstFile, open);
    expect(open).not.toHaveBeenCalled();
    old.resolve({ contains_circuit: false, components: [] });
    await first;
    expect(analyzer.getSnapshot()).toBe(state);
    analyzer.openWorkspace(nextFile, open);
    expect(open).toHaveBeenCalledOnce();
  });

  it('clears a previously ready result immediately and ignores superseded reconstruction', async () => {
    const reconstruction = deferred();
    const beforeReconstruction = vi.fn().mockResolvedValueOnce().mockReturnValueOnce(reconstruction.promise);
    const request = vi.fn().mockResolvedValue(validCircuit);
    const analyzer = createCircuitAnalysis({ request, beforeReconstruction });
    const original = image('original.png');
    const replacement = image('replacement.png');
    await analyzer.analyzeImage(original);
    expect(analyzer.getSnapshot().status).toBe('success');

    const next = analyzer.analyzeImage(replacement);
    const open = vi.fn();
    expect(analyzer.getSnapshot().workspace).toBeUndefined();
    analyzer.openWorkspace(original, open);
    expect(open).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(analyzer.getSnapshot().status).toBe('reconstructing');
    analyzer.clearAnalysis();
    reconstruction.resolve();
    await next;
    expect(analyzer.getSnapshot().status).toBe('idle');
  });

  it.each([null, { contains_circuit: false, components: validCircuit.components }, { contains_circuit: true, components: [] },
    { contains_circuit: true, components: [{}] }, { ...validCircuit, components: [validCircuit.components[0], validCircuit.components[0]] }])(
    'refuses a response without a usable circuit', async (payload) => {
      const analyzer = createCircuitAnalysis({ request: async () => payload, beforeReconstruction: async () => {} });
      const file = image('invalid.png');
      await analyzer.analyzeImage(file);
      expect(analyzer.getSnapshot().status).toBe('error');
      const open = vi.fn();
      analyzer.openWorkspace(file, open);
      expect(open).not.toHaveBeenCalled();
    },
  );

  it('allows a drawable incomplete circuit so it can still be inspected', async () => {
    const analyzer = createCircuitAnalysis({ request: async () => ({ ...validCircuit, reconstruction_incomplete: true }), beforeReconstruction: async () => {} });
    const file = image('incomplete.png');
    await analyzer.analyzeImage(file);
    const state = analyzer.getSnapshot();
    expect(state.workspace.graph.incomplete).toBe(true);
    const open = vi.fn();
    analyzer.openWorkspace(file, open);
    expect(open).toHaveBeenCalledOnce();
  });
});
