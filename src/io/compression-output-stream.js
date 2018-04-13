"use strict";

const Utils = require("../misc/utils");
const ZLib = require("zlib");

//increase by level to avoid buffer copy.
const SMALL_BUFFER_SIZE = 2048;
const MEDIUM_BUFFER_SIZE = 131072; //128k
const LARGE_BUFFER_SIZE = 1048576; //1M
const MAX_BUFFER_SIZE = 16777222; //16M + 7

/**
/**
 * MySQL compression filter.
 *
 * @param socket    current socket
 * @constructor
 */
function CompressionOutputStream(socket, info, opts) {
  this.info = info;
  this.opts = opts;
  this.pos = 7;
  this.header = Buffer.allocUnsafe(7);
  this.smallBuffer = Buffer.allocUnsafe(SMALL_BUFFER_SIZE);
  this.buf = this.smallBuffer;
  this.writer = buffer => socket.write(buffer);
  this.gzip = ZLib.createGzip();
}

CompressionOutputStream.prototype.growBuffer = function(len) {
  let newCapacity;
  if (len + this.pos < MEDIUM_BUFFER_SIZE) {
    newCapacity = MEDIUM_BUFFER_SIZE;
  } else if (len + this.pos < LARGE_BUFFER_SIZE) {
    newCapacity = LARGE_BUFFER_SIZE;
  } else newCapacity = MAX_BUFFER_SIZE;

  let newBuf = Buffer.allocUnsafe(newCapacity);
  this.buf.copy(newBuf, 0, 0, this.pos);
  this.buf = newBuf;
};

CompressionOutputStream.prototype.writeBuf = function(arr, cmd) {
  let off = 0,
    len = arr.length;
  if (len > this.buf.length - this.pos) {
    if (this.buf.length !== MAX_BUFFER_SIZE) {
      this.growBuffer(len);
    }

    //max buffer size
    if (len > this.buf.length - this.pos) {
      //not enough space in buffer, will stream :
      // fill buffer and flush until all data are snd
      let remainingLen = len;

      while (true) {
        //filling buffer
        let lenToFillBuffer = Math.min(MAX_BUFFER_SIZE - this.pos, remainingLen);
        arr.copy(this.buf, this.pos, off, off + lenToFillBuffer);
        remainingLen -= lenToFillBuffer;
        off += lenToFillBuffer;
        this.pos += lenToFillBuffer;

        if (remainingLen === 0) return;
        this.flush(false, cmd);
      }
    }
  }
  arr.copy(this.buf, this.pos, off, off + len);
  this.pos += len;
};

/**
 * Flush the internal buffer.
 */
CompressionOutputStream.prototype.flush = function(cmdEnd, cmd) {
  if (this.pos < 1536) {
    //*******************************************************************************
    // small packet, no compression
    //*******************************************************************************

    this.buf[0] = this.pos - 7;
    this.buf[1] = (this.pos - 7) >>> 8;
    this.buf[2] = (this.pos - 7) >>> 16;
    this.buf[3] = cmd.compressSequenceNo;
    this.buf[4] = 0;
    this.buf[5] = 0;
    this.buf[6] = 0;
    cmd.incrementCompressSequenceNo(1);

    if (this.opts.debugCompress) {
      console.log(
        "==> conn:%d %s (compress)\n%s",
        this.info.threadId ? this.info.threadId : -1,
        cmd
          ? (cmd.onPacketReceive
              ? cmd.constructor.name + "." + cmd.onPacketReceive.name
              : cmd.constructor.name) +
            "(0," +
            this.pos +
            ")"
          : "unknown",
        Utils.log(this.buf, 0, this.pos)
      );
    }

    try {
      this.writer(this.buf.slice(0, this.pos));

      if (this.pos === MAX_BUFFER_SIZE) this.writeEmptyPacket();

      //reset buffer
      this.buf = this.smallBuffer;

      this.pos = 7;
    } catch (err) {
      //eat exception : thrown by socket.on('error');
    }
  } else {
    //*******************************************************************************
    // compressing packet
    //*******************************************************************************
    //use synchronous inflating, to ensure FIFO packet order
    const compressChunk = ZLib.deflateSync(this.buf.slice(7, this.pos));
    const compressChunkLen = compressChunk.length;

    this.header[0] = compressChunkLen;
    this.header[1] = compressChunkLen >>> 8;
    this.header[2] = compressChunkLen >>> 16;
    this.header[3] = cmd.compressSequenceNo;
    this.header[4] = this.pos - 7;
    this.header[5] = (this.pos - 7) >>> 8;
    this.header[6] = (this.pos - 7) >>> 16;
    cmd.incrementCompressSequenceNo(1);

    if (this.opts.debugCompress) {
      console.log(
        "==> conn:%d %s (compress)\n%s",
        this.info.threadId ? this.info.threadId : -1,
        cmd
          ? (cmd.onPacketReceive
              ? cmd.constructor.name + "." + cmd.onPacketReceive.name
              : cmd.constructor.name) +
            "(0," +
            this.pos +
            ")"
          : "unknown",
        Utils.log(this.header, 0, 7) + Utils.log(compressChunk, 0, compressChunkLen)
      );
    }

    try {
      this.writer(this.header);
      this.writer(compressChunk);
      if (cmdEnd) {
        if (this.pos === MAX_BUFFER_SIZE) this.writeEmptyPacket();

        //reset buffer
        this.buf = this.smallBuffer;
      }
      this.pos = 7;
    } catch (err) {
      //eat exception : thrown by socket.on('error');
    }
  }
};

module.exports = CompressionOutputStream;
