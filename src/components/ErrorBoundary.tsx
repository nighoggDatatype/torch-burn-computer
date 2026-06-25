import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(_: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
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
          Reload to restart the nav subsystem.
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;