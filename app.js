const el = (id) => document.getElementById(id);
let base = localStorage.getItem("comfy-mobile-worker") || "https://comfy-mobile.trustsignalbot.workers.dev";
let pass = localStorage.getItem("comfy-mobile-pass") || "";
let timer;
el("workerUrl").value = base; el("pass").value = pass;
const head = () => ({ "content-type": "application/json", "x-comfy-pass": pass });
async function api(path, options = {}) {
  let response;
  try { response = await fetch(base.replace(/\/$/, "") + path, { ...options, headers: { ...head(), ...(options.headers || {}) } }); }
  catch (_) { throw new Error("受付に届かない(電波かWorker URLを確認)"); }
  if (!response.ok) throw new Error(response.status === 401 ? "合言葉が違う(前後の空白や全角に注意)" : "受付がエラーを返した: " + response.status);
  return response.status === 204 ? null : response.json();
}
async function imageUrl(id) {
  const response = await fetch(base + "/api/images/" + id, { headers: { "x-comfy-pass": pass } });
  if (!response.ok) throw new Error("image fetch failed");
  return URL.createObjectURL(await response.blob());
}
function options(id, values, allowNone) { const select = el(id); select.replaceChildren(); if (allowNone) select.add(new Option("none", "")); values.forEach((value) => select.add(new Option(value, value))); }
function save() { const data = {}; document.querySelectorAll("#jobForm input,#jobForm select,#jobForm textarea").forEach((node) => data[node.id] = node.value); localStorage.setItem("comfy-mobile-settings", JSON.stringify(data)); }
function restore() { try { Object.entries(JSON.parse(localStorage.getItem("comfy-mobile-settings") || "{}")).forEach(([id, value]) => { if (el(id)) el(id).value = value; }); } catch (_) {} }
async function connect() {
  base = el("workerUrl").value.trim().replace(/\/$/, ""); pass = el("pass").value.trim();
  if (!base || !pass) throw new Error("Worker URLと合言葉を入れてね");
  const cap = await api("/api/capabilities"); options("checkpoint", cap.checkpoints || [], false); options("lora1", cap.loras || [], true); options("lora2", cap.loras || [], true); restore();
  try { localStorage.setItem("comfy-mobile-worker", base); localStorage.setItem("comfy-mobile-pass", pass); } catch (_) {}
  el("connectionCard").hidden = true; el("jobForm").hidden = false; el("connection").textContent = "つながった";
}
function settings() {
  const loras = [1, 2].map((n) => ({ name: el("lora" + n).value, strength: Number(el("strength" + n).value) })).filter((x) => x.name);
  return { checkpoint: el("checkpoint").value, loras, positive: el("positive").value, negative: el("negative").value, size: el("size").value, steps: Number(el("steps").value), cfg: Number(el("cfg").value), sampler: el("sampler").value, scheduler: el("scheduler").value, seed: el("seed").value === "" ? null : Number(el("seed").value), count: Number(el("count").value) };
}
async function watch(id, started) {
  el("result").hidden = false; clearInterval(timer);
  const tick = async () => { try { const job = await api("/api/jobs/" + id); el("status").textContent = "working: " + Math.floor((Date.now() - started) / 1000) + "s"; if (job.status === "done") { clearInterval(timer); const image = el("image"); image.src = await imageUrl(id); image.dataset.jobId = id; image.hidden = false; el("sendDiscord").hidden = false; el("status").textContent = "done"; await api("/api/jobs/" + id + "/shown", { method: "POST", body: "{}" }); } } catch (error) { el("status").textContent = error.message; } };
  await tick(); timer = setInterval(tick, 3000);
}
el("connect").onclick = async () => {
  const button = el("connect"), note = el("connectNote");
  button.disabled = true; button.textContent = "接続中…"; note.textContent = "";
  try { await connect(); } catch (error) { note.textContent = error.message; }
  finally { button.disabled = false; button.textContent = "接続する"; }
};
el("jobForm").onsubmit = async (event) => { event.preventDefault(); save(); const button = event.submitter; button.disabled = true; try { const job = await api("/api/jobs", { method: "POST", body: JSON.stringify(settings()) }); await watch(job.id, Date.now()); } catch (error) { el("result").hidden = false; el("status").textContent = error.message; } finally { button.disabled = false; } };
el("sendDiscord").onclick = async () => { const id = el("image").dataset.jobId; await api("/api/jobs/" + id + "/discord", { method: "POST", body: "{}" }); el("sendDiscord").disabled = true; };
if (base && pass) connect().catch(() => {});
