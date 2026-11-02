/* global require, process */
/* eslint-disable @typescript-eslint/no-require-imports */
// Preloaded into the local agent during the acceptance walkthrough
// (NODE_OPTIONS=--require). Any TCP connection or DNS lookup that leaves the
// loopback interface is refused and appended to CODIFIER_OFFLINE_GUARD_LOG, so
// a run with an empty log shows the workflow needs no network beyond loopback.
const dns = require("node:dns");
const fs = require("node:fs");
const net = require("node:net");

const logPath = process.env.CODIFIER_OFFLINE_GUARD_LOG;

function isLoopback(host) {
  if (host === undefined || host === null || host === "") return true;
  const value = String(host)
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  return (
    value === "localhost" ||
    value === "::1" ||
    value === "0:0:0:0:0:0:0:1" ||
    /^127\./.test(value) ||
    /^::ffff:127\./.test(value)
  );
}

function refuse(kind, host) {
  const line = `${new Date().toISOString()} blocked ${kind} to ${host}\n`;
  if (logPath) fs.appendFileSync(logPath, line);
  const error = new Error(`Offline guard refused ${kind} to ${host}`);
  error.code = "ECONNREFUSED";
  return error;
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  const [first, second] = args;
  let host;
  if (Array.isArray(first)) {
    host = first[0]?.host;
  } else if (first && typeof first === "object") {
    if (first.path) return originalConnect.apply(this, args); // local IPC
    host = first.host;
  } else if (typeof first === "number" || /^\d+$/.test(String(first))) {
    host = typeof second === "string" ? second : undefined;
  } else {
    return originalConnect.apply(this, args); // named pipe or socket path
  }
  if (!isLoopback(host)) {
    const error = refuse("connection", host);
    process.nextTick(() => this.destroy(error));
    return this;
  }
  return originalConnect.apply(this, args);
};

for (const name of ["lookup", "resolve", "resolve4", "resolve6"]) {
  const original = dns[name];
  dns[name] = function guarded(hostname, ...rest) {
    if (!isLoopback(hostname)) {
      const callback = rest.find((item) => typeof item === "function");
      const error = refuse(`DNS ${name}`, hostname);
      if (callback) process.nextTick(() => callback(error));
      return undefined;
    }
    return original.call(this, hostname, ...rest);
  };
}
