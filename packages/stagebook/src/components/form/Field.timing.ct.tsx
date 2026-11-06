import { test, expect } from "@playwright/experimental-ct-react";
import { FieldTimingHarness } from "../testing/FieldTimingHarness.js";
import type { PromptRecord } from "../../utils/buildPromptRecord.js";

for (const kind of ["openResponse", "numericResponse"] as const) {
  test(`${kind} records first focus after conditional mounting on existing saves`, async ({
    mount,
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-11-06T12:00:00Z") });
    await page.clock.pauseAt(new Date("2026-11-06T12:00:01Z"));
    const clockReads: number[] = [];
    const onClockRead = (time: number) => clockReads.push(time);
    const component = await mount(
      <FieldTimingHarness
        kind={kind}
        shown={false}
        stageTime={12.75}
        onClockRead={onClockRead}
      />,
    );
    const field = component.getByRole("textbox");
    const records = async () =>
      JSON.parse(
        (await component.getByTestId("saved-records").textContent())!,
      ) as PromptRecord[];
    expect(await records()).toEqual([]);
    expect(clockReads).toEqual([]);

    // Time before the conditional field mounts must not inflate its delay.
    await page.clock.runFor(5000);
    await component.update(
      <FieldTimingHarness
        kind={kind}
        shown
        stageTime={12.75}
        onClockRead={onClockRead}
      />,
    );
    await expect(field).toBeVisible();
    await page.clock.runFor(1250);
    await component.getByRole("button", { name: "Before field" }).focus();
    await page.keyboard.press("Tab");
    await expect(field).toBeFocused();
    await expect.poll(() => clockReads).toEqual([12.75]);
    expect(await records()).toEqual([]);

    // A later commit clock must not replace the first-focus clock.
    await component.update(
      <FieldTimingHarness
        kind={kind}
        shown
        stageTime={20}
        onClockRead={onClockRead}
      />,
    );
    await field.fill(kind === "openResponse" ? "An answer" : "12");
    await page.clock.runFor(2000);
    await expect.poll(async () => (await records()).length).toBe(1);
    const firstFocus = {
      version: 1,
      firstFocusDelayMs: 1250,
      firstFocusStageTimeElapsed: 12.75,
    };
    expect((await records())[0]).toMatchObject({
      fieldTiming: firstFocus,
      stageTimeElapsed: 20,
    });
    await field.blur();
    await expect.poll(async () => (await records()).length).toBe(2);
    expect((await records())[1].fieldTiming).toEqual(firstFocus);
    await expect.poll(() => clockReads).toEqual([12.75, 20, 20]);

    await page.clock.runFor(4000);
    await component.update(
      <FieldTimingHarness
        kind={kind}
        shown
        stageTime={31}
        onClockRead={onClockRead}
      />,
    );
    await field.focus();
    expect(await records()).toHaveLength(2);
    expect(clockReads).toEqual([12.75, 20, 20]);
    await field.blur();
    await expect.poll(async () => (await records()).length).toBe(3);
    expect((await records())[2]).toMatchObject({
      fieldTiming: firstFocus,
      stageTimeElapsed: 31,
    });

    // A later remount starts a new field lifetime without writing on mount.
    await component.update(
      <FieldTimingHarness
        kind={kind}
        shown={false}
        stageTime={40}
        onClockRead={onClockRead}
      />,
    );
    await page.clock.runFor(3000);
    await component.update(
      <FieldTimingHarness
        kind={kind}
        shown
        stageTime={45}
        onClockRead={onClockRead}
      />,
    );
    await expect(field).toBeVisible();
    expect(await records()).toHaveLength(3);
    await page.clock.runFor(600);
    await field.focus();
    expect(await records()).toHaveLength(3);
    await field.fill(kind === "openResponse" ? "Another answer" : "34");
    await field.blur();
    await expect.poll(async () => (await records()).length).toBe(4);
    expect((await records())[3].fieldTiming).toEqual({
      version: 1,
      firstFocusDelayMs: 600,
      firstFocusStageTimeElapsed: 45,
    });
    await expect.poll(() => clockReads).toEqual([12.75, 20, 20, 31, 45, 45]);
  });
}
