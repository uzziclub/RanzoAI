// Last line of defense against a white screen in production: any render crash
// shows a calm, plain-language recovery card instead of a blank window.

import { Component, type ReactNode } from "react";

interface State { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error("Renderer crash:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-screen">
        <div className="clay-card" style={{ width: 420, padding: 30, textAlign: "center" }}>
          <div className="orb starting" style={{ width: 72, height: 72, margin: "0 auto 16px" }} />
          <h2 style={{ fontSize: 17, marginBottom: 8 }}>Something broke on the screen side</h2>
          <p className="small muted" style={{ marginBottom: 16 }}>
            Ranzo itself is fine — the window just hit a snag. Reloading usually fixes it.
            The technical details are in the log if you ever need them.
          </p>
          <button className="clay-btn primary" onClick={() => window.location.reload()}>Reload Ranzo</button>
        </div>
      </div>
    );
  }
}
