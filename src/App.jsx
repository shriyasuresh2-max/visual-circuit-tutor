import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import LandingPage from './components/LandingPage.jsx';
import WorkspaceHeader from './components/WorkspaceHeader.jsx';
import WorkspaceParametersStrip from './components/WorkspaceParametersStrip.jsx';
import WorkspaceCalculatedStrip from './components/WorkspaceCalculatedStrip.jsx';
import CircuitDiagram from './components/CircuitDiagram.jsx';
import DcSolvePanel from './components/DcSolvePanel.jsx';
import AnalysisResultPanel from './components/AnalysisResultPanel.jsx';
import StepExplainer from './components/StepExplainer.jsx';
import ReferenceViewer from './components/ReferenceViewer.jsx';
import { solveOhmSeriesCircuit } from './circuit/circuitEngine.js';
import { buildGraph } from './circuit/electricalGraph.js';
import { applyComponentValues } from './circuit/componentValue.js';
import { useCircuitAnalysis } from './hooks/useCircuitAnalysis.js';
import './App.css';

export default function App() {
  // Page Navigation State: 'landing' (Page One) | 'workspace' (Page Two)
  const [currentView, setCurrentView] = useState('landing');

  // Shared Circuit Parameters (defaults: 12 V and 4 Ω)
  const [voltage, setVoltage] = useState(12);
  const [resistance, setResistance] = useState(4);

  // Active Explanation Step (0 to 3)
  const [activeStep, setActiveStep] = useState(0);

  // Uploaded Image State (persisted across pages)
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);

  // The question the student wants answered. Entered on the landing page and
  // held here so it survives navigation to the workspace and stays available
  // to the solving stage.
  const [questionText, setQuestionText] = useState('');

  // The circuit the user saved after editing. Kept apart from the uploaded
  // image and the question so neither is ever overwritten by an edit, and
  // handed to the solving stage as the circuit to solve.
  const [savedCircuit, setSavedCircuit] = useState(null);

  // Which upload `savedCircuit` belongs to. A saved document is only ever used
  // for the image it was produced from, so a remount of the diagram cannot
  // mistake it for a different circuit's save.
  const [savedCircuitImageId, setSavedCircuitImageId] = useState(null);
  const [imageId, setImageId] = useState(null);
  const imageIdSeq = useRef(0);
  const [componentValues, setComponentValues] = useState(() => new Map());
  const [lessonFocus, setLessonFocus] = useState(null);

  // Reference Viewer Drawer State (in workspace)
  const [isReferenceOpen, setIsReferenceOpen] = useState(false);

  // Circuit analysis state managed by the custom hook
  const { analysisState, analyzeImage, clearAnalysis } = useCircuitAnalysis();
  const extractedAnalysis = analysisState.status === 'success' ? analysisState.result : null;
  const analysisResult = useMemo(
    () => applyComponentValues(extractedAnalysis, componentValues),
    [extractedAnalysis, componentValues],
  );
  const electricalGraph = useMemo(
    () => analysisResult?.contains_circuit !== false && analysisResult?.components?.length
      ? buildGraph(analysisResult)
      : null,
    [analysisResult],
  );

  const handleApplyComponentValues = useCallback((updates) => {
    if (updates.size > 0) setComponentValues((previous) => new Map([...previous, ...updates]));
  }, []);
  const handleLessonStep = useCallback((step) => {
    setLessonFocus((previous) => {
      if (step) return { step, graph: electricalGraph, imageId };
      return previous?.graph === electricalGraph && previous?.imageId === imageId ? null : previous;
    });
  }, [electricalGraph, imageId]);
  const lessonStep = lessonFocus && lessonFocus.graph === electricalGraph && lessonFocus.imageId === imageId
    ? lessonFocus.step
    : null;

  // Accept a freshly saved circuit from the diagram's editor, tagged with the
  // upload it came from.
  const handleCircuitSaved = useCallback((circuit, sourceImageId = null) => {
    setSavedCircuit(circuit);
    setSavedCircuitImageId(sourceImageId);
  }, []);

  // Derive circuit solution using pure engine logic
  const circuitResult = useMemo(() => {
    return solveOhmSeriesCircuit({ voltage, resistance });
  }, [voltage, resistance]);

  // Handle resetting back to standard circuit values
  const handleResetDefaults = () => {
    setVoltage(12);
    setResistance(4);
    setActiveStep(0);
  };

  // Handle returning to landing page for a new problem
  const handleNewProblem = () => {
    setCurrentView('landing');
    setIsReferenceOpen(false);
  };

  // Handle image selection: revoke old URL, update state, trigger analysis
  const handleImageSelected = useCallback((file, previewUrl) => {
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }

    setImageFile(file);
    setImagePreviewUrl(previewUrl);

    // Clear any previous analysis result before starting a new one
    clearAnalysis();
    analyzeImage(file);

    // A saved circuit belongs to the image it was edited from, so a new upload
    // starts a new identity and a clean slate.
    imageIdSeq.current += 1;
    setImageId(imageIdSeq.current);
    setSavedCircuit(null);
    setSavedCircuitImageId(null);
    setComponentValues(new Map());
  }, [imagePreviewUrl, analyzeImage, clearAnalysis]);

  // Handle image removal: revoke URL, clear image and analysis state
  const handleImageRemoved = useCallback(() => {
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setImageFile(null);
    setImagePreviewUrl(null);
    setIsReferenceOpen(false);
    clearAnalysis();
    setImageId(null);
    setSavedCircuit(null);
    setSavedCircuitImageId(null);
    setComponentValues(new Map());
  }, [imagePreviewUrl, clearAnalysis]);

  // Cleanup object URL on unmount
  useEffect(() => {
    return () => {
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);

  // Keyboard navigation for step progression (ArrowLeft / ArrowRight)
  const handleKeyDown = useCallback(
    (e) => {
      if (currentView !== 'workspace') return;
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

      if (e.key === 'ArrowRight') {
        setActiveStep((prev) => Math.min(prev + 1, (circuitResult.steps?.length || 4) - 1));
      } else if (e.key === 'ArrowLeft') {
        setActiveStep((prev) => Math.max(prev - 1, 0));
      }
    },
    [currentView, circuitResult.steps]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const exampleParameters = (
    <>
      <WorkspaceParametersStrip
        voltage={voltage}
        resistance={resistance}
        onVoltageChange={setVoltage}
        onResistanceChange={setResistance}
        error={circuitResult.error}
      />
      <WorkspaceCalculatedStrip circuitResult={circuitResult} />
    </>
  );
  const exampleSteps = (
    <StepExplainer
      steps={circuitResult.steps}
      activeStep={activeStep}
      onStepChange={setActiveStep}
      isValid={circuitResult.isValid}
    />
  );

  return (
    <div className="app-root">
      {currentView === 'landing' ? (
        /* PAGE ONE: LANDING AND UPLOAD */
        <LandingPage
          imageFile={imageFile}
          imagePreviewUrl={imagePreviewUrl}
          onImageSelected={handleImageSelected}
          onImageRemoved={handleImageRemoved}
          onContinueToWorkspace={() => setCurrentView('workspace')}
          analysisState={analysisState}
          questionText={questionText}
          onQuestionChange={setQuestionText}
        />
      ) : (
        /* PAGE TWO: CIRCUIT LEARNING WORKSPACE */
        <div className="workspace-screen">
          {/* 1. Top Compact Header */}
          <WorkspaceHeader
            onNewProblem={handleNewProblem}
            onResetDefaults={handleResetDefaults}
            hasReferenceImage={Boolean(imagePreviewUrl)}
            isReferenceOpen={isReferenceOpen}
            onToggleReference={() => setIsReferenceOpen((prev) => !prev)}
          />

          {!imageFile && exampleParameters}
          <main className="workspace-main-grid">
            <section className="circuit-column" aria-label="Circuit Schematic Visualisation">
              {imageFile && !electricalGraph ? (
                <AnalysisResultPanel analysisState={analysisState} />
              ) : (
                <CircuitDiagram
                  circuitResult={circuitResult}
                  activeStep={activeStep}
                  onSelectStep={setActiveStep}
                  analysisResult={analysisResult}
                  electricalGraph={electricalGraph}
                  lessonStep={lessonStep}
                  reconstructionKey={extractedAnalysis}
                  onSaveCircuit={handleCircuitSaved}
                  imageId={imageId}
                  savedCircuit={
                    savedCircuitImageId !== null && savedCircuitImageId === imageId
                      ? savedCircuit
                      : null
                  }
                />
              )}
            </section>

            <section className="explanation-column" aria-label="Circuit solution and explanation">
              {imageFile ? electricalGraph && (
                <DcSolvePanel
                  key={imageId}
                  graph={electricalGraph}
                  onApplyValues={handleApplyComponentValues}
                  questionText={questionText}
                  onStepChange={handleLessonStep}
                />
              ) : exampleSteps}
            </section>
          </main>

          {/* Expandable Reference Diagram Drawer (includes analysis results) */}
          <ReferenceViewer
            isOpen={isReferenceOpen}
            onClose={() => setIsReferenceOpen(false)}
            imageFile={imageFile}
            imagePreviewUrl={imagePreviewUrl}
            analysisState={analysisState}
          />
        </div>
      )}
    </div>
  );
}
