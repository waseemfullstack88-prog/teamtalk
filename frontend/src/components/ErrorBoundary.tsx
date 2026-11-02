import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Shield, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in TeamTalk:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            width: '100vw',
            background: 'linear-gradient(180deg, #0b141a 0%, #111b21 100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px 20px',
            color: '#ffffff',
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 30px rgba(16, 185, 129, 0.35)',
              marginBottom: 20,
            }}
          >
            <Shield size={32} color="#ffffff" />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>TeamTalk Recovered</h2>
          <p style={{ fontSize: 13, color: '#8696a0', maxWidth: 360, margin: '0 0 24px', lineHeight: 1.5 }}>
            An unexpected view glitch was caught safely without affecting your encrypted session.
          </p>
          <button
            onClick={this.handleReload}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 24px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              color: '#ffffff',
              border: 'none',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
            }}
          >
            <RefreshCw size={16} />
            <span>Continue to App</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

