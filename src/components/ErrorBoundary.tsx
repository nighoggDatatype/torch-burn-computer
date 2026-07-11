import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
}

interface State {
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    const error = this.state.error
    if (error !== null) {
      return (
        <div
          style={{
            padding: 24,
            fontFamily: "'IBM Plex Mono', monospace",
            color: '#ff5d5d',
            letterSpacing: '0.1em',
            background: '#1a1d20',
            minHeight: '100vh',
          }}
        >
          ⚠ GUIDANCE COMPUTER FAULT
          <br />
          {error.name}
          <br />
          {error.message}
          <br />
          Reload to restart the nav subsystem.
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;