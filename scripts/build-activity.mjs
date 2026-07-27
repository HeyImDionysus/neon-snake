import { build } from "esbuild";

await build({
  entryPoints: ["activity/entry.js"],
  bundle: true,
  format: "iife",
  legalComments: "eof",
  minify: true,
  outfile: "public/activity-sdk.js",
  platform: "browser",
  target: ["es2020"],
});
