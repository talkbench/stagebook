import React from "react";
import {
  StagebookProvider,
  type SharedNumericResponseConfig,
} from "../../components/StagebookProvider.js";
import { resolveCatalog } from "../../messages/index.js";
import { getNumericFeedback } from "../../utils/numericFeedback.js";
import { filterNumericInsertion } from "../../utils/numericResponse.js";
import { createViewerContext } from "../lib/context.js";
import { ViewerStateStore } from "../lib/store.js";
import { createSkeletonRenderers } from "./SkeletonPlaceholder.js";

export function NumericSkeletonFixture({
  locale = "en",
  prefix,
  suffix,
}: {
  locale?: string;
  prefix?: string;
  suffix?: string;
}) {
  const catalog = resolveCatalog(locale);
  const constraints = { min: -10, max: 10 };
  const config: SharedNumericResponseConfig = {
    name: "temperature",
    constraints,
    prefix,
    suffix,
    required: true,
    numberFormat: catalog.numberFormat,
    inputmode: undefined,
    ariaLabelledBy: "preview-question",
    getFeedback: (entry, reveal) =>
      getNumericFeedback(
        entry,
        constraints,
        catalog.numberFormat,
        reveal,
        catalog,
      ),
    filterInsertion: (change) =>
      filterNumericInsertion(change, catalog.numberFormat),
    onLocalEdit() {},
    onRemoteChange() {},
    onBlur() {},
  };
  const context = createViewerContext({
    store: new ViewerStateStore(),
    position: 0,
    stageIndex: 0,
    playerCount: 2,
    locale,
    onSubmit() {},
    getTextContent: () => Promise.resolve(""),
    getAssetURL: (path) => path,
    renderers: createSkeletonRenderers(),
  });
  return (
    <StagebookProvider value={context}>
      <div style={{ width: "100%" }}>
        <p id="preview-question">Temperature</p>
        {context.renderSharedNumericResponse!(config)}
      </div>
    </StagebookProvider>
  );
}
