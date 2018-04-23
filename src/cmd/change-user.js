"use strict";

const Utils = require("../misc/utils");
const Iconv = require("iconv-lite");
const Capabilities = require("../const/capabilities");
const NativePasswordAuth = require("./handshake/auth/native_password_auth");
const Collations = require("../const/collations");
const Handshake = require("./handshake/handshake");


/**
 * send a COM_CHANGE_USER: resets the connection and re-authenticates with the given credentials
 * see https://mariadb.com/kb/en/library/com_change_user/
 */
class ChangeUser extends Handshake {
  constructor(connEvents, options, onResult) {
    super(connEvents, () => {}, () => {}, onResult);
    this.opts = options;
    this.onResult = onResult;
  }

  start(out, opts, info) {
    this.configAssign(opts, this.opts);
    let authToken;
    switch (info.defaultPluginName) {
      case "mysql_native_password":
      case "":
        authToken = NativePasswordAuth.encryptPassword(this.opts.password, info.seed);
        break;

      case "mysql_clear_password":
        if (!this.opts.password) {
          authToken = Buffer.alloc(0);
        } else {
          authToken = Buffer.from(this.opts.password);
        }
        break;

      default:
        authToken = Buffer.alloc(0);
        break;
    }


    out.startPacket(this);
    out.writeInt8(0x11);
    out.writeString(this.opts.user || "");
    out.writeInt8(0);

    if (info.serverCapabilities & Capabilities.SECURE_CONNECTION) {
      out.writeInt8(authToken.length);
      out.writeBuffer(authToken, 0, authToken.length);
    } else {
      out.writeBuffer(authToken, 0, authToken.length);
      out.writeInt8(0);
    }

    if (info.clientCapabilities & Capabilities.CONNECT_WITH_DB) {
      out.writeString(this.opts.database);
      out.writeInt8(0);
      info.database = this.opts.database;
    }

    out.writeInt16(this.opts.collation.index);

    if (info.clientCapabilities & Capabilities.PLUGIN_AUTH) {
      out.writeString(info.defaultPluginName);
      out.writeInt8(0);
    }

    if (info.serverCapabilities & Capabilities.CONNECT_ATTRS) {
      let connectAttributes = this.opts.connectAttributes || {};
      let attrNames = Object.keys(connectAttributes);
      out.writeInt8(0xfc);
      let initPos = out.pos; //save position, assuming connection attributes length will be less than 2 bytes length
      out.writeInt16(0);

      const encoding = this.opts.collation.encoding;

      writeParam(out, "_client_name", encoding);
      writeParam(out, "MariaDB connector/Node", encoding);

      let packageJson = require("../../package.json");
      writeParam(out, "_client_version", encoding);
      writeParam(out, packageJson.version, encoding);

      writeParam(out, "_node_version", encoding);
      writeParam(out, process.versions.node, encoding);

      for (let k = 0; k < attrNames.length; ++k) {
        writeParam(out, attrNames[k], encoding);
        writeParam(out, connectAttributes[attrNames[k]], encoding);
      }
      //write end size
      out.buf[initPos] = out.pos - initPos - 2;
      out.buf[initPos + 1] = (out.pos - initPos - 2) >> 8;
    }

    out.flushBuffer(true);
    this.emit("send_end");

    return this.handshakeResult;
  }


  /**
   * Assign global configuration option used by result-set to current query option.
   * a little faster than Object.assign() since doest copy all information
   *
   * @param connOpts  connection global configuration
   * @param opt       current options
   */
  configAssign(connOpts, opt) {
    if (!opt) {
      this.opts = connOpts;
      return;
    }

    this.opts.password = opt.password ? opt.password : connOpts.password;
    this.opts.user = opt.user ? opt.user : connOpts.user;
    this.opts.database = opt.database ? opt.database : connOpts.database;
    this.opts.connectAttributes = opt.connectAttributes ? opt.connectAttributes : connOpts.connectAttributes;

    if (this.opts.charset && typeof this.opts.charset === "string") {
      this.opts.collation = Collations.fromName(this.opts.charset.toUpperCase());
      if (this.opts.collation === undefined)
        throw new RangeError("Unknown charset '" + this.opts.charset + "'");
      const initialCallback = this.onResult;
      this.onResult = (err) => {
        if (!err) connOpts.collation = this.opts.collation;
        initialCallback(err);
      }

    } else {
      this.opts.collation = Collations.fromIndex(this.opts.charsetNumber) || connOpts.collation;
    }
  }

  /**
   * Read ping response packet.
   * packet can be :
   * - an ERR_Packet
   * - a OK_Packet
   *
   * @param packet  query response
   * @param out     output writer
   * @param opts    connection options
   * @param info    connection info
   * @returns {null}
   */
  readChangeUserResponsePacket(packet, out, opts, info) {
    switch (packet.peek()) {
      //*********************************************************************************************************
      //* OK response
      //*********************************************************************************************************
      case 0x00:
        packet.skip(1); //skip header
        info.status = packet.readUInt16();
        if (this.onResult) process.nextTick(this.onResult, null);
        this.emit("end");
        return null;

      //*********************************************************************************************************
      //* ERROR response
      //*********************************************************************************************************
      case 0xff:
        const err = packet.readError(info);
        this.throwError(err);
        return null;

      default:
        const errUnexpected = Utils.createError("unexpected packet", false, info);
        this.throwError(errUnexpected);
        return null;
    }
  }
}


function writeParam(out, val, encoding) {
  let param = Buffer.isEncoding(encoding)
    ? Buffer.from(val, encoding)
    : Iconv.encode(val, encoding);
  out.writeLengthCoded(param.length);
  out.writeBuffer(param, 0, param.length);
}

module.exports = ChangeUser;
