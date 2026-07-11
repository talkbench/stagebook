// The webview esbuild bundle loads `.css` as text (`--loader:.css=text` in the
// build:webview script), so importing the stagebook stylesheet yields its CSS
// source as a string. Declare the module so tsc/eslint type it as a string
// default export. Used by webview/index.tsx to inject the library's real
// styles into the preview (#560).
declare module "stagebook/styles" {
  const css: string;
  export default css;
}
