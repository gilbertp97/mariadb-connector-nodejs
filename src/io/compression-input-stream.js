"use strict";

const ZLib = require("zlib");
const Utils = require("../misc/utils");

/**
 * MySQL packet parser
 * see : https://mariadb.com/kb/en/library/0-packet/
 */
class CompressionInputStream {
  constructor(reader, receiveQueue, opts, info) {
    this.reader = reader;
    this.receiveQueue = receiveQueue;
    this.info = info;
    this.opts = opts;
    this.header = Buffer.allocUnsafe(7);
    this.headerLen = 0;
    this.compressPacketLen = null;
    this.packetLen = null;
    this.remainingLen = null;

    this.parts = null;
    this.partsTotalLen = 0;
  }

  receivePacket(chunk) {
    let cmd = this.currentCmd();
    if (this.opts.debugCompress) {
      console.log(
        "<== conn:%d %s (compress)\n%s",
        this.info.threadId ? this.info.threadId : -1,
        cmd
          ? cmd.onPacketReceive
            ? cmd.constructor.name + "." + cmd.onPacketReceive.name
            : cmd.constructor.name
          : "no command",
        Utils.log(chunk, 0, chunk.length, this.header)
      );
    }
    if (cmd) cmd.checkCompressSequenceNo(this.header[3]);

    const unCompressLen = this.header[4] | (this.header[5] << 8) | (this.header[6] << 16);
    if (unCompressLen === 0) {
      this.reader.onData(chunk);
    } else {
      //use synchronous inflating, to ensure FIFO packet order
      const unCompressChunk = ZLib.inflateSync(chunk);
      this.reader.onData(unCompressChunk);
    }
  }

  checkSequenceNo() {
    let cmd = this.currentCmd();
    if (cmd) cmd.checkCompressSequenceNo(this.header[3]);
  }

  currentCmd() {
    let cmd;
    while ((cmd = this.receiveQueue.peek())) {
      if (cmd.onPacketReceive) return cmd;
      this.receiveQueue.shift();
    }
    return null;
  }

  resetHeader() {
    this.remainingLen = null;
    this.headerLen = 0;
  }

  /**
   * Read 4 bytes header.
   *
   * @param chunk     chunk
   * @param chunkLen  chunk length
   * @returns packet length if header is completely received
   * @private
   */
  readHeader(chunk, chunkLen) {
    if (this.remainingLen) return this.remainingLen;
    while (chunkLen - this.pos > 0) {
      this.header[this.headerLen++] = chunk[this.pos++];
      if (this.headerLen === 7) {
        this.compressPacketLen = this.header[0] | (this.header[1] << 8) | (this.header[2] << 16);
        this.packetLen = this.header[4] | (this.header[5] << 8) | (this.header[6] << 16);
        if (this.packetLen === 0) this.packetLen = this.compressPacketLen;
        return this.compressPacketLen;
      }
    }
    return null;
  }

  onData(chunk) {
    this.pos = 0;
    let length;
    const chunkLen = chunk.length;

    do {
      if ((length = this.readHeader(chunk, chunkLen))) {
        if (chunkLen - this.pos >= length) {
          const buf = chunk.slice(this.pos, this.pos + length);
          this.pos += length;
          if (this.parts) {
            this.parts.push(buf);
            this.partsTotalLen += length;

            if (this.compressPacketLen < 0xffffff) {
              let buf = Buffer.concat(this.parts, this.partsTotalLen);
              this.parts = null;
              this.receivePacket(buf);
            } else {
              this.checkSequenceNo();
            }
          } else {
            if (this.compressPacketLen < 0xffffff) {
              this.receivePacket(buf);
            } else {
              this.parts = [buf];
              this.partsTotalLen = length;
              this.checkSequenceNo();
            }
          }
          this.resetHeader();
        } else {
          const buf = chunk.slice(this.pos, chunkLen);
          if (!this.parts) {
            this.parts = [buf];
            this.partsTotalLen = chunkLen - this.pos;
          } else {
            this.parts.push(buf);
            this.partsTotalLen += chunkLen - this.pos;
          }
          this.remainingLen = length - (chunkLen - this.pos);
          return;
        }
      }
    } while (this.pos < chunkLen);
  }
}

module.exports = CompressionInputStream;
