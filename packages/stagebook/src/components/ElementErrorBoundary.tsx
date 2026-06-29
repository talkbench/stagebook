import React from "react";
import {
  useStagebookContext,
  useMessages,
  useIsRTL,
} from "./StagebookProvider.js";

export interface ElementErrorInfo {
  elementType: string;
  elementName?: string;
  error: Error;
  errorInfo: React.ErrorInfo;
}

interface ElementErrorBoundaryInnerProps {
  elementType: string;
  elementName?: string;
  onElementError?: (info: ElementErrorInfo) => void;
  // Resolved from the active locale's catalog by the functional wrapper (a
  // class component can't use the useMessages hook).
  fallbackText: string;
  fallbackDir: "rtl" | "ltr";
  children: React.ReactNode;
}

interface ElementErrorBoundaryState {
  hasError: boolean;
}

class ElementErrorBoundaryInner extends React.Component<
  ElementErrorBoundaryInnerProps,
  ElementErrorBoundaryState
> {
  state: ElementErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ElementErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const { elementType, elementName, onElementError } = this.props;
    const label = elementName ? `${elementType} "${elementName}"` : elementType;

    // Full technical payload — for researchers debugging locally without a
    // configured crash reporter. Single call per crash.
    console.error(`[Stagebook] Element ${label} crashed during render`, {
      elementType,
      elementName,
      error,
      errorInfo,
    });

    // Host-provided; isolate so a buggy crash reporter can't break
    // Stagebook's containment guarantees (or prevent the async re-throw
    // below from firing).
    if (onElementError) {
      try {
        onElementError({ elementType, elementName, error, errorInfo });
      } catch (callbackError) {
        console.error(
          "[Stagebook] onElementError callback threw; ignoring",
          callbackError,
        );
      }
    }

    // Async re-throw so `window.onerror` / sentry / any global handler sees
    // the original error. Scheduling it via setTimeout means React's error
    // boundary machinery has already unwound by the time the throw happens,
    // so it propagates to the host's uncaught-error handler.
    setTimeout(() => {
      throw error;
    }, 0);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          dir={this.props.fallbackDir}
          data-testid="element-error-fallback"
          style={{
            padding: "0.75rem 1rem",
            border: "1px solid var(--stagebook-danger, #dc2626)",
            borderRadius: "0.375rem",
            color: "var(--stagebook-danger, #dc2626)",
            backgroundColor: "var(--stagebook-danger-bg, #fef2f2)",
            fontSize: "0.875rem",
          }}
        >
          {this.props.fallbackText}
        </div>
      );
    }
    return this.props.children;
  }
}

export interface ElementErrorBoundaryProps {
  elementType: string;
  elementName?: string;
  children: React.ReactNode;
}

// Functional wrapper so we can read `onElementError` from the StagebookContext
// via a hook and forward it to the class component (which can't use hooks).
export function ElementErrorBoundary({
  elementType,
  elementName,
  children,
}: ElementErrorBoundaryProps) {
  const { onElementError } = useStagebookContext();
  const messages = useMessages();
  const isRTL = useIsRTL();
  return (
    <ElementErrorBoundaryInner
      elementType={elementType}
      elementName={elementName}
      onElementError={onElementError}
      fallbackText={messages.elementErrorFallback}
      fallbackDir={isRTL ? "rtl" : "ltr"}
    >
      {children}
    </ElementErrorBoundaryInner>
  );
}
