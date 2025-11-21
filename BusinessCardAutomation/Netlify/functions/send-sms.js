const fs = require("fs");
const path = require("path");
const https = require("https");
const { URL } = require("url");

const REQUIRED = ["login", "password", "serviceId", "text", "dest"];
const ENDPOINT = "https://api2.multiinfo.plus.pl/Api61/sendsmslong.aspx";
const CERT_PATH = path.join(__dirname, "certs", "l.kmiecik.adm.pem");

const buildRes = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
  },
  body: JSON.stringify(body),
});

let cachedAgent, cachedErr;
const getAgent = () => {
  if (cachedAgent || cachedErr) return { agent: cachedAgent, error: cachedErr };
  try {
    const pem = fs.readFileSync(CERT_PATH); // plik zawiera KEY + CERT
    cachedAgent = new https.Agent({
      cert: pem,
      key: pem,
      // jeśli MultiInfo wymusza TLS1.2:
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
      // requestCert nie jest potrzebne, ale nie szkodzi:
      requestCert: true,
    });
    return { agent: cachedAgent };
  } catch (e) {
    cachedErr = e;
    return { error: e };
  }
};

const httpsGet = (url, agent) =>
  new Promise((resolve, reject) => {
    const req = https.get(url, { agent }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () =>
        resolve({ status: res.statusCode || 0, body: data })
      );
    });
    req.on("error", reject);
    req.end();
  });

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return buildRes(204, {});
  if (event.httpMethod !== "GET")
    return buildRes(405, { error: "Method Not Allowed. Use GET." });

  const q = event.queryStringParameters || {};
  const miss = REQUIRED.filter((p) => !q[p]);
  if (miss.length) return buildRes(422, { error: "Missing params", miss });

  const { agent, error } = getAgent();
  if (error) return buildRes(500, { error: "TLS cert not available", details: error.message });

  const url = new URL(ENDPOINT);
  for (const k of REQUIRED) url.searchParams.set(k, q[k]);

  try {
    const resp = await httpsGet(url.toString(), agent);
    if (resp.status < 200 || resp.status >= 300) {
      return buildRes(resp.status || 502, {
        error: "Upstream error",
        upstreamStatus: resp.status,
        upstreamBody: resp.body,
      });
    }
    return buildRes(200, {
      message: "SMS request forwarded to MultiInfo Plus.",
      upstreamBody: resp.body,
    });
  } catch (e) {
    return buildRes(502, { error: "Error calling MultiInfo", details: e.message });
  }
};
