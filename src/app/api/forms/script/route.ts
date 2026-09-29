/**
 * The script a website embeds beside its CRM forms.
 *
 * It remembers where the visitor first came from - UTM tags, landing page,
 * outside referrer - in their own browser, and where this visit came from, and
 * sends both with any form marked data-babultech-form. It then shows the
 * form's thank-you message, or goes to its thank-you page. With scripts off
 * the form still posts, just without the tracking.
 *
 * Nothing is sent anywhere until the visitor submits a form.
 */

export const dynamic = "force-static";

const SCRIPT = `(function () {
  var FIRST = "bt_first_touch", LATEST = "bt_latest_touch";
  var keys = { utm_source: "utmSource", utm_medium: "utmMedium", utm_campaign: "utmCampaign", utm_content: "utmContent", utm_term: "utmTerm" };
  function store(kind) { try { return kind === FIRST ? window.localStorage : window.sessionStorage; } catch (e) { return null; } }
  function read(kind) { try { var s = store(kind); return s ? JSON.parse(s.getItem(kind) || "null") : null; } catch (e) { return null; } }
  function write(kind, v) { try { var s = store(kind); if (s) s.setItem(kind, JSON.stringify(v)); } catch (e) {} }

  var params = new URLSearchParams(window.location.search), now = {}, tagged = false;
  Object.keys(keys).forEach(function (k) { var v = params.get(k); if (v) { now[keys[k]] = v.slice(0, 200); tagged = true; } });
  var ref = document.referrer;
  try { if (ref && new URL(ref).host === window.location.host) ref = ""; } catch (e) { ref = ""; }
  now.landingPage = window.location.href.slice(0, 500);
  if (ref) now.referrer = ref.slice(0, 500);
  now.at = new Date().toISOString();

  if (!read(FIRST)) write(FIRST, now);
  // This visit's touch: kept from the page it started on, replaced by any page
  // arrived at with new tags or from another site.
  if (!read(LATEST) || tagged || ref) write(LATEST, now);

  function submit(form, event) {
    event.preventDefault();
    var data = {};
    new FormData(form).forEach(function (v, k) { if (typeof v === "string") data[k] = v; });
    data._touch = { first: read(FIRST) || now, latest: read(LATEST) || now };
    var button = form.querySelector('[type="submit"]');
    if (button) button.disabled = true;
    var note = form.querySelector("[data-babultech-message]");
    if (!note) { note = document.createElement("p"); note.setAttribute("data-babultech-message", ""); note.setAttribute("role", "status"); form.appendChild(note); }
    note.textContent = "";
    fetch(form.action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: "Something went wrong. Please try again." }; }); })
      .then(function (res) {
        if (res.ok) {
          if (res.redirect) { window.location.href = res.redirect; return; }
          var done = document.createElement("p");
          done.setAttribute("role", "status");
          done.textContent = res.message || "Thank you.";
          form.replaceWith(done);
        } else {
          note.textContent = res.error || "Something went wrong. Please try again.";
          if (button) button.disabled = false;
        }
      })
      .catch(function () { note.textContent = "Something went wrong. Please try again."; if (button) button.disabled = false; });
  }

  function wire() {
    document.querySelectorAll("form[data-babultech-form]").forEach(function (form) {
      if (form.__babultech) return;
      form.__babultech = true;
      form.addEventListener("submit", function (e) { submit(form, e); });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire); else wire();
})();
`;

export function GET() {
  return new Response(SCRIPT, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
