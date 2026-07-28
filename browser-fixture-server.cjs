"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(process.argv[2]);
const port = Number(process.argv[3]);
const fixtureMode = process.argv[4] || "";
const [fixtureAction = "", fixtureResource = ""] = fixtureMode.split(":");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
  const filePath = path.resolve(root, relativePath);

  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'",
  );

  if (relativePath === fixtureResource && fixtureAction === "fail") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Synthetic fixture failure.");
    return;
  }
  if (relativePath === fixtureResource && ["throw", "reject"].includes(fixtureAction)) {
    const statement = fixtureAction === "throw"
      ? `throw new Error(${JSON.stringify(`Synthetic runtime failure in ${fixtureResource}.`)});`
      : `Promise.reject(new Error(${JSON.stringify(`Synthetic rejection in ${fixtureResource}.`)}));`;
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(statement);
    return;
  }
  if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found.");
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`READY ${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
