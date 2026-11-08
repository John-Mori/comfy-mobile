const el = (id) => document.getElementById(id);
let base = localStorage.getItem("comfy-mobile-worker") || "https://comfy-mobile.trustsignalbot.workers.dev";
let pass = localStorage.getItem("comfy-mobile-pass") || "";
let timer;
const STAGE = { queued: "受付に届いた。PCが拾うのを待ってる", processing: "PCで描いてる", done: "できた", delivery_queued: "Discordへ送る順番待ち", delivering: "Discordへ送ってる" };
el("workerUrl").value = base; el("pass").value = pass;
const head = () => ({ "content-type": "application/json", "x-comfy-pass": pass });
async function api(path, options = {}) {
  let response;
  const ctrl = new AbortController(), wait = setTimeout(() => ctrl.abort(), 20000);
  try { response = await fetch(base.replace(/\/$/, "") + path, { ...options, signal: ctrl.signal, headers: { ...head(), ...(options.headers || {}) } }); }
  catch (error) { throw new Error(error.name === "AbortError" ? "受付から20秒返事がない。もう一度押してみて" : "受付に届かない(電波かWorker URLを確認)"); }
  finally { clearTimeout(wait); }
  if (!response.ok) throw new Error(response.status === 401 ? "合言葉が違う(前後の空白や全角に注意)" : "受付がエラーを返した: " + response.status);
  return response.status === 204 ? null : response.json();
}
async function imageUrl(id) {
  const response = await fetch(base + "/api/images/" + id, { headers: { "x-comfy-pass": pass } });
  if (!response.ok) throw new Error("image fetch failed");
  return URL.createObjectURL(await response.blob());
}
function options(id, values, allowNone) { const select = el(id); select.replaceChildren(); if (allowNone) select.add(new Option("なし(使わない)", "")); values.forEach((value) => select.add(new Option(value, value))); }
function save() { const data = {}; document.querySelectorAll("#jobForm input,#jobForm select,#jobForm textarea").forEach((node) => data[node.id] = node.value); localStorage.setItem("comfy-mobile-settings", JSON.stringify(data)); }
function restore() { try { Object.entries(JSON.parse(localStorage.getItem("comfy-mobile-settings") || "{}")).forEach(([id, value]) => { if (el(id)) el(id).value = value; }); } catch (_) {} }
async function connect() {
  base = el("workerUrl").value.trim().replace(/\/$/, ""); pass = el("pass").value.trim();
  if (!base || !pass) throw new Error("Worker URLと合言葉を入れてね");
  const cap = await api("/api/capabilities"); options("checkpoint", cap.checkpoints || [], false); options("lora1", cap.loras || [], true); options("lora2", cap.loras || [], true); restore();
  try { localStorage.setItem("comfy-mobile-worker", base); localStorage.setItem("comfy-mobile-pass", pass); } catch (_) {}
  el("connectionCard").hidden = true; el("jobForm").hidden = false; el("connection").textContent = (cap.checkpoints || []).length ? "つながった" : "つながったけど、PCからモデルの一覧が届いていない(PCの待ち受けが止まっているかも)";
}
function settings() {
  const loras = [1, 2].map((n) => ({ name: el("lora" + n).value, strength: Number(el("strength" + n).value) })).filter((x) => x.name);
  return { checkpoint: el("checkpoint").value, loras, positive: el("positive").value, negative: el("negative").value, size: el("size").value, steps: Number(el("steps").value), cfg: Number(el("cfg").value), sampler: el("sampler").value, scheduler: el("scheduler").value, seed: el("seed").value === "" ? null : Number(el("seed").value), count: Number(el("count").value) };
}
async function watch(id, started) {
  el("result").hidden = false; clearInterval(timer);
  const tick = async () => { try { const job = await api("/api/jobs/" + id); const sec = Math.floor((Date.now() - started) / 1000); el("status").textContent = (STAGE[job.status] || job.status) + "(" + sec + "秒)" + (sec > 120 && job.status === "processing" ? " いつもより遅い。PCで会話用のAIを載せ直している最中だと、それが終わるまで待ってから描く(最大10分ほど)" : ""); if (job.status === "done") { clearInterval(timer); const image = el("image"); image.src = await imageUrl(id); image.dataset.jobId = id; image.hidden = false; el("sendDiscord").hidden = false; el("sendDiscord").disabled = false; el("sendDiscord").textContent = "Discordへ送る"; el("deleteImage").hidden = false; el("deleteImage").disabled = false; el("deleteImage").textContent = "削除する"; el("status").textContent = "できた(" + Math.floor((Date.now() - started) / 1000) + "秒)。このまま次も作れるし、下のボタンでDiscordへ送れる。画像は24時間で消える"; await api("/api/jobs/" + id + "/shown", { method: "POST", body: "{}" }); } } catch (error) { el("status").textContent = error.message; } };
  await tick(); timer = setInterval(tick, 3000);
}
el("pass").onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); el("connect").click(); } };
el("connect").onclick = async () => {
  const button = el("connect"), note = el("connectNote");
  button.disabled = true; button.textContent = "接続中…"; note.textContent = "";
  try { await connect(); } catch (error) { note.textContent = error.message; }
  finally { button.disabled = false; button.textContent = "接続する"; }
};
el("jobForm").onsubmit = async (event) => { event.preventDefault(); save(); const button = event.submitter; button.disabled = true; try { const job = await api("/api/jobs", { method: "POST", body: JSON.stringify(settings()) }); await watch(job.id, Date.now()); } catch (error) { el("result").hidden = false; el("status").textContent = error.message; } finally { button.disabled = false; } };
el("sendDiscord").onclick = async () => { const button = el("sendDiscord"), id = el("image").dataset.jobId; button.disabled = true; try { await api("/api/jobs/" + id + "/discord", { method: "POST", body: "{}" }); button.textContent = "送る手配をした(PCが数秒で部屋へ貼る)"; } catch (error) { button.disabled = false; el("status").textContent = error.message; } };
el("deleteImage").onclick = async () => {
  const button = el("deleteImage"), image = el("image"), id = image.dataset.jobId;
  if (!id || !confirm("この画像を受付から消す? ページとDiscordへ送る分が消える(PCの保存分は残る)")) return;
  button.disabled = true; button.textContent = "削除中…";
  try { await api("/api/jobs/" + id, { method: "DELETE" }); if (image.src.startsWith("blob:")) URL.revokeObjectURL(image.src); image.removeAttribute("src"); image.hidden = true; delete image.dataset.jobId; el("sendDiscord").hidden = true; button.hidden = true; el("status").textContent = "消した。PCのComfyUIの出力フォルダには残っている"; }
  catch (error) { button.disabled = false; button.textContent = "削除する"; el("status").textContent = error.message.includes("409") ? "Discordへ送っている最中なので、終わってから消してね" : error.message; }
};
if (base && pass) { el("connection").textContent = "前の合言葉でつないでいる…"; connect().catch((error) => { el("connection").textContent = "接続先と合言葉を入れる"; el("connectNote").textContent = "前の合言葉ではつながらなかった: " + error.message; }); }
