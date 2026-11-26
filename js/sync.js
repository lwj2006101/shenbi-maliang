/* 家庭画布快照同步。房间码是临时共享口令；仅用于可信局域网。 */
(function (global) {
  'use strict';
  var SBM = global.SBM || (global.SBM = {});
  var Sync = SBM.Sync = { socket: null, room: null, connected: false, ready: false,
    version: 0, epoch: 0, editRevision: 0, awaitingVersion: null, localDirty: false, conflict: null, lastError: null };
  var pending = null, inFlight = null, remote = null, cancelConnection = null, requestCounter = 0;

  function emit(type, detail) { global.dispatchEvent(new CustomEvent('sbm:sync-' + type, { detail: detail })); }
  function state() { emit('state', { connected: Sync.connected, room: Sync.room, version: Sync.version, epoch: Sync.epoch }); }
  function validData(data) { return typeof data === 'string' && /^data:image\/(png|jpeg);base64,/.test(data) && data.length <= 240 * 1024; }
  function error(message) { Sync.lastError = message; emit('error', { message: message }); return false; }
  function artwork(snapshot, reason) {
    Sync.awaitingVersion = snapshot.version;
    emit('artwork', { data: snapshot.data, room: Sync.room, version: snapshot.version, epoch: Sync.epoch, reason: reason });
  }
  function conflict(reason, localData) {
    Sync.conflict = { reason: reason, localData: localData || (pending && pending.data) || (inFlight && inFlight.data) || null,
      remoteData: remote && remote.data, version: Sync.version, room: Sync.room, epoch: Sync.epoch };
    Sync.lastError = '房间与本机画作不同，已暂停发送；请选择保留本机或接收房间画作';
    emit('conflict', { conflict: Sync.conflict });
  }
  function flush() {
    if (!Sync.connected || !Sync.ready || Sync.conflict || Sync.awaitingVersion !== null || inFlight || !pending) return;
    var item = pending;
    var requestId = 'edit-' + Sync.epoch + '-' + (++requestCounter);
    var message = JSON.stringify({ type: 'artwork', baseVersion: Sync.version, requestId: requestId, payload: { data: item.data } });
    if (new Blob([message]).size > 240 * 1024) { pending = null; error('同步画作过大，本机画作已保留'); return; }
    pending = null;
    inFlight = { requestId: requestId, data: item.data, editRevision: item.editRevision };
    try { Sync.socket.send(message); }
    catch (err) { pending = item; inFlight = null; error('发送失败，本机画作已保留：' + err.message); }
  }

  Sync.connect = function (room, options) {
    room = String(room || '').trim();
    if (!/^[a-zA-Z0-9_-]{12,48}$/.test(room)) return Promise.reject(new Error('房间码须为 12–48 位字母、数字、短横线或下划线'));
    Sync.disconnect();
    Sync.room = room;
    Sync.localDirty = !!(options && options.preserveLocal);
    Sync.lastError = null;
    var epoch = Sync.epoch;
    var scheme = global.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return new Promise(function (resolve, reject) {
      var ws;
      try { ws = new WebSocket(scheme + '//' + global.location.host + '/ws/' + encodeURIComponent(room)); }
      catch (err) { reject(err); return; }
      Sync.socket = ws;
      var settled = false;
      function current() { return Sync.socket === ws && Sync.epoch === epoch; }
      function finish(err, result) {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (cancelConnection === cancel) cancelConnection = null;
        if (err) reject(err); else resolve(result);
      }
      function cancel() { finish(new Error('连接已取消')); }
      cancelConnection = cancel;
      var timer = setTimeout(function () {
        if (!current() || settled) return;
        finish(new Error('等待房间状态超时'));
        Sync.disconnect();
      }, 6000);
      // WebSocket 建立后仍等待 room-state，不能先广播本机默认示例。
      ws.onopen = function () {};
      ws.onerror = function () { if (current()) { Sync.lastError = 'WebSocket 连接失败'; finish(new Error(Sync.lastError)); Sync.disconnect(); } };
      ws.onclose = function () {
        if (!current()) return;
        var wasReady = Sync.ready;
        finish(new Error('房间连接已关闭'));
        Sync.disconnect();
        if (wasReady) error('房间连接已关闭，本机画作已保留；请手动重新连接');
      };
      ws.onmessage = function (event) {
        if (!current()) return;
        var msg;
        try { msg = JSON.parse(event.data); } catch (err) { return; }
        if (!msg || msg.room !== room || !Number.isInteger(msg.version) || msg.version < 0) return;
        var data = msg.payload && msg.payload.data;
        if (msg.type === 'room-state' && !Sync.ready) {
          if (msg.version > 0 && !validData(data)) { finish(new Error('房间快照无效')); Sync.disconnect(); return; }
          Sync.version = msg.version;
          remote = validData(data) ? { data: data, version: msg.version } : null;
          Sync.connected = true; Sync.ready = true;
          state();
          if (remote) {
            if (Sync.localDirty) conflict('initial-local-edits');
            else artwork(remote, 'initial');
          }
          finish(null, { room: room, epoch: epoch, version: Sync.version, hasArtwork: !!remote, conflict: !!Sync.conflict });
          return;
        }
        if (!Sync.ready) return;
        if (msg.type === 'ack') {
          if (!inFlight || msg.requestId !== inFlight.requestId) return;
          var sent = inFlight; inFlight = null;
          if (msg.version >= Sync.version) { Sync.version = msg.version; remote = { data: sent.data, version: msg.version }; }
          if (!pending && sent.editRevision === Sync.editRevision && !Sync.conflict) Sync.localDirty = false;
          emit('ack', { version: msg.version, requestId: msg.requestId });
          state();
          if (Sync.conflict) emit('conflict', { conflict: Sync.conflict });
          flush();
          return;
        }
        if (msg.type === 'conflict') {
          if (!inFlight || msg.requestId !== inFlight.requestId || (msg.version > 0 && !validData(data))) return;
          var localData = pending ? pending.data : inFlight.data;
          inFlight = null;
          if (msg.version >= Sync.version) { Sync.version = msg.version; remote = validData(data) ? { data: data, version: msg.version } : null; }
          conflict('stale-version', localData);
          state();
          return;
        }
        if (msg.type !== 'artwork' || !validData(data) || msg.version <= Sync.version) return;
        Sync.version = msg.version; remote = { data: data, version: msg.version };
        state();
        if (Sync.localDirty || inFlight || pending || Sync.conflict) conflict('concurrent-edits');
        else artwork(remote, 'update');
      };
    });
  };

  Sync.markLocalChange = function () { Sync.editRevision++; Sync.localDirty = true; };
  Sync.send = function (type, payload) {
    if (!Sync.socket || Sync.socket.readyState !== WebSocket.OPEN || !Sync.ready) return error('尚未取得房间状态，本机画作已保留');
    if (type !== 'artwork' || !payload || !validData(payload.data)) return error('不支持的同步消息或画作过大，本机画作已保留');
    pending = { data: payload.data, editRevision: Sync.editRevision };
    Sync.localDirty = true;
    if (Sync.awaitingVersion !== null && !Sync.conflict) { conflict('local-edit-before-apply', payload.data); return false; }
    if (Sync.conflict) { conflict(Sync.conflict.reason, payload.data); return false; }
    Sync.lastError = null;
    flush();
    return !Sync.lastError;
  };
  Sync.confirmArtwork = function (detail) {
    if (!detail || detail.epoch !== Sync.epoch || detail.room !== Sync.room || detail.version !== Sync.version || Sync.conflict || Sync.localDirty) return false;
    Sync.awaitingVersion = null;
    return true;
  };
  // 图片解码期间又发生本地编辑时，由应用层转入同一个显式冲突选择。
  Sync.deferArtwork = function (detail, localData, reason) {
    if (!detail || detail.epoch !== Sync.epoch || detail.room !== Sync.room || detail.version !== Sync.version) return false;
    Sync.localDirty = true;
    conflict(reason || 'local-edit-during-load', localData);
    return true;
  };
  Sync.resolveConflict = function (choice, payload) {
    if (!Sync.conflict) return false;
    if (inFlight) return error('正在确认上一份画作，请稍后再选择');
    if (choice === 'local') {
      if (!payload || !validData(payload.data)) return error('本机画作无效或过大，请先导出保存');
      pending = { data: payload.data, editRevision: Sync.editRevision };
      Sync.localDirty = true;
      Sync.awaitingVersion = null;
    } else if (choice === 'remote' && remote) {
      pending = null; Sync.localDirty = false;
    } else return false;
    Sync.conflict = null; Sync.lastError = null;
    emit('conflict', { conflict: null });
    if (choice === 'remote') artwork(remote, 'resolve-remote');
    else flush();
    return !Sync.lastError;
  };
  Sync.disconnect = function () {
    var ws = Sync.socket;
    if (cancelConnection) cancelConnection();
    Sync.epoch++;
    Sync.socket = null; Sync.connected = false; Sync.ready = false; Sync.room = null;
    Sync.version = 0; Sync.editRevision = 0; Sync.awaitingVersion = null; Sync.localDirty = false; Sync.conflict = null;
    pending = null; inFlight = null; remote = null;
    if (ws) { try { ws.close(1000, 'client disconnect'); } catch (err) {} }
    emit('conflict', { conflict: null }); state();
  };
  global.addEventListener('beforeunload', Sync.disconnect);
})(window);
