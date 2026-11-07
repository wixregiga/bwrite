import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import {
  createFeatureEditorView,
  type FeatureEditorHandle,
  type FeatureEditorSettings,
  type FeatureEditorView,
} from "../editor/feature-editor-view";

interface FeatureEditorProps extends FeatureEditorSettings {
  ref?: Ref<FeatureEditorHandle>;
}

/** Hosts one Feature's CodeMirror view, created once; later props reach it through a ref. */
export function FeatureEditor(props: FeatureEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FeatureEditorView | null>(null);
  // Handlers are read through a ref so the editor is created exactly once.
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const view = createFeatureEditorView(hostRef.current!, () => latest.current);
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    viewRef.current?.setVocabulary(props.vocabulary);
  }, [props.vocabulary]);

  useEffect(() => {
    viewRef.current?.setTargets(props.targets);
  }, [props.targets]);

  useImperativeHandle(
    props.ref,
    () => ({
      focus() {
        viewRef.current?.focus();
      },
      select(from, to) {
        viewRef.current?.select(from, to);
      },
      inspectAtCursor() {
        return viewRef.current?.inspectAtCursor() ?? false;
      },
      applyReference(from, to, draft, wording) {
        viewRef.current?.applyReference(from, to, draft, wording);
      },
      placeRule(from, to, termId, rule) {
        viewRef.current?.placeRule(from, to, termId, rule);
      },
    }),
    [],
  );

  return <div ref={hostRef} className="bw-editor-host" />;
}
