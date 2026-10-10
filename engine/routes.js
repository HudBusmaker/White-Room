import { normaliseLevel } from "./subjects.js";
// HTTP routes for practice sets. Every route needs a logged-in student.
const IMG_OK = (x) => typeof x === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(x) && x.length < 4_000_000;

export function makePracticeRoute({ practice, requireStudent, readBody, json, allow, maxImages = 3, getUser = null }) {
  return async function practiceRoute(req, res, url) {
    const user = requireStudent(req, res); if (!user) return;
    const p = url.pathname;
    // the level and subjects this student chose (null = they have not chosen yet, so show everything)
    let who = null;
    if (getUser) { const u = await getUser(user.id); const level = u?.levelKey || normaliseLevel(u?.level); if (level && Array.isArray(u?.subjects) && u.subjects.length) who = { level, subjects: u.subjects }; }
    if (req.method === "GET" && p === "/api/practice/overview") return json(res, 200, await practice.overview(user.id, who));
    if (req.method === "GET" && p === "/api/practice/photos") return json(res, 200, { ok: true, photos: await practice.photoList(user.id) });
    if (req.method === "GET" && p === "/api/practice/set") {
      const out = await practice.getSet(user.id, url.searchParams.get("id") || "");
      return json(res, out.ok ? 200 : 404, out.ok ? out : { ok: false, ...out });
    }
    if (req.method === "POST" && p === "/api/practice/set") {
      let body = {}; try { body = await readBody(req, 4 * 1024); } catch { return json(res, 400, { ok: false, problem: "Invalid request." }); }
      const out = await practice.newSet(user.id, body.subject ? String(body.subject) : null, who);
      return json(res, out.ok ? 200 : 400, out.ok ? out : { ok: false, ...out });
    }
    if (req.method === "POST" && p === "/api/practice/submit") {
      let body = {}; try { body = await readBody(req, 32 * 1024); } catch { return json(res, 400, { ok: false, problem: "Invalid request." }); }
      const out = await practice.submitSet(user.id, String(body.setId || ""), body.answers);
      return json(res, out.ok ? 200 : 400, out.ok ? out : { ok: false, ...out });
    }
    if (req.method === "POST" && p === "/api/practice/photo") {
      let body = {}; try { body = await readBody(req); } catch { return json(res, 400, { ok: false, problem: "The upload was too large or not valid. Try a smaller photo." }); }
      const imgs = Array.isArray(body.images) ? body.images.slice(0, maxImages) : [];
      if (!imgs.length || !imgs.every(IMG_OK)) return json(res, 400, { ok: false, problem: "Add one to three photos (JPEG, PNG or WebP)." });
      const wait = allow(user.id);
      if (wait) return json(res, 429, { ok: false, problem: wait });
      const out = await practice.markPhoto(user.id, String(body.setId || ""), String(body.questionId || ""), imgs);
      return json(res, out.ok ? 200 : 400, out.ok ? { ok: true, submissionId: out.submissionId, message: "Sent to Head Staff. Your result appears here once it is released." } : { ok: false, ...out });
    }
    return json(res, 404, { ok: false, problem: "Not found." });
  };
}
