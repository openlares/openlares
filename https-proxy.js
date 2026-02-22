const https = require("https");
const fs = require("fs");
const httpProxy = require("http-proxy");

const proxy = httpProxy.createProxyServer({
  target: "http://localhost:3000",
  ws: true,
});

const server = https.createServer(
  {
    key: fs.readFileSync("/home/worker/openlares/packages/app/certificates/localhost-key.pem"),
    cert: fs.readFileSync("/home/worker/openlares/packages/app/certificates/localhost.pem"),
  },
  (req, res) => proxy.web(req, res)
);

server.on("upgrade", (req, socket, head) => proxy.ws(req, socket, head));
server.listen(3443, "0.0.0.0", () => console.log("HTTPS proxy on :3443 → :3000"));
