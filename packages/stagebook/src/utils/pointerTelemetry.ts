/** Passive observations attached to existing response saves; never a bot score. */
export type PointerControlType =
  | "text"
  | "numeric"
  | "button"
  | "radio"
  | "checkbox";
export type PointerSource = "pointer" | "keyboard" | "unknown";
export type TelemetryPointerType = "mouse" | "touch" | "pen" | "unknown";

export interface PointerPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportClipped: boolean;
  inViewCenterX: number | null;
  inViewCenterY: number | null;
}

export interface PointerFieldState {
  wasFocused: boolean;
  wasEmpty: boolean;
  /** Observed field focus events before this interaction. */
  priorFocusCount: number;
}

export interface PointerClickSample {
  timestamp: number;
  source: PointerSource;
  pointerType: TelemetryPointerType | null;
  targetPart: "control" | "label-text" | "padding" | "label";
  /** Choice position at the event, without capturing its label or value. */
  optionIndex: number | null;
  /** Stable button/field/label-row box, never an incidental child. */
  position: PointerPosition | null;
  /** Associated field or choice glyph when the target is a label/container. */
  controlPosition: PointerPosition | null;
  fieldState: PointerFieldState | null;
  coordinateEvent: "click" | "pointerdown" | null;
  isTrusted: boolean;
}

export interface PointerFocusSample extends PointerClickSample {
  /** First observed focus versus a later observed focus in this mount. */
  visit: "first" | "return";
}

export interface PointerStats {
  version: 1;
  controlType: PointerControlType;
  clickCount: number;
  clickCountsBySource: Record<PointerSource, number>;
  clickCountsByPointerType: Record<TelemetryPointerType, number>;
  /** First 20 activations, in event order. Counts continue after the cap. */
  clickSamples: PointerClickSample[];
  focusCount: number;
  focusCountsBySource: Record<PointerSource, number>;
  /** First 20 observed text/numeric field focuses. */
  focusSamples: PointerFocusSample[];
}
