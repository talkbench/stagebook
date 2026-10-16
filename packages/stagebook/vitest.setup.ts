// jsdom has no layout or Element.scrollTo implementation. Unit tests that
// render Stage/Viewer need the DOM API; actual scrolling, CSS smooth behavior,
// and animation cancellation are verified by the Playwright browser tests.
if (
  typeof Element !== "undefined" &&
  typeof Element.prototype.scrollTo !== "function"
) {
  Object.defineProperty(Element.prototype, "scrollTo", {
    configurable: true,
    writable: true,
    value(this: Element, options?: ScrollToOptions | number, y?: number) {
      if (typeof options === "number") {
        this.scrollLeft = options;
        this.scrollTop = y ?? 0;
      } else {
        if (options?.left !== undefined) this.scrollLeft = options.left;
        if (options?.top !== undefined) this.scrollTop = options.top;
      }
    },
  });
}
