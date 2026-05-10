// stagebook/components
// React components for rendering Stagebook elements

// Context provider and hooks
export {
  StagebookProvider,
  useStagebookContext,
  useResolve,
  useSave,
  useElapsedTime,
  useTextContent,
  type StagebookContext,
  type TextContentResult,
} from "./StagebookProvider.js";

// Stage and element rendering (requires StagebookProvider)
export { Stage, type StageConfig, type StageProps } from "./Stage.js";
export { Element, type ElementConfig, type ElementProps } from "./Element.js";
export {
  ElementErrorBoundary,
  type ElementErrorBoundaryProps,
  type ElementErrorInfo,
} from "./ElementErrorBoundary.js";

// Standalone form components — no StagebookProvider required
export {
  Button,
  type ButtonProps,
  Separator,
  type SeparatorProps,
  RadioGroup,
  type RadioGroupProps,
  type RadioOption,
  CheckboxGroup,
  type CheckboxGroupProps,
  type CheckboxOption,
  Select,
  type SelectProps,
  type SelectOption,
  TextArea,
  type TextAreaProps,
  type DebugMessage,
  type TypingStats,
  type PasteAttempt,
  Slider,
  type SliderProps,
  ListSorter,
  type ListSorterProps,
  Markdown,
  type MarkdownProps,
  Loading,
  type LoadingProps,
} from "./form/index.js";

// Pure element components — usable with manual prop wiring
export {
  Display,
  type DisplayProps,
  SubmitButton,
  type SubmitButtonProps,
  AudioElement,
  type AudioElementProps,
  ImageElement,
  type ImageElementProps,
  KitchenTimer,
  type KitchenTimerProps,
  TrackedLink,
  type TrackedLinkProps,
  type ResolvedParam,
  MediaPlayer,
  type MediaPlayerProps,
  type VideoEvent,
  Prompt,
  type PromptProps,
  Qualtrics,
  type QualtricsProps,
  Timeline,
  type TimelineProps,
} from "./elements/index.js";

// Conditional rendering components
export {
  TimeConditionalRender,
  type TimeConditionalRenderProps,
  PositionConditionalRender,
  type PositionConditionalRenderProps,
  ConditionsConditionalRender,
  type ConditionsConditionalRenderProps,
  type Condition,
  type ConditionNode,
  SubmissionConditionalRender,
  type SubmissionConditionalRenderProps,
} from "./conditions/index.js";

// Scroll awareness (used internally by Stage, also available standalone)
export {
  ScrollIndicator,
  type ScrollIndicatorProps,
} from "./scroll/ScrollIndicator.js";
export { useScrollAwareness } from "./scroll/useScrollAwareness.js";

// Playback coordination — lets sibling components control a named MediaPlayer
export type { PlaybackHandle } from "./playback/PlaybackHandle.js";
export {
  PlaybackProvider,
  useRegisterPlayback,
  usePlayback,
} from "./playback/PlaybackProvider.js";
