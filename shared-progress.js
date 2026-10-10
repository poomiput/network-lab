(function (root) {
  "use strict";
  let clientPromise, authPromise;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const keyPattern = /^[0-9a-f]{64}$/i;
  const blockPattern = /^(hsrp|vrrp):(CE01|CE02|MLS01|MLS02|R01|SW01):.{1,255}$/;
  const signaturePattern = /^\d{1,6}:[0-9a-f]{1,8}$/;
  function configured() {
    const c = root.G06_SUPABASE;
    return !!(c && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(c.url) && /^sb_publishable_[A-Za-z0-9_-]+$/.test(c.publishableKey));
  }
  function roomFromURL(url) {
    const params = new URL(url).searchParams;
    const template = params.get("template");
    if (template !== null) {
      if (!uuid.test(template)) throw new Error("ลิงก์ Template ไม่ถูกต้อง กรุณาเลือกใหม่จากรายการ");
      return { id: template, template: true };
    }
    const id = params.get("room"), key = params.get("key");
    if (!id && !key) return null;
    if (!uuid.test(id || "") || !keyPattern.test(key || "")) throw new Error("ลิงก์ห้องไม่ครบหรือไม่ถูกต้อง กรุณาใช้ลิงก์ที่ได้จากปุ่ม Copy ลิงก์ห้อง");
    return { id, key };
  }
  function roomURL(url, room) {
    const result = new URL(url);
    result.searchParams.delete("room"); result.searchParams.delete("key"); result.searchParams.delete("template");
    if (room?.template) result.searchParams.set("template", room.id);
    else if (room) { result.searchParams.set("room", room.id); result.searchParams.set("key", room.key); }
    return result.href;
  }
  function readRows(rows) {
    const result = {};
    for (const row of rows || []) if (blockPattern.test(row.block_key) && signaturePattern.test(row.signature || "")) result[row.block_key] = row.signature;
    return result;
  }
  async function client() {
    if (!configured()) throw new Error("ยังไม่ได้ตั้งค่า Supabase ของเว็บนี้");
    if (!clientPromise) clientPromise = (async () => {
      const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm");
      return createClient(root.G06_SUPABASE.url, root.G06_SUPABASE.publishableKey);
    })().catch((e) => { clientPromise = null; throw e; });
    const c = await clientPromise;
    if (!authPromise) authPromise = (async () => {
      const { data, error } = await c.auth.getSession();
      if (error) throw error;
      if (!data.session) {
        const signed = await c.auth.signInAnonymously();
        if (signed.error) throw signed.error;
      }
      return c;
    })().finally(() => { authPromise = null; });
    return authPromise;
  }
  async function createRoom() {
    const c = await client();
    const { data, error } = await c.rpc("g06_create_room");
    if (error) throw error;
    return { id: data.room_id, key: data.join_key };
  }
  function templateError(error) {
    if (["PGRST202", "42703"].includes(error.code)) return new Error("ต้องอัปเดต SQL สำหรับ Template ก่อนหนึ่งครั้ง");
    return error;
  }
  async function listTemplates() {
    const c = await client();
    const { data, error } = await c.rpc("g06_list_templates");
    if (error) throw templateError(error);
    return data || [];
  }
  async function createTemplate(name) {
    const c = await client();
    const { data, error } = await c.rpc("g06_create_template", { p_name: name });
    if (error) throw templateError(error);
    return { id: data.id, name: data.name, template: true };
  }
  async function connect(room, onData, onStatus) {
    const c = await client();
    const joined = room.template
      ? await c.rpc("g06_open_template", { p_id: room.id })
      : await c.rpc("g06_join_room", { p_room_id: room.id, p_join_key: room.key });
    if (joined.error) throw templateError(joined.error);
    if (room.template) room.name = joined.data.name;
    let closed = false, syncing = false, syncAgain = false;
    async function sync() {
      if (closed) return;
      if (syncing) { syncAgain = true; return; }
      syncing = true;
      try {
        const results = await Promise.all([
          c.from("g06_copy_progress").select("block_key,signature").eq("room_id", room.id),
          c.from("g06_interface_ports").select("set_id,device_id,original,replacement").eq("room_id", room.id),
          c.from("g06_interface_history").select("id,set_id,device_id,changes,changed_at").eq("room_id", room.id).order("id", { ascending: true })
        ]);
        for (const result of results) if (result.error) throw result.error;
        if (!closed) onData({ copied: readRows(results[0].data), ports: results[1].data, history: results[2].data });
      } catch (e) { if (!closed) onStatus("error", e.message); }
      finally { syncing = false; if (syncAgain) { syncAgain = false; sync(); } }
    }
    const channel = c.channel("g06-room-" + room.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "g06_copy_progress", filter: "room_id=eq." + room.id }, sync)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "g06_interface_history", filter: "room_id=eq." + room.id }, sync)
      .subscribe((status) => {
        if (closed) return;
        if (status === "SUBSCRIBED") { onStatus("live"); sync(); }
        else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) onStatus("offline");
      });
    await sync();
    return {
      async write(entries) {
        const rows = Object.entries(entries).map(([block_key, signature]) => ({ room_id: room.id, block_key, signature }));
        if (!rows.length) return;
        const { error } = await c.from("g06_copy_progress").upsert(rows, { onConflict: "room_id,block_key" });
        if (error) throw error;
        await sync();
      },
      async setInterfaces(set, device, originals, replacements) {
        const { error } = await c.rpc("g06_set_interfaces", { p_room_id: room.id, p_set_id: set, p_device_id: device, p_originals: originals, p_replacements: replacements });
        if (error) throw error;
        await sync();
      },
      sync,
      close() { closed = true; c.removeChannel(channel); }
    };
  }
  root.G06SharedProgress = { configured, roomFromURL, roomURL, readRows, createRoom, listTemplates, createTemplate, connect };
})(typeof window !== "undefined" ? window : globalThis);
