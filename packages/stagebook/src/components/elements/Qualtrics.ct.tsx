import { test, expect } from "@playwright/experimental-ct-react";
import { Qualtrics } from "./Qualtrics";
import { MockQualtrics } from "../testing/MockQualtrics";

test.describe("Qualtrics", () => {
  test.describe("URL building", () => {
    test("renders iframe with survey URL", async ({ mount }) => {
      const component = await mount(
        <Qualtrics
          url="https://upenn.qualtrics.com/jfe/form/SV_test123"
          save={() => {}}
          onComplete={() => {}}
        />,
      );
      const iframe = component.locator("iframe");
      await expect(iframe).toBeVisible();
      const src = await iframe.getAttribute("src");
      expect(src).toContain("https://upenn.qualtrics.com/jfe/form/SV_test123");
    });

    test("appends resolved URL params", async ({ mount }) => {
      const component = await mount(
        <Qualtrics
          url="https://upenn.qualtrics.com/jfe/form/SV_test123"
          resolvedParams={[
            { key: "condition", value: "topicA" },
            { key: "prolificId", value: "P123" },
          ]}
          save={() => {}}
          onComplete={() => {}}
        />,
      );
      const src = await component.locator("iframe").getAttribute("src");
      expect(src).toContain("condition=topicA");
      expect(src).toContain("prolificId=P123");
    });

    test("appends stableParticipantId as a URL param (#473)", async ({
      mount,
    }) => {
      const component = await mount(
        <Qualtrics
          url="https://upenn.qualtrics.com/jfe/form/SV_test123"
          stableParticipantId="stable-abc"
          save={() => {}}
          onComplete={() => {}}
        />,
      );
      const src = await component.locator("iframe").getAttribute("src");
      expect(src).toContain("stableParticipantId=stable-abc");
    });

    test("appends sampleId (#473)", async ({ mount }) => {
      const component = await mount(
        <Qualtrics
          url="https://upenn.qualtrics.com/jfe/form/SV_test123"
          sampleId="row-xyz"
          save={() => {}}
          onComplete={() => {}}
        />,
      );
      const src = await component.locator("iframe").getAttribute("src");
      expect(src).toContain("sampleId=row-xyz");
    });
  });

  test.describe("Origin validation", () => {
    test("rejects postMessage from non-Qualtrics origin", async ({
      mount,
      page,
    }) => {
      const component = await mount(
        <MockQualtrics url="https://upenn.qualtrics.com/jfe/form/SV_test123" />,
      );

      // Verify not completed
      await expect(
        component.locator('[data-testid="qualtrics-completed"]'),
      ).toHaveText("false");

      // Send postMessage from localhost (not qualtrics.com) — should be rejected
      await page.evaluate(() => {
        window.postMessage("QualtricsEOS|SV_test123|sess_abc456", "*");
      });

      // Wait a moment for any potential (incorrect) state update
      await page.waitForTimeout(200);

      // Should still NOT be completed — origin validation rejected the message
      await expect(
        component.locator('[data-testid="qualtrics-completed"]'),
      ).toHaveText("false");

      // No data should have been saved
      await expect(
        component.locator('[data-testid="qualtrics-saved-key"]'),
      ).toHaveText("");
    });
  });
});
