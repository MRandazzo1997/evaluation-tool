// ─────────────────────────────────────────────────────────────
// Firebase Configuration
// Replace placeholder values with your project credentials.
// ─────────────────────────────────────────────────────────────
import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getFirestore, collection, getDocs, addDoc, updateDoc,
  deleteDoc, doc, orderBy, query, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDurtWkI0PVo3Mkdc57-YCaMWS8RlEyjbY",
  authDomain: "evaluation-tool-4b30e.firebaseapp.com",
  projectId: "evaluation-tool-4b30e",
  storageBucket: "evaluation-tool-4b30e.firebasestorage.app",
  messagingSenderId: "844031556087",
  appId: "1:844031556087:web:f4319e9a17571dc16556f2",
  measurementId: "G-ZHQEKSY216"
};

// ─────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────
const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

// ─────────────────────────────────────────────────────────────
// App State
// ─────────────────────────────────────────────────────────────
const scores = {};          // scores[criteriaId][subIndex] = 0–5  (0 = not evaluated)
let criteriaList = [];      // cached from Firestore
let currentUser  = null;    // Firebase User | null
let drawerOpen   = false;

// ─────────────────────────────────────────────────────────────
// DOM References
// ─────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const elBtnLogin        = $("btn-login");
const elBtnLogout       = $("btn-logout");
const elBtnAdminPanel   = $("btn-admin-panel");
const elUserInfo        = $("user-info");
const elUserEmail       = $("user-email");

const elLoginModal      = $("login-modal");
const elModalBackdrop   = $("modal-backdrop");
const elBtnCloseModal   = $("btn-close-modal");
const elBtnSubmitLogin  = $("btn-submit-login");
const elLoginEmail      = $("login-email");
const elLoginPassword   = $("login-password");
const elLoginError      = $("login-error");

const elDrawer          = $("admin-drawer");
const elDrawerBackdrop  = $("drawer-backdrop");
const elBtnCloseDrawer  = $("btn-close-drawer");

const elNewTitle        = $("new-title");
const elNewThreshold    = $("new-threshold");
const elBtnAddCriteria  = $("btn-add-criteria");
const elAddError        = $("add-error");
const elAdminList       = $("admin-list");

const elStateLoading    = $("state-loading");
const elStateError      = $("state-error");
const elStateEmpty      = $("state-empty");
const elErrorMessage    = $("error-message");
const elCriteriaContainer = $("criteria-container");
const elOverallResult   = $("overall-result");
const elOverallBadge    = $("overall-badge");

// ─────────────────────────────────────────────────────────────
// Auth UI
// ─────────────────────────────────────────────────────────────
function applyAuthUI(user) {
  currentUser = user;
  const loggedIn = !!user;

  // Header buttons
  elBtnLogin.classList.toggle("hidden", loggedIn);
  elUserInfo.classList.toggle("hidden", !loggedIn);
  if (user) elUserEmail.textContent = user.email;

  // Admin-only elements
  document.querySelectorAll(".admin-only").forEach(el => {
    el.classList.toggle("hidden", !loggedIn);
  });

  // Close admin drawer on logout
  if (!loggedIn && drawerOpen) closeDrawer();
}

// ─────────────────────────────────────────────────────────────
// Login Modal
// ─────────────────────────────────────────────────────────────
function openLoginModal() {
  elLoginModal.classList.remove("hidden");
  elModalBackdrop.classList.remove("hidden");
  elLoginEmail.value = "";
  elLoginPassword.value = "";
  hideError(elLoginError);
  setTimeout(() => elLoginEmail.focus(), 50);
}

function closeLoginModal() {
  elLoginModal.classList.add("hidden");
  elModalBackdrop.classList.add("hidden");
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideError(el) {
  el.textContent = "";
  el.classList.add("hidden");
}

async function handleLogin() {
  const email    = elLoginEmail.value.trim();
  const password = elLoginPassword.value;

  if (!email || !password) {
    showError(elLoginError, "Please enter your email and password.");
    return;
  }

  elBtnSubmitLogin.disabled = true;
  elBtnSubmitLogin.textContent = "Signing in…";
  hideError(elLoginError);

  try {
    await signInWithEmailAndPassword(auth, email, password);
    closeLoginModal();
  } catch (err) {
    showError(elLoginError, friendlyAuthError(err.code));
  } finally {
    elBtnSubmitLogin.disabled = false;
    elBtnSubmitLogin.textContent = "Sign In";
  }
}

function friendlyAuthError(code) {
  const map = {
    "auth/user-not-found":      "No account found with that email.",
    "auth/wrong-password":      "Incorrect password.",
    "auth/invalid-email":       "Please enter a valid email address.",
    "auth/too-many-requests":   "Too many attempts. Please try again later.",
    "auth/invalid-credential":  "Invalid email or password.",
  };
  return map[code] || "Sign in failed. Please check your credentials.";
}

// ─────────────────────────────────────────────────────────────
// Admin Drawer
// ─────────────────────────────────────────────────────────────
async function openDrawer() {
  drawerOpen = true;
  elDrawer.classList.remove("hidden");
  elDrawer.classList.add("drawer-open");
  elDrawerBackdrop.classList.remove("hidden");
  elBtnAdminPanel.setAttribute("aria-expanded", "true");

  // Always re-fetch so the panel reflects the latest Firestore state,
  // even if the initial loadCriteria() hadn't finished when the user
  // clicks the button.  loadCriteria() calls renderAdminList() at the
  // end, so no extra call is needed here.
  await loadCriteria();
}

function closeDrawer() {
  drawerOpen = false;
  elDrawer.classList.add("hidden");
  elDrawer.classList.remove("drawer-open");
  elDrawerBackdrop.classList.add("hidden");
  elBtnAdminPanel.setAttribute("aria-expanded", "false");
}

// ─────────────────────────────────────────────────────────────
// Firestore: Load
// ─────────────────────────────────────────────────────────────
async function loadCriteria() {
  showState("loading");

  try {
    const q        = query(collection(db, "criteria"), orderBy("order"));
    const snapshot = await getDocs(q);

    criteriaList = snapshot.docs.map(d => ({
      id: d.id,
      ...d.data(),
      subCriteria: d.data().subCriteria || [],
    }));

    if (criteriaList.length === 0) {
      showState("empty");
    } else {
      renderEvaluator(criteriaList);
      showApp();
      updateBadges();
    }

    // Always keep the admin panel in sync with the latest data.
    // If the drawer is closed this is a no-op visually, but the list
    // will be correct the instant the user opens it.
    renderAdminList();

  } catch (err) {
    console.error("Firestore load error:", err);
    elErrorMessage.textContent = `Failed to load criteria: ${err.message}`;
    showState("error");
  }
}

// ─────────────────────────────────────────────────────────────
// Firestore: Add
// ─────────────────────────────────────────────────────────────
async function addCriteria() {
  const title     = elNewTitle.value.trim();
  const threshold = parseFloat(elNewThreshold.value);

  hideError(elAddError);

  if (!title) {
    showError(elAddError, "Please enter a title.");
    return;
  }
  if (isNaN(threshold) || threshold < 0 || threshold > 5) {
    showError(elAddError, "Threshold must be a number between 0 and 5.");
    return;
  }

  elBtnAddCriteria.disabled = true;
  elBtnAddCriteria.textContent = "Adding…";

  try {
    const newOrder = criteriaList.length > 0
      ? Math.max(...criteriaList.map(c => c.order ?? 0)) + 1
      : 0;

    await addDoc(collection(db, "criteria"), {
      title,
      threshold,
      subCriteria: [],
      order: newOrder,
    });

    elNewTitle.value     = "";
    elNewThreshold.value = "";
    await loadCriteria();
  } catch (err) {
    showError(elAddError, `Failed to add: ${err.message}`);
  } finally {
    elBtnAddCriteria.disabled = false;
    elBtnAddCriteria.textContent = "Add Criteria";
    // restore button icon
    elBtnAddCriteria.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add Criteria`;
  }
}

// ─────────────────────────────────────────────────────────────
// Firestore: Update
// ─────────────────────────────────────────────────────────────
async function saveCriteria(id, data, msgEl) {
  try {
    await updateDoc(doc(db, "criteria", id), data);
    showInlineMsg(msgEl, "Saved", "ok");
    await loadCriteria();
  } catch (err) {
    showInlineMsg(msgEl, "Error: " + err.message, "err");
  }
}

// ─────────────────────────────────────────────────────────────
// Firestore: Delete
// ─────────────────────────────────────────────────────────────
async function deleteCriteria(id, cardEl) {
  if (!confirm("Delete this criteria? This cannot be undone.")) return;
  try {
    cardEl.style.opacity = "0.4";
    cardEl.style.pointerEvents = "none";
    await deleteDoc(doc(db, "criteria", id));
    await loadCriteria();
  } catch (err) {
    alert("Delete failed: " + err.message);
    cardEl.style.opacity = "";
    cardEl.style.pointerEvents = "";
  }
}

// ─────────────────────────────────────────────────────────────
// Admin Panel Render
// ─────────────────────────────────────────────────────────────
function showInlineMsg(el, text, type) {
  el.textContent = text;
  el.className   = `inline-msg ${type}`;
  el.classList.remove("hidden");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add("hidden"), 2500);
}

function renderAdminList() {
  elAdminList.innerHTML = "";

  if (criteriaList.length === 0) {
    elAdminList.innerHTML = '<div class="admin-empty">No criteria yet. Add one above.</div>';
    return;
  }

  criteriaList.forEach(criteria => {
    const card = document.createElement("div");
    card.className = "admin-card";

    // ── Card Header (title + threshold + save/delete) ──────
    const headerEl = document.createElement("div");
    headerEl.className = "admin-card-header";

    const fieldsRow = document.createElement("div");
    fieldsRow.className = "admin-card-fields";

    const titleInput = document.createElement("input");
    titleInput.type  = "text";
    titleInput.className = "field";
    titleInput.value = criteria.title;
    titleInput.placeholder = "Criteria title";

    const threshInput = document.createElement("input");
    threshInput.type  = "number";
    threshInput.className = "field field--sm";
    threshInput.value = criteria.threshold;
    threshInput.placeholder = "Threshold";
    threshInput.step  = "0.1";
    threshInput.min   = "0";
    threshInput.max   = "5";

    fieldsRow.appendChild(titleInput);
    fieldsRow.appendChild(threshInput);

    const actionsRow = document.createElement("div");
    actionsRow.className = "admin-card-actions";

    const saveRow = document.createElement("div");
    saveRow.className = "admin-save-row";

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn-primary btn-save";
    saveBtn.textContent = "Save";

    const msgEl = document.createElement("span");
    msgEl.className = "inline-msg hidden";

    saveRow.appendChild(saveBtn);
    saveRow.appendChild(msgEl);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-delete";
    deleteBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      Delete`;

    actionsRow.appendChild(saveRow);
    actionsRow.appendChild(deleteBtn);

    headerEl.appendChild(fieldsRow);
    headerEl.appendChild(actionsRow);
    card.appendChild(headerEl);

    // ── Sub-criteria section ───────────────────────────────
    const subSection = document.createElement("div");
    subSection.className = "admin-sub-section";

    const subLabel = document.createElement("div");
    subLabel.className = "sub-section-label";
    subLabel.textContent = "Sub-criteria";

    const subList = document.createElement("div");
    subList.className = "admin-sub-list";

    // local copy of sub-criteria to manipulate before saving
    let localSubs = [...(criteria.subCriteria || [])];

    function rebuildSubRows() {
      subList.innerHTML = "";
      localSubs.forEach((sub, idx) => {
        const row = document.createElement("div");
        row.className = "admin-sub-row";

        const input = document.createElement("input");
        input.type  = "text";
        input.className = "field";
        input.value = sub;
        input.placeholder = `Sub-criteria ${idx + 1}`;
        input.addEventListener("input", () => { localSubs[idx] = input.value; });

        const removeBtn = document.createElement("button");
        removeBtn.className = "btn-remove-sub";
        removeBtn.type = "button";
        removeBtn.title = "Remove";
        removeBtn.innerHTML = "×";
        removeBtn.addEventListener("click", () => {
          localSubs.splice(idx, 1);
          rebuildSubRows();
        });

        row.appendChild(input);
        row.appendChild(removeBtn);
        subList.appendChild(row);
      });
    }

    rebuildSubRows();

    const addSubBtn = document.createElement("button");
    addSubBtn.className = "btn-add-sub";
    addSubBtn.type = "button";
    addSubBtn.innerHTML = `
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add Sub-criteria`;
    addSubBtn.addEventListener("click", () => {
      localSubs.push("");
      rebuildSubRows();
      // focus new input
      const inputs = subList.querySelectorAll("input");
      if (inputs.length) inputs[inputs.length - 1].focus();
    });

    subSection.appendChild(subLabel);
    subSection.appendChild(subList);
    subSection.appendChild(addSubBtn);
    card.appendChild(subSection);

    // ── Wire save / delete ─────────────────────────────────
    saveBtn.addEventListener("click", async () => {
      const newTitle = titleInput.value.trim();
      const newThresh = parseFloat(threshInput.value);

      if (!newTitle) { showInlineMsg(msgEl, "Title is required", "err"); return; }
      if (isNaN(newThresh) || newThresh < 0 || newThresh > 5) {
        showInlineMsg(msgEl, "Threshold must be 0–5", "err"); return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";

      await saveCriteria(criteria.id, {
        title:       newTitle,
        threshold:   newThresh,
        subCriteria: localSubs.map(s => s.trim()).filter(Boolean),
        order:       criteria.order ?? 0,
      }, msgEl);

      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    });

    deleteBtn.addEventListener("click", () => deleteCriteria(criteria.id, card));

    card.appendChild(subSection);
    elAdminList.appendChild(card);
  });
}

// ─────────────────────────────────────────────────────────────
// Evaluator: State helpers
// ─────────────────────────────────────────────────────────────
function showState(name) {
  elStateLoading.classList.toggle("hidden", name !== "loading");
  elStateError.classList.toggle("hidden",   name !== "error");
  elStateEmpty.classList.toggle("hidden",   name !== "empty");
  elCriteriaContainer.classList.add("hidden");
  elOverallResult.classList.add("hidden");
}

function showApp() {
  elStateLoading.classList.add("hidden");
  elStateError.classList.add("hidden");
  elStateEmpty.classList.add("hidden");
  elCriteriaContainer.classList.remove("hidden");
  elOverallResult.classList.remove("hidden");
}

// ─────────────────────────────────────────────────────────────
// Evaluator: Scoring
// ─────────────────────────────────────────────────────────────
/**
 * Returns the average score for a criteria.
 *
 * Rules:
 *   - 0 is a valid score and IS included in the average.
 *     e.g. [4, 4, 0] → average = 2.667
 *   - undefined means the row was never initialised (shouldn't happen
 *     after renderEvaluator runs, but treated as incomplete).
 *
 * Return values:
 *   null           — at least one row is undefined (not initialised)
 *   number (0–5)   — straight average of all sub-criteria scores
 */
function averageScore(criteriaId, subCount) {
  if (subCount === 0) return null;
  const rows = scores[criteriaId] || {};
  const values = [];

  for (let i = 0; i < subCount; i++) {
    const v = rows[i];
    if (v === undefined) {
      console.log(`[averageScore] ${criteriaId}[${i}] is undefined — incomplete`);
      return null;   // not yet initialised
    }
    values.push(v);
  }

  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  console.log(`[averageScore] ${criteriaId} scores:`, values, '→ avg:', avg);
  return avg;
}

function updateBadges() {
  let allScored = true;
  let allPass   = true;

  criteriaList.forEach(criteria => {
    const avg   = averageScore(criteria.id, criteria.subCriteria.length);
    const badge = document.querySelector(`[data-badge="${criteria.id}"]`);
    if (!badge) return;

    console.log(`[updateBadges] "${criteria.title}" avg=${avg} threshold=${criteria.threshold}`);

    if (avg === null) {
      // Uninitialised row(s) — treat as incomplete
      allScored = false;
      allPass   = false;
      badge.className   = "badge pending";
      badge.textContent = "–";
    } else {
      // 0 is a valid score; simply compare average to threshold
      const pass = avg >= criteria.threshold;
      if (!pass) allPass = false;
      badge.className   = `badge ${pass ? "pass" : "fail"}`;
      badge.textContent = pass ? "Pass" : "Fail";
    }
  });

  if (criteriaList.length === 0) {
    elOverallBadge.className   = "badge pending";
    elOverallBadge.textContent = "–";
  } else if (!allScored) {
    // null avg means some rows were never initialised (shouldn't normally happen)
    elOverallBadge.className   = "badge pending";
    elOverallBadge.textContent = "–";
  } else {
    elOverallBadge.className   = `badge ${allPass ? "pass" : "fail"}`;
    elOverallBadge.textContent = allPass ? "Pass" : "Fail";
  }
}

// ─────────────────────────────────────────────────────────────
// Evaluator: Circles & Clear
// ─────────────────────────────────────────────────────────────

/**
 * Visual state for a sub-criteria row based on its current score.
 * score 0 = not evaluated (cleared), 1–5 = rated.
 */
function applyRowState(rowEl, score) {
  // Update circles
  rowEl.querySelectorAll(".circle").forEach(c => {
    c.classList.toggle("filled", parseInt(c.dataset.value, 10) <= score);
  });

  // Faded / not-evaluated visual
  const isCleared = score === 0;
  rowEl.classList.toggle("row--cleared", isCleared);

  // "Not evaluated" label
  let label = rowEl.querySelector(".not-eval-label");
  if (isCleared) {
    if (!label) {
      label = document.createElement("span");
      label.className = "not-eval-label";
      label.textContent = "Not evaluated";
      // Insert just before the controls wrapper
      rowEl.querySelector(".row-controls").prepend(label);
    }
  } else {
    if (label) label.remove();
  }
}

function onCircleClick(e) {
  const circle = e.currentTarget;
  const row    = circle.closest(".subcriteria-row");
  const cid    = row.dataset.criteriaId;
  const idx    = parseInt(row.dataset.subIndex, 10);
  const value  = parseInt(circle.dataset.value, 10);

  if (!scores[cid]) scores[cid] = {};
  scores[cid][idx] = value;                      // write BEFORE recalc
  console.log(`[onCircleClick] ${cid}[${idx}] → ${value}`, scores[cid]);
  applyRowState(row, value);
  updateBadges();
}

function onClearClick(e) {
  const btn = e.currentTarget;
  const row = btn.closest(".subcriteria-row");
  const cid = row.dataset.criteriaId;
  const idx = parseInt(row.dataset.subIndex, 10);

  if (!scores[cid]) scores[cid] = {};
  scores[cid][idx] = 0;                          // write BEFORE recalc
  console.log(`[onClearClick] ${cid}[${idx}] → 0`, scores[cid]);
  applyRowState(row, 0);
  updateBadges();
}

// ─────────────────────────────────────────────────────────────
// Evaluator: Render
// ─────────────────────────────────────────────────────────────
function renderEvaluator(criteriaArr) {
  elCriteriaContainer.innerHTML = "";

  criteriaArr.forEach((criteria, cardIndex) => {
    // Default every sub-criterion to 0 (not evaluated)
    scores[criteria.id] = {};
    (criteria.subCriteria || []).forEach((_, i) => { scores[criteria.id][i] = 0; });

    const card = document.createElement("div");
    card.className = "criteria-card";
    card.style.animationDelay = `${cardIndex * 60}ms`;

    // Header
    const header = document.createElement("div");
    header.className = "card-header";

    const titleWrap = document.createElement("div");
    const titleEl   = document.createElement("div");
    titleEl.className   = "card-title";
    titleEl.textContent = criteria.title;
    const threshEl  = document.createElement("div");
    threshEl.className   = "card-threshold";
    threshEl.textContent = `Threshold: ${criteria.threshold}`;
    titleWrap.appendChild(titleEl);
    titleWrap.appendChild(threshEl);

    const badge = document.createElement("span");
    badge.className   = "badge pending";
    badge.textContent = "–";
    badge.dataset.badge = criteria.id;

    header.appendChild(titleWrap);
    header.appendChild(badge);
    card.appendChild(header);

    // Sub-criteria
    const list = document.createElement("div");
    list.className = "subcriteria-list";

    (criteria.subCriteria || []).forEach((sub, subIdx) => {
      const row = document.createElement("div");
      row.className = "subcriteria-row row--cleared"; // start cleared
      row.dataset.criteriaId = criteria.id;
      row.dataset.subIndex   = subIdx;

      const text = document.createElement("span");
      text.className   = "subcriteria-text";
      text.textContent = sub;

      // Controls wrapper (clear btn + not-eval label + circles)
      const controls = document.createElement("div");
      controls.className = "row-controls";

      // Clear button
      const clearBtn = document.createElement("button");
      clearBtn.className = "btn-clear";
      clearBtn.type      = "button";
      clearBtn.title     = "Reset score";
      clearBtn.setAttribute("aria-label", "Reset score to not evaluated");
      clearBtn.innerHTML = `
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>`;
      clearBtn.addEventListener("click", onClearClick);

      // "Not evaluated" label (shown when score = 0)
      const notEvalLabel = document.createElement("span");
      notEvalLabel.className = "not-eval-label";
      notEvalLabel.textContent = "Not evaluated";

      // Circles
      const circles = document.createElement("div");
      circles.className = "score-circles";
      circles.setAttribute("role", "group");
      circles.setAttribute("aria-label", `Score for: ${sub}`);

      for (let v = 1; v <= 5; v++) {
        const circle = document.createElement("button");
        circle.className = "circle";
        circle.type      = "button";
        circle.dataset.value = v;
        circle.setAttribute("aria-label", `Score ${v}`);
        circle.addEventListener("click", onCircleClick);
        circles.appendChild(circle);
      }

      controls.appendChild(clearBtn);
      controls.appendChild(notEvalLabel); // visible when cleared
      controls.appendChild(circles);

      row.appendChild(text);
      row.appendChild(controls);
      list.appendChild(row);
    });

    card.appendChild(list);
    elCriteriaContainer.appendChild(card);
  });
}

// ─────────────────────────────────────────────────────────────
// Event Wiring
// ─────────────────────────────────────────────────────────────

// Login modal
elBtnLogin.addEventListener("click", openLoginModal);
elBtnCloseModal.addEventListener("click", closeLoginModal);
elModalBackdrop.addEventListener("click", closeLoginModal);
elBtnSubmitLogin.addEventListener("click", handleLogin);
elLoginPassword.addEventListener("keydown", e => { if (e.key === "Enter") handleLogin(); });
elLoginEmail.addEventListener("keydown",    e => { if (e.key === "Enter") elLoginPassword.focus(); });

// Logout
elBtnLogout.addEventListener("click", () => signOut(auth));

// Admin drawer
elBtnAdminPanel.addEventListener("click", () => drawerOpen ? closeDrawer() : openDrawer());
elBtnCloseDrawer.addEventListener("click", closeDrawer);
elDrawerBackdrop.addEventListener("click", closeDrawer);

// Close drawer on Escape
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (drawerOpen) closeDrawer();
    if (!elLoginModal.classList.contains("hidden")) closeLoginModal();
  }
});

// Add criteria
elBtnAddCriteria.addEventListener("click", addCriteria);
elNewTitle.addEventListener("keydown",     e => { if (e.key === "Enter") elNewThreshold.focus(); });
elNewThreshold.addEventListener("keydown", e => { if (e.key === "Enter") addCriteria(); });

// ─────────────────────────────────────────────────────────────
// Auth State Observer
// ─────────────────────────────────────────────────────────────
onAuthStateChanged(auth, user => {
  applyAuthUI(user);
});

// ─────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────
loadCriteria();