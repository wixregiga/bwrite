import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthoringWorkspace } from "../contexts/authoring/index";
import { projectPathOf } from "../contexts/authoring/domain/project-path";
import { HttpUbiquitousLanguageRepository, loadRoots, loadRules } from "../contexts/authoring/browser/http-repository";
import { browserWorkspaceStorage } from "../contexts/authoring/browser/workspace-store";
import "./styles/styles.css";
import "./styles/kinds.css";
import "./styles/kind-picker.css";
import "./styles/palette.css";
import "./styles/vocabulary.css";

const root = createRoot(document.getElementById("root")!);
const roots = await loadRoots();
root.render(
  <StrictMode>
    {roots.ok ? (
      <AuthoringWorkspace
        launchRoot={projectPathOf(roots.value.launchRoot)}
        roots={roots.value.roots}
        repository={new HttpUbiquitousLanguageRepository()}
        storage={browserWorkspaceStorage()}
        rulesSource={loadRules}
      />
    ) : (
      <main className="bw-empty" role="alert">
        <h1 className="bw-empty__title">BWrite cannot reach its server</h1>
        <p className="bw-empty__body">{roots.message}</p>
      </main>
    )}
  </StrictMode>,
);
