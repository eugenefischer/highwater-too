/** Stylesheets imported as text (esbuild's text loader; see scripts/build.mjs). */
declare module "*.css" {
  const text: string;
  export default text;
}
