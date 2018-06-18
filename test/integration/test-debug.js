"use strict";

const base = require("../base.js");
const Conf = require("../conf");
const { assert } = require("chai");
const fs = require("fs");
const os = require("os");
const path = require("path");

describe("debug", () => {
  let initialStdOut;
  let initialStdErr;
  let access;
  const fileName = path.join(os.tmpdir(), "tmp.txt");

  before(function() {
    initialStdOut = process.stdout.write;
    initialStdErr = process.stderr.write;
    access = fs.createWriteStream(fileName);
  });

  after(function() {
    process.stdout.write = initialStdOut;
    process.stderr.write = initialStdErr;
    access.end();
    fs.unlink(fileName, err => {});
  });

  it("change debug value", function(done) {
    process.stdout.write = process.stderr.write = access.write.bind(access);

    base
      .createConnection()
      .then(conn => {
        conn
          .query("SELECT 1")
          .then(() => {
            conn.debug(true);
            return conn.query("SELECT 2");
          })
          .then(() => {
            conn.debug(false);
            return conn.query("SELECT 3");
          })
          .then(() => {
            //wait 100ms to ensure stream has been written
            setTimeout(() => {
              const data = fs.readFileSync(fileName, { encoding: "utf8", flag: "r" });
              process.stdout.write = initialStdOut;
              process.stderr.write = initialStdErr;
              const serverVersion = conn.serverVersion();
              conn.end();
              const rangeWithEOF = Conf.baseConfig.compress ? [470, 500] : [680, 710];
              const rangeWithoutEOF = Conf.baseConfig.compress ? [470, 500] : [572, 590];
              if (
                (conn.isMariaDB() && conn.hasMinVersion(10, 2, 2)) ||
                (!conn.isMariaDB() && conn.hasMinVersion(5, 7, 5))
              ) {
                assert.isTrue(
                  data.length > rangeWithoutEOF[0] && data.length < rangeWithoutEOF[1],
                  "wrong data length : " +
                    data.length +
                    " expected value between " +
                    rangeWithoutEOF[0] +
                    " and " +
                    rangeWithoutEOF[1] +
                    "." +
                    "\n server version : " +
                    serverVersion +
                    "\n data :\n" +
                    data
                );
              } else {
                //EOF Packet make exchange bigger
                assert.isTrue(
                  data.length > rangeWithEOF[0] && data.length < rangeWithEOF[1],
                  "wrong data length : " +
                    data.length +
                    " expected value between " +
                    rangeWithEOF[0] +
                    " and " +
                    rangeWithEOF[1] +
                    "." +
                    "\n server version : " +
                    serverVersion +
                    "\n data :\n" +
                    data
                );
              }
              done();
            }, 100);
          })
          .catch(done);
      })
      .catch(done);
  });
});
