"use strict";

/**
 * Send SSL Request packet.
 * see : https://mariadb.com/kb/en/library/1-connecting-connecting/#sslrequest-packet
 *
 * @param cmd                 current command
 * @param out                 output writer
 * @param clientCapabilities  clientCapabilities
 * @param collation           collation number
 */
module.exports.send = function sendSSLRequest(cmd, out, clientCapabilities, collation) {
  out.startPacket(cmd);
  out.writeInt32(clientCapabilities);
  out.writeInt32(1024 * 1024 * 1024); // max packet size
  out.writeInt8(collation);
  for (let i = 0; i < 23; i++) {
    out.writeInt8(0);
  }
  out.flushBuffer(true);
};
