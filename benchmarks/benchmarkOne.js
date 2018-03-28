"use strict";

const fs = require("fs");
const Bench = require("./common_benchmarks");
let bench;

const run = function() {
  bench.suite.run();
};

bench = new Bench(run);

const launchBenchs = function(path) {
  const test = "bench_select_one_user.js";
  const m = require(path + "/" + test);
  bench.initFcts.push(m.initFct);
  bench.add(m.title, m.displaySql, m.benchFct, m.onComplete); //, bench.CONN.MYSQL);
};

fs.access("./benchs", function(err) {
  if (err) {
    fs.access("./benchmarks/benchs", function(err) {
      launchBenchs("./benchmarks/benchs");
    });
  } else {
    launchBenchs("./benchs");
  }
});
