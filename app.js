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
const LORA_NAMES = [
  [/^fusohlocal_v1[\\/]fusohlocal_v1\.safetensors$/i, () => "扶桑・自前学習の完成版(おすすめ・強さ0.7)"],
  [/^fusohlocal_v1[\\/]fusohlocal_v1-0*(\d+)\.safetensors$/i, (m) => "扶桑・自前学習の途中保存(" + m[1] + "周目)"],
  [/^fusoh_v0/i, () => "扶桑 v0・手描き風(旧・PixAI製)"],
  [/^fusoh_v2/i, () => "扶桑 v2・漫画風"],
  [/^itsumono/i, () => "いつもの(twitter用)"],
];
const LORA_HIDE = /minimax_h3|h3-image/i; // 動画(H3)用。この画面の絵のモデルには効かない
function loraName(value) { for (const [re, f] of LORA_NAMES) { const m = value.match(re); if (m) return f(m); } return value.split(/[\\/]/).pop().replace(/\.safetensors$/i, ""); }
function loraList(values) { return values.filter((v) => !LORA_HIDE.test(v)).map((v, i) => ({ v, i, rank: LORA_NAMES.findIndex(([re]) => re.test(v)) })).sort((a, b) => (a.rank < 0 ? 99 : a.rank) - (b.rank < 0 ? 99 : b.rank) || a.i - b.i).map((x) => x.v); }
function options(id, values, allowNone, label = (v) => v) { const select = el(id); select.replaceChildren(); if (allowNone) select.add(new Option("なし(使わない)", "")); values.forEach((value) => select.add(new Option(label(value), value))); }
function save() { const data = {}; document.querySelectorAll("#jobForm input,#jobForm select,#jobForm textarea").forEach((node) => data[node.id] = node.value); localStorage.setItem("comfy-mobile-settings", JSON.stringify(data)); }
function restore() { try { Object.entries(JSON.parse(localStorage.getItem("comfy-mobile-settings") || "{}")).forEach(([id, value]) => { if (el(id)) el(id).value = value; }); } catch (_) {} }
async function connect() {
  base = el("workerUrl").value.trim().replace(/\/$/, ""); pass = el("pass").value.trim();
  if (!base || !pass) throw new Error("Worker URLと合言葉を入れてね");
  const cap = await api("/api/capabilities"); options("checkpoint", cap.checkpoints || [], false); options("lora1", loraList(cap.loras || []), true, loraName); options("lora2", loraList(cap.loras || []), true, loraName); restore();
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
