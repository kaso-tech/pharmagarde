import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  /** Affiché à la place de la carte si son rendu échoue. */
  fallback: ReactNode;
  children: ReactNode;
};

type State = { failed: boolean };

/**
 * Isole la carte : si la WebView ou MapLibre échoue (module natif absent du binaire, WebGL
 * indisponible…), l'écran Carte affiche un message au lieu de faire planter toute l'application.
 */
export class MapErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[PharmaMap] Rendu de la carte impossible", error.message, info.componentStack);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
