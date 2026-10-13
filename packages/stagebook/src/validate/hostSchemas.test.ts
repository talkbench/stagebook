import { describe, expect, test } from "vitest";
import { z } from "zod";
import { Readable, Writable } from "node:stream";
import { run } from "../cli/validate.js";
import { createHostRecordSchemas } from "../schemas/hostRecords.js";
import { validateResolvedTreatmentFile } from "../schemas/resolved.js";
import { validateTreatmentSource } from "./validateTreatment.js";
import { validateTreatmentWithDiff } from "./validateTreatmentDiff.js";
import {
  expandAndValidate,
  expandAndValidateWithImports,
} from "./expandAndValidate.js";

const source = `stagebook: "0.35"
treatments:
  - name: study
    playerCount: 2
    compatibleIntroSequences: []
    gameStages:
      - name: talk
        duration: 60
        discussion:
          name: chat
          chatType: video
          showNickname: false
          showTitle: false
        elements:
          - type: submitButton
            conditions:
              reference: self.discussion.chat.turnCount
              comparator: isAtLeast
              value: 3
`;
const hostSchemas = createHostRecordSchemas({
  discussion: { turnCount: z.number().optional() },
});

describe("host declarations reach validation surfaces", () => {
  test("host metric declarations cannot enable shared discussion reads", async () => {
    const shared = source.replace("self.discussion", "shared.discussion");
    for (const diagnostics of [
      validateTreatmentSource(shared, { hostSchemas }).diagnostics,
      (
        await validateTreatmentWithDiff({
          source: shared,
          hostSchemas,
          loadImport: async () => "",
        })
      ).diagnostics,
    ]) {
      expect(
        diagnostics.some(
          (issue) =>
            issue.severity === "error" && /participant/i.test(issue.message),
        ),
      ).toBe(true);
    }
  });

  test("template-only field warnings never highlight a shifted concrete reference", async () => {
    const templateSource = `stagebook: "0.35"
templates:
  - name: gate
    contentType: elements
    content:
      - type: separator
      - type: display
        reference: self.mediaPlayer.clip.firstplay
treatments:
  - name: study
    playerCount: 1
    compatibleIntroSequences: []
    gameStages:
      - name: watch
        duration: 60
        elements:
          - type: mediaPlayer
            name: clip
            file: clip.mp4
      - name: inspect
        duration: 60
        elements:
          - template: gate
          - type: display
            reference: self.mediaPlayer.clip.firstPlay
`;
    const result = await validateTreatmentWithDiff({
      source: templateSource,
      loadImport: async () => "",
    });
    const warnings = result.diagnostics.filter((issue) =>
      issue.message.includes("Did you mean 'firstPlay'"),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].range).toBeNull();
    expect(
      expandAndValidate(templateSource).diagnostics.some(
        (issue) =>
          issue.message.includes("Did you mean 'firstPlay'") &&
          issue.range !== null,
      ),
    ).toBe(true);
  });
  test("defers a templated discussion name without inventing a concrete producer", async () => {
    const deferred = source
      .replace("name: chat", "name: ${room}")
      .replace(
        "self.discussion.chat.turnCount",
        "self.discussion.${room}.discussionFailed",
      )
      .replace(
        "comparator: isAtLeast\n              value: 3",
        "comparator: exists",
      );
    expect(validateTreatmentSource(deferred).diagnostics).toEqual([]);
    expect(
      (
        await validateTreatmentWithDiff({
          source: deferred,
          loadImport: async () => "",
        })
      ).diagnostics,
    ).toEqual([]);
    expect(
      validateTreatmentSource(
        deferred.replace("self.discussion.${room}", "self.discussion.chat"),
      ).diagnostics.some((issue) => issue.severity === "error"),
    ).toBe(true);
  });
  test("defers unfilled metric paths to the resolved placeholder check", async () => {
    const deferred = source.replace("turnCount", "${metric}");
    const raw = validateTreatmentSource(deferred);
    expect(raw.diagnostics).toEqual([]);
    expect(
      (
        await validateTreatmentWithDiff({
          source: deferred,
          loadImport: async () => "",
        })
      ).diagnostics,
    ).toEqual([]);
    expect(
      validateResolvedTreatmentFile(raw.parsedObj, { skipUnresolved: true })
        .success,
    ).toBe(true);
    const resolved = validateResolvedTreatmentFile(raw.parsedObj);
    expect(resolved.success).toBe(false);
    expect(
      resolved.issues.every(
        (issue) => issue.reason === "unresolved-placeholder",
      ),
    ).toBe(true);
    expect(
      validateTreatmentSource(
        deferred.replace("${metric}", "nope"),
      ).diagnostics.some((issue) => issue.severity === "error"),
    ).toBe(true);
  });
  test("source validation uses the supplied schema and remains isolated", () => {
    expect(
      validateTreatmentSource(source, { hostSchemas }).diagnostics,
    ).toEqual([]);
    expect(
      validateTreatmentSource(source).diagnostics.some(
        (issue) => issue.severity === "error",
      ),
    ).toBe(true);
    expect(
      validateTreatmentSource(source.replace("value: 3", "value: nope"), {
        hostSchemas,
      }).diagnostics.some((issue) => issue.severity === "error"),
    ).toBe(true);
  });
  test("editor and expanded validation use the same declaration", async () => {
    expect(
      (
        await validateTreatmentWithDiff({
          source,
          loadImport: async () => "",
          hostSchemas,
        })
      ).diagnostics,
    ).toEqual([]);
    expect(expandAndValidate(source, { hostSchemas }).diagnostics).toEqual([]);
    expect(
      (
        await expandAndValidateWithImports({
          source,
          loadImport: async () => "",
          options: { hostSchemas },
        })
      ).diagnostics,
    ).toEqual([]);
  });
  test.each([
    "          - type: display\n            reference: self.discussion.chat.nope",
    "          - type: trackedLink\n            name: link\n            url: https://example.com\n            urlParams:\n              - key: metric\n                reference: self.discussion.chat.nope",
  ])("unknown discussion fields are rejected outside conditions", (element) => {
    const withoutGate = source.slice(
      0,
      source.indexOf("          - type: submitButton"),
    );
    const diagnostics = validateTreatmentSource(
      `${withoutGate}${element}\n          - type: submitButton\n`,
    ).diagnostics;
    expect(
      diagnostics.some(
        (issue) =>
          issue.severity === "error" &&
          issue.message.includes("declared fields"),
      ),
    ).toBe(true);
  });
  test("MediaPlayer typos warn once in both source and editor validation", async () => {
    const mediaSource = source
      .replace(
        /        discussion:[\s\S]*?        elements:/,
        "        elements:\n          - type: mediaPlayer\n            name: clip\n            file: clip.mp4",
      )
      .replace(
        "self.discussion.chat.turnCount",
        "self.mediaPlayer.clip.firstplay",
      )
      .replace(
        "comparator: isAtLeast\n              value: 3",
        "comparator: exists",
      );
    for (const result of [
      validateTreatmentSource(mediaSource),
      await validateTreatmentWithDiff({
        source: mediaSource,
        loadImport: async () => "",
      }),
    ]) {
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          severity: "warning",
          message: expect.stringContaining("Did you mean 'firstPlay'"),
        }),
      ]);
      expect(result.diagnostics[0].range).toBeTruthy();
    }
    const chunks: string[] = [];
    const stdout = new Writable({
      write(chunk: Buffer, _encoding, done) {
        chunks.push(chunk.toString());
        done();
      },
    });
    const code = await run({
      argv: ["--format=json", "--type=treatment", "-"],
      cwd: process.cwd(),
      stdin: Readable.from(mediaSource),
      stdout,
      stderr: stdout,
    });
    expect(code).toBe(0);
    expect(chunks.join("")).toContain("Did you mean 'firstPlay'");
    expect(JSON.parse(chunks.join("")).summary.warnings).toBe(1);
  });
});
