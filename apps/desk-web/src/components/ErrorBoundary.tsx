import { Component, ErrorInfo, ReactNode } from 'react';
import { ErrorState } from './ui';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="ui-error-page">
          <ErrorState
            title="Algo deu errado"
            message={this.state.error?.message || 'Erro desconhecido'}
            onRetry={() => window.location.reload()}
            retryLabel="Recarregar página"
          />
        </div>
      );
    }

    return this.props.children;
  }
}
