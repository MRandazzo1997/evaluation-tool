// ─────────────────────────────────────────────────────────────
// Firebase Configuration
// Replace placeholder values with your project credentials.
// ─────────────────────────────────────────────────────────────
import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getFirestore, collection, getDocs, addDoc, updateDoc,
  deleteDoc, doc, getDoc, orderBy, query, setDoc, writeBatch
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
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ─────────────────────────────────────────────────────────────
// App State
// ─────────────────────────────────────────────────────────────
const scores = {};          // scores[criteriaId][subIndex] = { score: 0-5, comment: string }
let criteriaList = [];      // cached from Firestore
let currentUser = null;    // Firebase User | null
let drawerOpen = false;
let drawerResizeCleanup = null;
const DRAWER_WIDTH_KEY = "evalkit-admin-drawer-width";
const DRAWER_MIN_WIDTH = 360;
const DRAWER_MAX_WIDTH = 900;

// ─────────────────────────────────────────────────────────────
// DOM References
// ─────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const elBtnLogin = $("btn-login");
const elBtnLogout = $("btn-logout");
const elBtnAdminPanel = $("btn-admin-panel");
const elBtnDownloadPdf = $("btn-download-pdf");
const elBtnDownloadJson = $("btn-download-json");
const elBtnUploadJson = $("btn-upload-json");
const elJsonFileInput = $("json-file-input");
const elUserInfo = $("user-info");
const elUserEmail = $("user-email");

const elLoginModal = $("login-modal");
const elModalBackdrop = $("modal-backdrop");
const elBtnCloseModal = $("btn-close-modal");
const elBtnSubmitLogin = $("btn-submit-login");
const elLoginEmail = $("login-email");
const elLoginPassword = $("login-password");
const elLoginError = $("login-error");

const elDrawer = $("admin-drawer");
const elDrawerBackdrop = $("drawer-backdrop");
const elBtnCloseDrawer = $("btn-close-drawer");
const elDrawerResizeHandle = $("drawer-resize-handle");

const elNewTitle = $("new-title");
const elNewType = $("new-type");
const elNewThreshold = $("new-threshold");
const elBtnAddCriteria = $("btn-add-criteria");
const elAddError = $("add-error");
const elAdminList = $("admin-list");

const elStateLoading = $("state-loading");
const elStateError = $("state-error");
const elStateEmpty = $("state-empty");
const elErrorMessage = $("error-message");
const elCriteriaContainer = $("criteria-container");
const elOverallResult = $("overall-result");
const elOverallBadge = $("overall-badge");
const elSiteHeader = document.querySelector(".site-header");
const elMainContent = document.querySelector(".main-content");

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
  const email = elLoginEmail.value.trim();
  const password = elLoginPassword.value;

  if (!email || !password) {
    showError(elLoginError, "Inserisci email e password.");
    return;
  }

  elBtnSubmitLogin.disabled = true;
  elBtnSubmitLogin.textContent = "Accesso in corso...";
  hideError(elLoginError);

  try {
    await signInWithEmailAndPassword(auth, email, password);
    closeLoginModal();
  } catch (err) {
    showError(elLoginError, friendlyAuthError(err.code));
  } finally {
    elBtnSubmitLogin.disabled = false;
    elBtnSubmitLogin.textContent = "Accedi";
  }
}

function friendlyAuthError(code) {
  const map = {
    "auth/user-not-found": "Nessun account trovato con questa email.",
    "auth/wrong-password": "Password non corretta.",
    "auth/invalid-email": "Inserisci un indirizzo email valido.",
    "auth/too-many-requests": "Troppi tentativi. Riprova più tardi.",
    "auth/invalid-credential": "Email o password non valide.",
  };
  return map[code] || "Accesso non riuscito. Controlla le credenziali.";
}

// ─────────────────────────────────────────────────────────────
// Admin Drawer
// ─────────────────────────────────────────────────────────────
async function openDrawer() {
  drawerOpen = true;
  applyStoredDrawerWidth();
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
  stopDrawerResize();
  drawerOpen = false;
  elDrawer.classList.add("hidden");
  elDrawer.classList.remove("drawer-open");
  elDrawerBackdrop.classList.add("hidden");
  elBtnAdminPanel.setAttribute("aria-expanded", "false");
}

function clampDrawerWidth(width) {
  const viewportLimit = Math.max(DRAWER_MIN_WIDTH, window.innerWidth - 120);
  return Math.min(Math.max(width, DRAWER_MIN_WIDTH), Math.min(DRAWER_MAX_WIDTH, viewportLimit));
}

function setDrawerWidth(width, persist = true) {
  if (!elDrawer) return;
  const clampedWidth = clampDrawerWidth(width);
  elDrawer.style.width = `${clampedWidth}px`;
  if (persist) {
    localStorage.setItem(DRAWER_WIDTH_KEY, String(clampedWidth));
  }
}

function applyStoredDrawerWidth() {
  if (window.innerWidth <= 540) {
    elDrawer?.style.removeProperty("width");
    return;
  }

  const storedWidth = parseInt(localStorage.getItem(DRAWER_WIDTH_KEY) || "", 10);
  if (!Number.isFinite(storedWidth)) {
    elDrawer?.style.removeProperty("width");
    return;
  }

  setDrawerWidth(storedWidth, false);
}

function stopDrawerResize() {
  if (typeof drawerResizeCleanup === "function") {
    drawerResizeCleanup();
    drawerResizeCleanup = null;
  }
  document.body.classList.remove("drawer-resizing");
}

function startDrawerResize(event) {
  if (!elDrawer || window.innerWidth <= 540) return;

  event.preventDefault();
  document.body.classList.add("drawer-resizing");

  const handlePointerMove = (moveEvent) => {
    const nextWidth = window.innerWidth - moveEvent.clientX;
    setDrawerWidth(nextWidth);
  };

  const handlePointerUp = () => {
    stopDrawerResize();
  };

  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp, { once: true });

  drawerResizeCleanup = () => {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  };
}

// ─────────────────────────────────────────────────────────────
// Firestore: Load
// ─────────────────────────────────────────────────────────────
async function loadCriteria() {
  showState("loading");

  try {
    const q = query(collection(db, "criteria"), orderBy("order"));
    const snapshot = await getDocs(q);

    criteriaList = snapshot.docs.map(d => {
      const data = d.data();
      const type = data.type || "normal";

      let normalizedSubCriteria = [];
      if (type === "normal") {
        const rawSubCriteria = data.subCriteria || [];
        normalizedSubCriteria = rawSubCriteria.map(sub => {
          if (typeof sub === 'string') {
            return { text: sub, minThreshold: 0 };
          }
          return {
            text: sub.text || '',
            minThreshold: sub.minThreshold ?? 0,
          };
        });
      }

      return {
        id: d.id,
        ...data,
        type,
        subCriteria: normalizedSubCriteria,
      };
    });

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
    elErrorMessage.textContent = `Caricamento criteri non riuscito: ${err.message}`;
    showState("error");
  }
}

// ─────────────────────────────────────────────────────────────
// Firestore: Settings
// ─────────────────────────────────────────────────────────────

// Global settings have been removed. Per-sub-criteria thresholds are now
// stored directly with each sub-criteria in the criteria document.

async function addCriteria() {
  const title = elNewTitle.value.trim();
  const type = elNewType.value; // "normal" or "yesno"
  const threshold = parseFloat(elNewThreshold.value);

  hideError(elAddError);

  if (!title) {
    showError(elAddError, "Inserisci un titolo.");
    return;
  }

  // For "normal" type, threshold is required. For "yesno", it's ignored.
  if (type === "normal") {
    if (isNaN(threshold) || threshold < 0 || threshold > 5) {
      showError(elAddError, "La soglia deve essere un numero tra 0 e 5.");
      return;
    }
  }

  elBtnAddCriteria.disabled = true;
  elBtnAddCriteria.textContent = "Aggiunta...";

  try {
    const newOrder = criteriaList.length > 0
      ? Math.max(...criteriaList.map(c => c.order ?? 0)) + 1
      : 0;

    const newCriteria = {
      title,
      type: type || "normal",
      threshold: type === "normal" ? threshold : 0,
      order: newOrder,
    };

    // Only include subCriteria for normal criteria
    if (type === "normal") {
      newCriteria.subCriteria = [];
    }

    await addDoc(collection(db, "criteria"), newCriteria);

    elNewTitle.value = "";
    elNewType.value = "normal";
    elNewThreshold.value = "";
    await loadCriteria();
  } catch (err) {
    showError(elAddError, `Aggiunta non riuscita: ${err.message}`);
  } finally {
    elBtnAddCriteria.disabled = false;
    elBtnAddCriteria.textContent = "Aggiungi Criterio";
    // restore button icon
    elBtnAddCriteria.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Aggiungi Criterio`;
  }
}

// ─────────────────────────────────────────────────────────────
// Firestore: Update
// ─────────────────────────────────────────────────────────────
async function saveCriteria(id, data, msgEl) {
  try {
    await updateDoc(doc(db, "criteria", id), data);
    showInlineMsg(msgEl, "Salvato", "ok");
    await loadCriteria();
  } catch (err) {
    showInlineMsg(msgEl, "Errore: " + err.message, "err");
  }
}

// ─────────────────────────────────────────────────────────────
// Firestore: Delete
// ─────────────────────────────────────────────────────────────
async function deleteCriteria(id, cardEl) {
  if (!confirm("Eliminare questo criterio? L'azione non può essere annullata.")) return;
  try {
    cardEl.style.opacity = "0.4";
    cardEl.style.pointerEvents = "none";
    await deleteDoc(doc(db, "criteria", id));
    await loadCriteria();
  } catch (err) {
    alert("Eliminazione non riuscita: " + err.message);
    cardEl.style.opacity = "";
    cardEl.style.pointerEvents = "";
  }
}

// ─────────────────────────────────────────────────────────────
// Admin Panel Render
// ─────────────────────────────────────────────────────────────
function showInlineMsg(el, text, type) {
  el.textContent = text;
  el.className = `inline-msg ${type}`;
  el.classList.remove("hidden");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add("hidden"), 2500);
}

function renderAdminList() {
  elAdminList.innerHTML = "";

  if (criteriaList.length === 0) {
    elAdminList.innerHTML = '<div class="admin-empty">Nessun criterio presente. Aggiungine uno qui sopra.</div>';
    return;
  }

  criteriaList.forEach(criteria => {
    const type = criteria.type || "normal";
    const card = document.createElement("div");
    card.className = "admin-card";
    card.dataset.criteriaId = criteria.id;
    card.dataset.dragId = criteria.id;

    // ── Card Header (title + threshold + save/delete) ──────
    const headerEl = document.createElement("div");
    headerEl.className = "admin-card-header";
    const topRow = document.createElement("div");
    topRow.className = "admin-card-top-row";

    const dragHandle = document.createElement("button");
    dragHandle.className = "drag-handle";
    dragHandle.type = "button";
    dragHandle.draggable = true;
    dragHandle.title = "Trascina per riordinare il criterio";
    dragHandle.setAttribute("aria-label", "Riordina criterio");
    dragHandle.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="9" y1="6" x2="9.01" y2="6"></line>
        <line x1="9" y1="12" x2="9.01" y2="12"></line>
        <line x1="9" y1="18" x2="9.01" y2="18"></line>
        <line x1="15" y1="6" x2="15.01" y2="6"></line>
        <line x1="15" y1="12" x2="15.01" y2="12"></line>
        <line x1="15" y1="18" x2="15.01" y2="18"></line>
      </svg>
      Trascina per riordinare`;
    topRow.appendChild(dragHandle);
    headerEl.appendChild(topRow);

    const fieldsRow = document.createElement("div");
    fieldsRow.className = "admin-card-fields";

    // Type field group
    const typeGroup = document.createElement("div");
    typeGroup.className = "form-field-group";
    const typeLabel = document.createElement("label");
    typeLabel.className = "field-label";
    typeLabel.textContent = "Tipo";

    const typeSelect = document.createElement("select");
    typeSelect.className = "field";
    typeSelect.value = type;
    typeSelect.innerHTML = `
      <option value="normal">Normale</option>
      <option value="yesno">Sì/No</option>
    `;

    typeGroup.appendChild(typeLabel);
    typeGroup.appendChild(typeSelect);

    // Title field group
    const titleGroup = document.createElement("div");
    titleGroup.className = "form-field-group";
    const titleLabel = document.createElement("label");
    titleLabel.className = "field-label";
    titleLabel.textContent = "Titolo";

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "field";
    titleInput.value = criteria.title;
    titleInput.placeholder = "Titolo criterio";

    titleGroup.appendChild(titleLabel);
    titleGroup.appendChild(titleInput);

    // Threshold field group
    const threshGroup = document.createElement("div");
    threshGroup.className = "form-field-group";
    const threshLabel = document.createElement("label");
    threshLabel.className = "field-label";
    threshLabel.textContent = "Soglia (1-5)";

    const threshInput = document.createElement("input");
    threshInput.type = "number";
    threshInput.className = "field";
    threshInput.value = criteria.threshold;
    threshInput.placeholder = "Soglia";
    threshInput.step = "0.1";
    threshInput.min = "0";
    threshInput.max = "5";
    if (type === "yesno") threshGroup.style.display = "none";

    threshGroup.appendChild(threshLabel);
    threshGroup.appendChild(threshInput);

    // Update threshold visibility when type changes
    typeSelect.addEventListener("change", (e) => {
      const selectedType = e.target.value;
      threshGroup.style.display = selectedType === "yesno" ? "none" : "";
      // Show/hide sub-section
      if (subSection) {
        subSection.style.display = selectedType === "yesno" ? "none" : "";
      }
    });

    fieldsRow.appendChild(typeGroup);
    fieldsRow.appendChild(titleGroup);
    fieldsRow.appendChild(threshGroup);

    const actionsRow = document.createElement("div");
    actionsRow.className = "admin-card-actions";

    const saveRow = document.createElement("div");
    saveRow.className = "admin-save-row";

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn-primary btn-save";
    saveBtn.textContent = "Salva";

    const msgEl = document.createElement("span");
    msgEl.className = "inline-msg hidden";

    saveRow.appendChild(saveBtn);
    saveRow.appendChild(msgEl);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-delete";
    deleteBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      Elimina`;

    actionsRow.appendChild(saveRow);
    actionsRow.appendChild(deleteBtn);

    headerEl.appendChild(fieldsRow);
    headerEl.appendChild(actionsRow);
    card.appendChild(headerEl);

    // ── Sub-criteria section ───────────────────────────────
    const subSection = document.createElement("div");
    subSection.className = "admin-sub-section";
    if (type === "yesno") subSection.style.display = "none";

    const subLabel = document.createElement("div");
    subLabel.className = "sub-section-label";
    subLabel.textContent = "Sotto-criteri";

    const subList = document.createElement("div");
    subList.className = "admin-sub-list";

    // local copy of sub-criteria to manipulate before saving
    // Normalize old format (strings) to new format (objects with thresholds)
    let localSubs = (criteria.subCriteria || []).map(sub => {
      if (typeof sub === 'string') {
        return { text: sub, minThreshold: 0 };
      }
      return {
        text: sub.text || '',
        minThreshold: sub.minThreshold ?? 0,
      };
    });

    function rebuildSubRows() {
      subList.innerHTML = "";
      localSubs.forEach((sub, idx) => {
        const row = document.createElement("div");
        row.className = "admin-sub-row";
        row.dataset.dragId = `${criteria.id}-${idx}`;

        const subDragHandle = document.createElement("button");
        subDragHandle.className = "drag-handle drag-handle--sub";
        subDragHandle.type = "button";
        subDragHandle.draggable = true;
        subDragHandle.title = "Trascina per riordinare il sotto-criterio";
        subDragHandle.setAttribute("aria-label", `Riordina sotto-criterio ${idx + 1}`);
        subDragHandle.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="9" y1="6" x2="9.01" y2="6"></line>
            <line x1="9" y1="12" x2="9.01" y2="12"></line>
            <line x1="9" y1="18" x2="9.01" y2="18"></line>
            <line x1="15" y1="6" x2="15.01" y2="6"></line>
            <line x1="15" y1="12" x2="15.01" y2="12"></line>
            <line x1="15" y1="18" x2="15.01" y2="18"></line>
          </svg>`;

        // Text input for the sub-criterion
        const input = document.createElement("input");
        input.type = "text";
        input.className = "field";
        input.value = sub.text;
        input.placeholder = `Sotto-criterio ${idx + 1}`;
        input.addEventListener("input", () => { localSubs[idx].text = input.value; });

        // Minimum threshold input
        const minThreshInput = document.createElement("input");
        minThreshInput.type = "number";
        minThreshInput.className = "field field--sm";
        minThreshInput.value = sub.minThreshold;
        minThreshInput.placeholder = "Min";
        minThreshInput.step = "0.1";
        minThreshInput.min = "0";
        minThreshInput.max = "5";
        minThreshInput.title = "Soglia minima per questo sotto-criterio";
        minThreshInput.addEventListener("input", () => {
          localSubs[idx].minThreshold = parseFloat(minThreshInput.value) || 0;
        });

        const removeBtn = document.createElement("button");
        removeBtn.className = "btn-remove-sub";
        removeBtn.type = "button";
        removeBtn.title = "Rimuovi";
        removeBtn.innerHTML = "×";
        removeBtn.addEventListener("click", () => {
          localSubs.splice(idx, 1);
          rebuildSubRows();
        });

        row.appendChild(subDragHandle);
        row.appendChild(input);
        row.appendChild(minThreshInput);
        row.appendChild(removeBtn);
        subList.appendChild(row);
      });
    }

    rebuildSubRows();

    setupSortable(subList, ".admin-sub-row", async () => {
      const rows = [...subList.querySelectorAll(".admin-sub-row")];
      const orderedIds = rows.map(row => row.dataset.dragId);
      const currentIds = localSubs.map((_, idx) => `${criteria.id}-${idx}`);

      if (orderedIds.join("|") === currentIds.join("|")) return;

      const updatedSubs = [];
      rows.forEach(row => {
        const inputs = row.querySelectorAll("input");
        const textInput = inputs[0];
        const minInput = inputs[1];
        if (textInput && textInput.value.trim()) {
          updatedSubs.push({
            text: textInput.value.trim(),
            minThreshold: parseFloat(minInput?.value) || 0,
          });
        }
      });
      localSubs = updatedSubs;
      rebuildSubRows();
      showInlineMsg(msgEl, "Ordine sotto-criteri aggiornato. Premi Salva", "ok");
    });

    const addSubBtn = document.createElement("button");
    addSubBtn.className = "btn-add-sub";
    addSubBtn.type = "button";
    addSubBtn.innerHTML = `
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Aggiungi Sotto-criterio`;
    addSubBtn.addEventListener("click", () => {
      localSubs.push({ text: "", minThreshold: 0 });
      rebuildSubRows();
      // focus new input
      const inputs = subList.querySelectorAll("input[type='text']");
      if (inputs.length) inputs[inputs.length - 1].focus();
    });

    subSection.appendChild(subLabel);
    subSection.appendChild(subList);
    subSection.appendChild(addSubBtn);
    card.appendChild(subSection);

    // ── Wire save / delete ─────────────────────────────────
    saveBtn.addEventListener("click", async () => {
      const newTitle = titleInput.value.trim();
      const newType = typeSelect.value;
      const newThresh = parseFloat(threshInput.value);

      if (!newTitle) { showInlineMsg(msgEl, "Il titolo è obbligatorio", "err"); return; }

      // Validate threshold only for normal criteria
      if (newType === "normal") {
        if (isNaN(newThresh) || newThresh < 0 || newThresh > 5) {
          showInlineMsg(msgEl, "La soglia deve essere tra 0 e 5", "err"); return;
        }
      }

      saveBtn.disabled = true;
      saveBtn.textContent = "Salvataggio...";

      let dataToSave = {
        title: newTitle,
        type: newType,
        order: criteria.order ?? 0,
      };

      if (newType === "normal") {
        // Filter out empty sub-criteria and ensure they have the proper structure
        const filteredSubs = localSubs
          .filter(sub => sub.text && sub.text.trim())
          .map(sub => ({
            text: sub.text.trim(),
            minThreshold: Math.max(0, Math.min(5, parseFloat(sub.minThreshold) || 0)),
          }));

        dataToSave.threshold = newThresh;
        dataToSave.subCriteria = filteredSubs;
      } else {
        // For yesno criteria
        dataToSave.threshold = 0;
        // Don't set subCriteria or set it to undefined
      }

      await saveCriteria(criteria.id, dataToSave, msgEl);

      saveBtn.disabled = false;
      saveBtn.textContent = "Salva";
    });

    deleteBtn.addEventListener("click", () => deleteCriteria(criteria.id, card));
    elAdminList.appendChild(card);
  });

  setupSortable(elAdminList, ".admin-card", async () => {
    const orderedIds = [...elAdminList.querySelectorAll(".admin-card")]
      .map(card => card.dataset.criteriaId)
      .filter(Boolean);

    const currentOrder = criteriaList.map(criteria => criteria.id);
    if (orderedIds.join("|") === currentOrder.join("|")) return;

    const byId = new Map(criteriaList.map(criteria => [criteria.id, criteria]));
    criteriaList = orderedIds.map(id => byId.get(id)).filter(Boolean);

    try {
      await persistCriteriaOrder();
      renderEvaluator(criteriaList);
      updateBadges();
    } catch (err) {
      alert("Riordino criteri non riuscito: " + err.message);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Evaluator: State helpers
// ─────────────────────────────────────────────────────────────
function showState(name) {
  elStateLoading.classList.toggle("hidden", name !== "loading");
  elStateError.classList.toggle("hidden", name !== "error");
  elStateEmpty.classList.toggle("hidden", name !== "empty");
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
    const entry = rows[i];
    if (entry === undefined) {
      console.log(`[averageScore] ${criteriaId}[${i}] is undefined — incomplete`);
      return null;   // not yet initialised
    }
    values.push(entry.score ?? 0);
  }

  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  console.log(`[averageScore] ${criteriaId} scores:`, values, '→ avg:', avg);
  return avg;
}

function ensureScoreEntry(criteriaId, subIndex) {
  if (!scores[criteriaId]) scores[criteriaId] = {};
  if (!scores[criteriaId][subIndex]) {
    scores[criteriaId][subIndex] = { score: 0, comment: "" };
  }
  return scores[criteriaId][subIndex];
}

function isCommentRequired() {
  return false;
}

function checkMissingComments() {
  return false;
}

function updateCommentState(rowEl, entry) {
  const textarea = rowEl.querySelector(".subcriteria-comment");

  if (!textarea) return;

  textarea.required = false;
}

/**
 * Adds or removes the "below-min" and "below-warning" CSS classes
 * on each rendered sub-criteria row for a given criteria.
 *
 *  row--below-min     : score is 1–(minThreshold-1) → forced FAIL indicator
 *
 * Score 0 (not evaluated) is excluded from this indicator.
 */
function updateRowMinIndicators(criteriaId, subCount) {
  const criteria = criteriaList.find(c => c.id === criteriaId);
  if (!criteria) return;

  const rows = scores[criteriaId] || {};
  for (let i = 0; i < subCount; i++) {
    const rowEl = document.querySelector(
      `.subcriteria-row[data-criteria-id="${criteriaId}"][data-sub-index="${i}"]`
    );
    if (!rowEl) continue;

    const entry = rows[i] || { score: 0, comment: "" };
    const sub = criteria.subCriteria[i];
    const minThreshold = typeof sub === 'object' ? (sub.minThreshold ?? 0) : 0;
    const v = entry.score ?? 0;

    const belowMin = minThreshold > 0 && v > 0 && v < minThreshold;

    rowEl.classList.toggle("row--below-min", belowMin);
    updateCommentState(rowEl, entry);
  }
}

function updateBadges() {
  let allScored = true;
  let anyCriterionFailed = false;

  criteriaList.forEach(criteria => {
    const type = criteria.type || "normal";
    const badge = document.querySelector(`[data-badge="${criteria.id}"]`);
    if (!badge) return;

    let pass = false;

    if (type === "normal") {
      const avg = averageScore(criteria.id, criteria.subCriteria.length);
      console.log(`[updateBadges] "${criteria.title}" avg=${avg} threshold=${criteria.threshold}`);

      if (avg === null) {
        allScored = false;
        badge.className = "badge pending";
        badge.textContent = "–";
        return;
      }

      // Step 1: fail immediately if any sub-criteria is below its per-sub-criteria minimum.
      const rows = scores[criteria.id] || {};
      const anyBelowMin = (criteria.subCriteria || []).some((sub, idx) => {
        const minThreshold = typeof sub === 'object' ? (sub.minThreshold ?? 0) : 0;
        const value = rows[idx]?.score ?? 0;
        return minThreshold > 0 && value > 0 && value < minThreshold;
      });

      // Step 2: compare average to the criteria threshold.
      pass = !anyBelowMin && avg >= criteria.threshold;

      // Update per-row visual indicator for scores below the per-sub-criteria minimum
      updateRowMinIndicators(criteria.id, criteria.subCriteria.length);
    } else if (type === "yesno") {
      const entry = scores[criteria.id];
      if (entry?.answer === null || entry?.answer === undefined) {
        allScored = false;
        badge.className = "badge pending";
        badge.textContent = "–";
        return;
      }
      pass = entry.answer === true;
      console.log(`[updateBadges] "${criteria.title}" yesno answer=${entry.answer} pass=${pass}`);
    }

    if (!pass) anyCriterionFailed = true;
    badge.className = `badge ${pass ? "pass" : "fail"}`;
    badge.textContent = pass ? "Superato" : "Non Superato";
  });

  if (criteriaList.length === 0) {
    elOverallBadge.className = "badge pending";
    elOverallBadge.textContent = "–";
  } else if (!allScored) {
    elOverallBadge.className = "badge pending";
    elOverallBadge.textContent = "–";
  } else {
    const overallPass = !anyCriterionFailed;
    elOverallBadge.className = `badge ${overallPass ? "pass" : "fail"}`;
    elOverallBadge.textContent = overallPass ? "Superato" : "Non Superato";
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
      label.textContent = "Non valutato";
      // Insert just before the controls wrapper
      rowEl.querySelector(".row-controls").prepend(label);
    }
  } else {
    if (label) label.remove();
  }

  const cid = rowEl.dataset.criteriaId;
  const idx = parseInt(rowEl.dataset.subIndex, 10);
  updateCommentState(rowEl, ensureScoreEntry(cid, idx));
}

function onCircleClick(e) {
  const circle = e.currentTarget;
  const row = circle.closest(".subcriteria-row");
  const cid = row.dataset.criteriaId;
  const idx = parseInt(row.dataset.subIndex, 10);
  const value = parseInt(circle.dataset.value, 10);

  const entry = ensureScoreEntry(cid, idx);
  entry.score = value;                           // write BEFORE recalc
  console.log(`[onCircleClick] ${cid}[${idx}] → ${value}`, scores[cid]);
  applyRowState(row, value);
  updateBadges();
}

function onClearClick(e) {
  const btn = e.currentTarget;
  const row = btn.closest(".subcriteria-row");
  const cid = row.dataset.criteriaId;
  const idx = parseInt(row.dataset.subIndex, 10);

  const entry = ensureScoreEntry(cid, idx);
  entry.score = 0;                               // write BEFORE recalc
  console.log(`[onClearClick] ${cid}[${idx}] → 0`, scores[cid]);
  applyRowState(row, 0);
  updateBadges();
}

function onCommentInput(e) {
  const textarea = e.currentTarget;
  const row = textarea.closest(".subcriteria-row");
  const cid = row.dataset.criteriaId;
  const idx = parseInt(row.dataset.subIndex, 10);

  const entry = ensureScoreEntry(cid, idx);
  entry.comment = textarea.value;

  updateCommentState(row, entry);
  updateBadges();
}

function onYesNoClick(e) {
  const btn = e.currentTarget;
  const cid = btn.dataset.criteriaId;
  const answer = btn.dataset.answer === 'true';

  if (!scores[cid]) {
    scores[cid] = { answer: null };
  }
  scores[cid].answer = answer;

  console.log(`[onYesNoClick] ${cid} → ${answer}`, scores[cid]);

  // Update button states
  const card = btn.closest(".criteria-card");
  const yesBtn = card.querySelector('[data-answer="true"]');
  const noBtn = card.querySelector('[data-answer="false"]');

  yesBtn.classList.toggle("active", answer === true);
  noBtn.classList.toggle("active", answer === false);

  updateBadges();
}

async function downloadPdf() {
  const jsPdfCtor = window.jspdf?.jsPDF;

  if (!jsPdfCtor) {
    alert("Generazione PDF non disponibile.");
    return;
  }

  const originalLabel = elBtnDownloadPdf.innerHTML;
  elBtnDownloadPdf.disabled = true;
  elBtnDownloadPdf.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
    Generazione PDF...`;

  try {
    buildEvaluationPdf(jsPdfCtor);
  } catch (err) {
    console.error("PDF generation error:", err);
    alert("Generazione PDF non riuscita.");
  } finally {
    elBtnDownloadPdf.disabled = false;
    elBtnDownloadPdf.innerHTML = originalLabel;
  }
}

function getEvaluationState() {
  const normalizedScores = {};

  Object.keys(scores).forEach(criteriaId => {
    const data = scores[criteriaId];
    if (!data || typeof data !== "object") return;

    if (data.answer !== undefined) {
      normalizedScores[criteriaId] = { answer: data.answer };
      return;
    }

    const rowKeys = Object.keys(data)
      .filter(key => String(Number(key)) === key)
      .sort((a, b) => Number(a) - Number(b));

    normalizedScores[criteriaId] = rowKeys.map(key => {
      const entry = data[key];
      return {
        score: Number(entry.score) || 0,
        comment: typeof entry.comment === "string" ? entry.comment : "",
      };
    });
  });

  return {
    source: "evalkit",
    version: 1,
    exportedAt: new Date().toISOString(),
    scores: normalizedScores,
  };
}

function downloadJsonState() {
  const blob = new Blob([JSON.stringify(getEvaluationState(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "valutazione-stato.json";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function normalizeYesNoAnswer(value) {
  if (value === true || value === false) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function extractScoreEntries(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];

  const numericKeys = Object.keys(data)
    .filter(key => String(Number(key)) === key)
    .sort((a, b) => Number(a) - Number(b));

  return numericKeys.map(key => data[key]);
}

function restoreEvaluationState(state) {
  if (!state || typeof state !== "object" || !state.scores || typeof state.scores !== "object") {
    throw new Error("File JSON non valido");
  }

  const importedScores = state.scores;

  Object.keys(importedScores).forEach(criteriaId => {
    const criteria = criteriaList.find(c => c.id === criteriaId);
    if (!criteria) return;

    const data = importedScores[criteriaId];

    if (criteria.type === "yesno") {
      const answer = normalizeYesNoAnswer(data?.answer);
      scores[criteriaId] = { answer };
      return;
    }

    const entries = extractScoreEntries(data);
    if (!entries.length) return;

    scores[criteriaId] = {};
    entries.forEach((entry, index) => {
      if (typeof entry !== "object" || entry === null) return;
      const score = Number(entry.score);
      const comment = typeof entry.comment === "string" ? entry.comment : "";
      if (!Number.isFinite(score) || score < 0 || score > 5) return;
      scores[criteriaId][index] = { score, comment };
    });
  });

  renderEvaluator(criteriaList);
  updateBadges();
}

function handleJsonFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      restoreEvaluationState(data);
      alert("Valutazione ripristinata correttamente.");
    } catch (err) {
      console.error("Import JSON error:", err);
      alert("Impossibile importare il file JSON. Controlla che sia un file valido.");
    }
  };
  reader.onerror = () => {
    alert("Errore nella lettura del file JSON.");
  };
  reader.readAsText(file);
}

function openJsonFilePicker() {
  if (!elJsonFileInput) return;
  elJsonFileInput.value = "";
  elJsonFileInput.click();
}

function buildEvaluationPdf(jsPdfCtor) {
  const pdf = new jsPdfCtor({
    orientation: "p",
    unit: "pt",
    format: "a4",
    compress: true,
    putOnlyUsedFonts: true,
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const marginX = 42;
  const topMargin = 46;
  const bottomMargin = 42;
  const contentWidth = pageWidth - (marginX * 2) - 12;
  const bottomY = pageHeight - bottomMargin;
  const lineGap = 5;
  const sectionGap = 18;
  let y = topMargin;

  const ensureSpace = (heightNeeded, repeatHeader) => {
    if (y + heightNeeded <= bottomY) return;
    pdf.addPage();
    y = topMargin;
    if (typeof repeatHeader === "function") {
      y = repeatHeader(y);
    }
  };

  const drawWrappedText = (text, x, startY, maxWidth, options = {}) => {
    const value = String(text ?? "");
    const lines = pdf.splitTextToSize(value, maxWidth);
    const fontSize = options.fontSize ?? 11;
    const lineHeight = options.lineHeight ?? (fontSize * 1.35);

    pdf.setFont(options.font || "helvetica", options.fontStyle || "normal");
    pdf.setFontSize(fontSize);
    pdf.setTextColor(...(options.color || [26, 25, 23]));
    pdf.text(lines, x, startY);

    return {
      lines,
      height: Math.max(lineHeight, lines.length * lineHeight),
      lineHeight,
    };
  };

  const measureWrappedText = (text, maxWidth, options = {}) => {
    const value = String(text ?? "");
    const lines = pdf.splitTextToSize(value, maxWidth);
    const fontSize = options.fontSize ?? 11;
    const lineHeight = options.lineHeight ?? (fontSize * 1.35);
    return {
      lines,
      height: Math.max(lineHeight, lines.length * lineHeight),
      lineHeight,
    };
  };

  const drawDivider = (posY) => {
    pdf.setDrawColor(226, 224, 218);
    pdf.setLineWidth(1);
    pdf.line(marginX, posY, pageWidth - marginX, posY);
  };

  const overallSummary = getPdfOverallSummary();

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  pdf.setTextColor(26, 25, 23);
  pdf.text("Valutazione", marginX, y);
  y += 24;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(112, 110, 104);
  pdf.text(`Generato il ${new Date().toLocaleString("it-IT")}`, marginX, y);
  y += 20;

  const overallText = `Risultato complessivo: ${overallSummary.label}`;
  const overallMeta = overallSummary.hasMissingComments
    ? "Sono presenti commenti obbligatori mancanti."
    : "Tutti i criteri sono stati elaborati correttamente.";

  const overallBlockHeight =
    measureWrappedText(overallText, contentWidth, { fontSize: 13, lineHeight: 17 }).height +
    measureWrappedText(overallMeta, contentWidth, { fontSize: 10, lineHeight: 14 }).height +
    18;

  ensureSpace(overallBlockHeight);
  drawWrappedText(overallText, marginX, y, contentWidth, {
    fontSize: 13,
    lineHeight: 17,
    fontStyle: "bold",
    color: overallSummary.pass ? [26, 122, 74] : [179, 45, 45],
  });
  y += 18;
  drawWrappedText(overallMeta, marginX, y, contentWidth, {
    fontSize: 10,
    lineHeight: 14,
    color: [112, 110, 104],
  });
  y += 22;
  drawDivider(y);
  y += sectionGap;

  criteriaList.forEach((criteria, criteriaIndex) => {
    const type = criteria.type || "normal";
    const criterionSummary = getPdfCriterionSummary(criteria);
    const headerHeight = getPdfCriterionHeaderHeight(pdf, criteria, criterionSummary, contentWidth);

    if (type === "normal") {
      const firstRow = (criteria.subCriteria || [])[0];
      const firstRowHeight = firstRow
        ? getPdfRowHeight(pdf, criteria, 0, firstRow, contentWidth)
        : 0;

      ensureSpace(headerHeight + firstRowHeight + 8);
      y = drawPdfCriterionHeader(pdf, criteria, criterionSummary, marginX, y, contentWidth);

      (criteria.subCriteria || []).forEach((sub, subIdx) => {
        const rowHeight = getPdfRowHeight(pdf, criteria, subIdx, sub, contentWidth);
        ensureSpace(rowHeight + 6, (nextY) =>
          drawPdfCriterionContinuationHeader(pdf, criteria, marginX, nextY, contentWidth)
        );
        y = drawPdfSubCriteriaRow(pdf, criteria, subIdx, sub, marginX, y, contentWidth);
      });
    } else if (type === "yesno") {
      ensureSpace(headerHeight + 40);
      y = drawPdfCriterionHeader(pdf, criteria, criterionSummary, marginX, y, contentWidth);

      const entry = scores[criteria.id];
      const answer = entry?.answer;
      const answerText = answer === true ? "Sì" : (answer === false ? "No" : "Non risposto");
      const answerColor = answer === true ? [26, 122, 74] : (answer === false ? [179, 45, 45] : [112, 110, 104]);

      y += 8;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      pdf.setTextColor(...answerColor);
      pdf.text(`Risposta: ${answerText}`, marginX + 12, y);
      y += 16;
    }

    if (criteriaIndex < criteriaList.length - 1) {
      y += 4;
      drawDivider(y);
      y += sectionGap;
    }
  });

  pdf.save("valutazione.pdf");
}

function getPdfCriterionSummary(criteria) {
  const type = criteria.type || "normal";

  if (type === "yesno") {
    const entry = scores[criteria.id];
    const answer = entry?.answer;
    const pass = answer === true;
    return {
      answer,
      pass,
      label: answer === null || answer === undefined ? "In sospeso" : (pass ? "Sì" : "No"),
    };
  }

  // Normal criteria
  const avg = averageScore(criteria.id, criteria.subCriteria.length);
  const rows = scores[criteria.id] || {};
  const anyBelowMin = (criteria.subCriteria || []).some((sub, idx) => {
    const minThreshold = typeof sub === 'object' ? (sub.minThreshold ?? 0) : 0;
    const value = rows[idx]?.score ?? 0;
    return minThreshold > 0 && value > 0 && value < minThreshold;
  });
  const pass = avg !== null && !anyBelowMin && avg >= criteria.threshold;

  return {
    avg,
    pass,
    anyBelowMin,
    label: avg === null ? "In sospeso" : (pass ? "Superato" : "Non Superato"),
  };
}


function getPdfOverallSummary() {
  if (criteriaList.length === 0) {
    return { label: "In sospeso", pass: false, hasMissingComments: false };
  }

  const summaries = criteriaList.map(getPdfCriterionSummary);

  // Check if any criteria is pending
  const hasPending = summaries.some(summary => {
    const type = summary.avg === undefined ? "yesno" : "normal";
    if (type === "yesno") {
      return summary.answer === null || summary.answer === undefined;
    }
    return summary.avg === null;
  });

  // Check if any criteria failed
  const hasFailure = summaries.some(summary => !summary.pass);

  if (hasPending) {
    return { label: "In sospeso", pass: false, hasMissingComments: false };
  }

  return {
    label: hasFailure ? "Non Superato" : "Superato",
    pass: !hasFailure,
    hasMissingComments: false,
  };
}


function getPdfCriterionHeaderHeight(pdf, criteria, summary, width) {
  const titleHeight = measurePdfTextHeight(pdf, criteria.title, width, 15, 18, "bold");
  const metaText = `Soglia: ${criteria.threshold}    Media: ${formatPdfAverage(summary.avg)}    Stato: ${summary.label}`;
  const metaHeight = measurePdfTextHeight(pdf, metaText, width, 10, 14);
  const noteHeight = summary.anyBelowMin
    ? measurePdfTextHeight(
      pdf,
      "Almeno un sotto-criterio non ha raggiunto il minimo richiesto.",
      width,
      9,
      13
    )
    : 0;
  return titleHeight + metaHeight + noteHeight + 18;
}

function drawPdfCriterionHeader(pdf, criteria, summary, x, startY, width) {
  drawWrappedPdfText(pdf, criteria.title, x, startY, width, {
    fontSize: 15,
    lineHeight: 18,
    fontStyle: "bold",
  });
  let y = startY + measurePdfTextHeight(pdf, criteria.title, width, 15, 18, "bold");

  const metaText = `Soglia: ${criteria.threshold}    Media: ${formatPdfAverage(summary.avg)}    Stato: ${summary.label}`;
  drawWrappedPdfText(pdf, metaText, x, y, width, {
    fontSize: 10,
    lineHeight: 14,
    color: [112, 110, 104],
  });
  y += measurePdfTextHeight(pdf, metaText, width, 10, 14);

  if (summary.anyBelowMin) {
    const noteText = "Almeno un sotto-criterio non ha raggiunto il minimo richiesto.";
    drawWrappedPdfText(pdf, noteText, x, y, width, {
      fontSize: 9,
      lineHeight: 13,
      color: [179, 45, 45],
    });
    y += measurePdfTextHeight(pdf, noteText, width, 9, 13);
  }

  return y + 10;
}

function drawPdfCriterionContinuationHeader(pdf, criteria, x, startY, width) {
  const label = `${criteria.title} (continua)`;
  drawWrappedPdfText(pdf, label, x, startY, width, {
    fontSize: 11,
    lineHeight: 14,
    fontStyle: "bold",
    color: [112, 110, 104],
  });
  return startY + measurePdfTextHeight(pdf, label, width, 11, 14, "bold") + 8;
}

function getPdfRowHeight(pdf, criteria, subIdx, sub, width) {
  const entry = ensureScoreEntry(criteria.id, subIdx);
  const noteLines = getPdfRowNotes(entry.score, criteria, subIdx);
  const subLabel = typeof sub === 'object' ? sub.text : String(sub);
  const titleHeight = measurePdfTextHeight(pdf, `${subIdx + 1}. ${subLabel}`, width, 11, 15, "bold");
  const scoreHeight = measurePdfTextHeight(pdf, getPdfScoreLabel(entry.score), width, 10, 13);
  const notesHeight = noteLines.length
    ? measurePdfTextHeight(pdf, noteLines.join("  |  "), width, 9, 12)
    : 0;
  const commentTitleHeight = 12;
  const commentHeight = measurePdfTextHeight(
    pdf,
    getPdfCommentLabel(entry.comment),
    width,
    10,
    14,
    entry.comment.trim() ? "normal" : "italic"
  );

  return titleHeight + scoreHeight + notesHeight + commentTitleHeight + commentHeight + 18;
}

function drawPdfSubCriteriaRow(pdf, criteria, subIdx, sub, x, startY, width) {
  const entry = ensureScoreEntry(criteria.id, subIdx);
  let y = startY;
  const subLabel = typeof sub === 'object' ? sub.text : String(sub);

  const title = `${subIdx + 1}. ${subLabel}`;
  drawWrappedPdfText(pdf, title, x, y, width, {
    fontSize: 11,
    lineHeight: 15,
    fontStyle: "bold",
  });
  y += measurePdfTextHeight(pdf, title, width, 11, 15, "bold");

  drawWrappedPdfText(pdf, getPdfScoreLabel(entry.score), x, y, width, {
    fontSize: 10,
    lineHeight: 13,
    color: [87, 83, 78],
  });
  y += measurePdfTextHeight(pdf, getPdfScoreLabel(entry.score), width, 10, 13);

  const notes = getPdfRowNotes(entry.score, criteria, subIdx);
  if (notes.length) {
    const notesText = notes.join("  |  ");
    drawWrappedPdfText(pdf, notesText, x, y, width, {
      fontSize: 9,
      lineHeight: 12,
      color: [168, 90, 0],
    });
    y += measurePdfTextHeight(pdf, notesText, width, 9, 12);
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(112, 110, 104);
  pdf.text("Commento", x, y);
  y += 12;

  drawWrappedPdfText(pdf, getPdfCommentLabel(entry.comment), x, y, width, {
    fontSize: 10,
    lineHeight: 14,
    color: entry.comment.trim() ? [26, 25, 23] : [112, 110, 104],
    fontStyle: entry.comment.trim() ? "normal" : "italic",
  });
  y += measurePdfTextHeight(
    pdf,
    getPdfCommentLabel(entry.comment),
    width,
    10,
    14,
    entry.comment.trim() ? "normal" : "italic"
  );
  y += 6;

  pdf.setDrawColor(236, 233, 227);
  pdf.line(x, y, x + width, y);
  return y + 12;
}

function drawWrappedPdfText(pdf, text, x, y, width, options = {}) {
  const fontStyle = options.fontStyle || "normal";
  const fontSize = options.fontSize || 11;
  const lines = splitPdfTextToWidth(pdf, String(text ?? ""), width, fontSize, fontStyle);

  pdf.setFont("helvetica", fontStyle);
  pdf.setFontSize(fontSize);
  pdf.setTextColor(...(options.color || [26, 25, 23]));
  pdf.text(lines, x, y);
}

function measurePdfTextHeight(pdf, text, width, fontSize, lineHeight, fontStyle = "normal") {
  const lines = splitPdfTextToWidth(pdf, String(text ?? ""), width, fontSize, fontStyle);
  return Math.max(lineHeight, lines.length * lineHeight);
}

function splitPdfTextToWidth(pdf, text, width, fontSize, fontStyle = "normal") {
  const value = String(text ?? "").replace(/\r\n/g, "\n");

  pdf.setFont("helvetica", fontStyle);
  pdf.setFontSize(fontSize);

  const paragraphs = value.split("\n");
  const lines = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    if (!paragraph.trim()) {
      lines.push("");
      return;
    }

    const words = paragraph.split(/\s+/);
    let currentLine = "";

    words.forEach((word) => {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (pdf.getTextWidth(candidate) <= width) {
        currentLine = candidate;
        return;
      }

      if (currentLine) {
        lines.push(currentLine);
        currentLine = "";
      }

      if (pdf.getTextWidth(word) <= width) {
        currentLine = word;
        return;
      }

      const chunks = splitLongPdfWord(pdf, word, width);
      chunks.forEach((chunk, chunkIndex) => {
        if (chunkIndex < chunks.length - 1) {
          lines.push(chunk);
        } else {
          currentLine = chunk;
        }
      });
    });

    if (currentLine) {
      lines.push(currentLine);
    }

    if (paragraphIndex < paragraphs.length - 1) {
      lines.push("");
    }
  });

  return lines.length ? lines : [""];
}

function splitLongPdfWord(pdf, word, width) {
  const chunks = [];
  let current = "";

  for (const char of word) {
    const candidate = current + char;
    if (current && pdf.getTextWidth(candidate) > width) {
      chunks.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length ? chunks : [word];
}

function formatPdfAverage(avg) {
  if (avg === null || Number.isNaN(avg)) return "-";
  return avg.toFixed(2).replace(".", ",");
}

function getPdfScoreLabel(score) {
  if (!score) return "Punteggio: Non valutato";
  return `Punteggio: ${score}/5`;
}

function getPdfCommentLabel(comment) {
  return comment.trim() || "Nessun commento.";
}

function getPdfRowNotes(score, criteria, subIdx) {
  const notes = [];
  const sub = criteria.subCriteria?.[subIdx];
  const minThreshold = typeof sub === 'object' ? (sub.minThreshold ?? 0) : 0;

  if (minThreshold > 0 && score > 0 && score < minThreshold) {
    notes.push(`Sotto il minimo (${minThreshold})`);
  }
  return notes;
}

async function persistCriteriaOrder() {
  const batch = writeBatch(db);

  criteriaList.forEach((criteria, index) => {
    criteria.order = index;
    batch.update(doc(db, "criteria", criteria.id), { order: index });
  });

  await batch.commit();
}

function setupSortable(container, itemSelector, onReorder) {
  const state = container._sortableState || { draggedItem: null, initialOrder: "" };
  state.itemSelector = itemSelector;
  state.onReorder = onReorder;

  if (container._sortableState) return;
  container._sortableState = state;

  container.addEventListener("dragstart", (event) => {
    const handle = event.target.closest(".drag-handle");
    const item = event.target.closest(state.itemSelector);
    if (!handle || !item) return;

    state.draggedItem = item;
    state.initialOrder = [...container.querySelectorAll(state.itemSelector)]
      .map(entry => entry.dataset.dragId || "")
      .join("|");
    item.classList.add("is-dragging");
    container.classList.add("is-sorting");

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.dataset.dragId || "");
    }
  });

  container.addEventListener("dragover", (event) => {
    if (!state.draggedItem) return;
    event.preventDefault();

    const target = event.target.closest(state.itemSelector);
    if (!target || target === state.draggedItem || target.parentElement !== container) return;

    const rect = target.getBoundingClientRect();
    const insertBefore = event.clientY < rect.top + rect.height / 2;
    container.insertBefore(state.draggedItem, insertBefore ? target : target.nextElementSibling);
  });

  container.addEventListener("dragend", async () => {
    if (!state.draggedItem) return;

    const finalOrder = [...container.querySelectorAll(state.itemSelector)]
      .map(entry => entry.dataset.dragId || "")
      .join("|");

    state.draggedItem.classList.remove("is-dragging");
    container.classList.remove("is-sorting");
    state.draggedItem = null;
    if (finalOrder !== state.initialOrder) {
      await state.onReorder();
    }
    state.initialOrder = "";
  });
}

// ─────────────────────────────────────────────────────────────
// Evaluator: Render
// ─────────────────────────────────────────────────────────────
function renderEvaluator(criteriaArr) {
  elCriteriaContainer.innerHTML = "";

  criteriaArr.forEach((criteria, cardIndex) => {
    const type = criteria.type || "normal";

    const card = document.createElement("div");
    card.className = "criteria-card";
    card.style.animationDelay = `${cardIndex * 60}ms`;

    // Header
    const header = document.createElement("div");
    header.className = "card-header";

    const titleWrap = document.createElement("div");
    const titleEl = document.createElement("div");
    titleEl.className = "card-title";
    titleEl.textContent = criteria.title;

    if (type === "normal") {
      const threshEl = document.createElement("div");
      threshEl.className = "card-threshold";
      threshEl.textContent = `Soglia: ${criteria.threshold}`;
      titleWrap.appendChild(threshEl);
    }

    titleWrap.insertBefore(titleEl, titleWrap.firstChild);

    const badge = document.createElement("span");
    badge.className = "badge pending";
    badge.textContent = "–";
    badge.dataset.badge = criteria.id;

    header.appendChild(titleWrap);
    header.appendChild(badge);
    card.appendChild(header);

    if (type === "normal") {
      // ────── Normal criteria with sub-criteria ──────
      const normalizedSubs = (criteria.subCriteria || []).map(sub => {
        if (typeof sub === 'string') {
          return { text: sub, minThreshold: 0 };
        }
        return {
          text: sub.text || '',
          minThreshold: sub.minThreshold ?? 0,
        };
      });
      criteria.subCriteria = normalizedSubs;

      // Preserve local-only score/comment state across re-renders.
      const existingRows = scores[criteria.id] || {};
      scores[criteria.id] = {};
      normalizedSubs.forEach((_, i) => {
        const existingEntry = existingRows[i];
        scores[criteria.id][i] = {
          score: existingEntry?.score ?? 0,
          comment: existingEntry?.comment ?? "",
        };
      });

      const list = document.createElement("div");
      list.className = "subcriteria-list";

      normalizedSubs.forEach((sub, subIdx) => {
        const entry = ensureScoreEntry(criteria.id, subIdx);
        const row = document.createElement("div");
        row.className = "subcriteria-row row--cleared";
        row.dataset.criteriaId = criteria.id;
        row.dataset.subIndex = subIdx;

        const text = document.createElement("span");
        text.className = "subcriteria-text";
        text.textContent = sub.text;

        const controls = document.createElement("div");
        controls.className = "row-controls";

        const clearBtn = document.createElement("button");
        clearBtn.className = "btn-clear";
        clearBtn.type = "button";
        clearBtn.title = "Azzera punteggio";
        clearBtn.setAttribute("aria-label", "Azzera il punteggio a non valutato");
        clearBtn.innerHTML = `
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>`;
        clearBtn.addEventListener("click", onClearClick);

        const notEvalLabel = document.createElement("span");
        notEvalLabel.className = "not-eval-label";
        notEvalLabel.textContent = "Non valutato";

        const circles = document.createElement("div");
        circles.className = "score-circles";
        circles.setAttribute("role", "group");
        circles.setAttribute("aria-label", `Punteggio per: ${sub.text}`);

        for (let v = 1; v <= 5; v++) {
          const circle = document.createElement("button");
          circle.className = "circle";
          circle.type = "button";
          circle.dataset.value = v;
          circle.setAttribute("aria-label", `Punteggio ${v}`);
          circle.addEventListener("click", onCircleClick);
          circles.appendChild(circle);
        }

        controls.appendChild(clearBtn);
        controls.appendChild(notEvalLabel);
        controls.appendChild(circles);

        const commentWrap = document.createElement("div");
        commentWrap.className = "subcriteria-comment-wrap";

        const textarea = document.createElement("textarea");
        textarea.className = "field subcriteria-comment";
        textarea.placeholder = "Inserisci un commento...";
        textarea.rows = 3;
        textarea.value = entry.comment;
        textarea.addEventListener("input", onCommentInput);

        row.appendChild(text);
        row.appendChild(controls);
        commentWrap.appendChild(textarea);
        row.appendChild(commentWrap);
        applyRowState(row, entry.score);
        list.appendChild(row);
      });

      card.appendChild(list);
    } else if (type === "yesno") {
      // ────── Yes/No criteria ──────
      // Initialize score entry for yes/no criteria
      if (!scores[criteria.id]) {
        scores[criteria.id] = { answer: null };
      }
      const entry = scores[criteria.id];

      const yesnoWrap = document.createElement("div");
      yesnoWrap.className = "yesno-wrap";

      const yesBtn = document.createElement("button");
      yesBtn.className = "btn-yesno btn-yesno-yes";
      yesBtn.type = "button";
      yesBtn.textContent = "Sì";
      yesBtn.dataset.criteriaId = criteria.id;
      yesBtn.dataset.answer = "true";
      yesBtn.addEventListener("click", onYesNoClick);
      if (entry.answer === true) yesBtn.classList.add("active");

      const noBtn = document.createElement("button");
      noBtn.className = "btn-yesno btn-yesno-no";
      noBtn.type = "button";
      noBtn.textContent = "No";
      noBtn.dataset.criteriaId = criteria.id;
      noBtn.dataset.answer = "false";
      noBtn.addEventListener("click", onYesNoClick);
      if (entry.answer === false) noBtn.classList.add("active");

      yesnoWrap.appendChild(yesBtn);
      yesnoWrap.appendChild(noBtn);
      card.appendChild(yesnoWrap);
    }

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
elLoginEmail.addEventListener("keydown", e => { if (e.key === "Enter") elLoginPassword.focus(); });

// Logout
elBtnLogout.addEventListener("click", () => signOut(auth));

// PDF download
elBtnDownloadPdf.addEventListener("click", downloadPdf);
elBtnDownloadJson?.addEventListener("click", downloadJsonState);
elBtnUploadJson?.addEventListener("click", openJsonFilePicker);
elJsonFileInput?.addEventListener("change", handleJsonFileChange);

// Admin drawer
elBtnAdminPanel.addEventListener("click", () => drawerOpen ? closeDrawer() : openDrawer());
elBtnCloseDrawer.addEventListener("click", closeDrawer);
elDrawerBackdrop.addEventListener("click", closeDrawer);
elDrawerResizeHandle?.addEventListener("pointerdown", startDrawerResize);

window.addEventListener("resize", () => {
  if (window.innerWidth <= 540) {
    stopDrawerResize();
    elDrawer?.style.removeProperty("width");
    return;
  }

  applyStoredDrawerWidth();
});

// Close drawer on Escape
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (drawerOpen) closeDrawer();
    if (!elLoginModal.classList.contains("hidden")) closeLoginModal();
  }
});

// Add criteria
elBtnAddCriteria.addEventListener("click", addCriteria);
elNewTitle.addEventListener("keydown", e => { if (e.key === "Enter") elNewThreshold.focus(); });
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
