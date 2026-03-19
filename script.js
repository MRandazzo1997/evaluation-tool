// ─────────────────────────────────────────────────────────────
// Firebase Configuration
// Replace the placeholder values below with your actual Firebase
// project credentials before deploying.
// ─────────────────────────────────────────────────────────────
import { initializeApp }              from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, getDocs, orderBy, query }
                                      from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Import the functions you need from the SDKs you need
// import { initializeApp } from "firebase/app";
// import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDurtWkI0PVo3Mkdc57-YCaMWS8RlEyjbY",
  authDomain: "evaluation-tool-4b30e.firebaseapp.com",
  projectId: "evaluation-tool-4b30e",
  storageBucket: "evaluation-tool-4b30e.firebasestorage.app",
  messagingSenderId: "844031556087",
  appId: "1:844031556087:web:f4319e9a17571dc16556f2",
  measurementId: "G-ZHQEKSY216"
};

// Initialize Firebase
// const app = initializeApp(firebaseConfig);
// const analytics = getAnalytics(app);

// ─────────────────────────────────────────────────────────────
// App State
// ─────────────────────────────────────────────────────────────

/**
 * scores[criteriaId][subIndex] = number (1–5) | null
 * Stored only in memory; never written to Firestore.
 */
const scores = {};

/** Cached criteria loaded from Firestore */
let criteriaList = [];

// ─────────────────────────────────────────────────────────────
// Firebase Init
// ─────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ─────────────────────────────────────────────────────────────
// DOM Helpers
// ─────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showState(name) {
  ["loading", "error", "empty"].forEach(s => {
    $(`state-${s}`).classList.toggle("hidden", s !== name);
  });
  $("criteria-container").classList.add("hidden");
  $("overall-result").classList.add("hidden");
}

function showApp() {
  $("state-loading").classList.add("hidden");
  $("state-error").classList.add("hidden");
  $("state-empty").classList.add("hidden");
  $("criteria-container").classList.remove("hidden");
  $("overall-result").classList.remove("hidden");
}

// ─────────────────────────────────────────────────────────────
// Scoring Logic
// ─────────────────────────────────────────────────────────────

/**
 * Returns the average score for a criteria, or null if not all
 * sub-criteria have been scored.
 */
function averageScore(criteriaId, subCount) {
  const rows = scores[criteriaId] || {};
  const values = [];
  for (let i = 0; i < subCount; i++) {
    const v = rows[i];
    if (v == null) return null; // incomplete
    values.push(v);
  }
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Updates the badge for a single criteria card and recalculates
 * the overall result badge.
 */
function updateBadges() {
  let allScored = true;
  let allPass   = true;

  criteriaList.forEach(criteria => {
    const avg   = averageScore(criteria.id, criteria.subCriteria.length);
    const badge = document.querySelector(`[data-badge="${criteria.id}"]`);
    if (!badge) return;

    if (avg === null) {
      // Not all sub-criteria scored yet
      allScored = false;
      allPass   = false;
      badge.className  = "badge pending";
      badge.textContent = "–";
    } else {
      const pass = avg >= criteria.threshold;
      if (!pass) allPass = false;
      badge.className  = `badge ${pass ? "pass" : "fail"}`;
      badge.textContent = pass ? "Pass" : "Fail";
    }
  });

  // Overall result
  const overallBadge = $("overall-badge");
  if (criteriaList.length === 0) {
    overallBadge.className  = "badge pending";
    overallBadge.textContent = "–";
  } else if (!allScored) {
    overallBadge.className  = "badge pending";
    overallBadge.textContent = "Incomplete";
  } else {
    overallBadge.className  = `badge ${allPass ? "pass" : "fail"}`;
    overallBadge.textContent = allPass ? "Pass" : "Fail";
  }
}

// ─────────────────────────────────────────────────────────────
// Circle Interaction
// ─────────────────────────────────────────────────────────────

/**
 * Renders filled state for circles in a sub-criteria row.
 * Fills circles 1 through `score`; empties the rest.
 */
function renderCircles(rowEl, score) {
  rowEl.querySelectorAll(".circle").forEach(c => {
    const v = parseInt(c.dataset.value, 10);
    c.classList.toggle("filled", v <= score);
  });
}

/**
 * Handles a circle click.
 */
function onCircleClick(e) {
  const circle = e.currentTarget;
  const row    = circle.closest(".subcriteria-row");
  const cid    = row.dataset.criteriaId;
  const idx    = parseInt(row.dataset.subIndex, 10);
  const value  = parseInt(circle.dataset.value, 10);

  if (!scores[cid]) scores[cid] = {};
  scores[cid][idx] = value;

  renderCircles(row, value);
  updateBadges();
}

// ─────────────────────────────────────────────────────────────
// Render Criteria
// ─────────────────────────────────────────────────────────────

function renderCriteria(criteriaArr) {
  const container = $("criteria-container");
  container.innerHTML = "";

  criteriaArr.forEach((criteria, cardIndex) => {
    scores[criteria.id] = {};

    // ── Card ──────────────────────────────────────────────────
    const card = document.createElement("div");
    card.className = "criteria-card";
    card.style.animationDelay = `${cardIndex * 60}ms`;

    // ── Card Header ───────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "card-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "card-title-wrap";

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = criteria.title;

    const threshold = document.createElement("div");
    threshold.className = "card-threshold";
    threshold.textContent = `Threshold: ${criteria.threshold}`;

    titleWrap.appendChild(title);
    titleWrap.appendChild(threshold);

    const badge = document.createElement("span");
    badge.className = "badge pending";
    badge.textContent = "–";
    badge.dataset.badge = criteria.id;

    header.appendChild(titleWrap);
    header.appendChild(badge);
    card.appendChild(header);

    // ── Sub-criteria rows ─────────────────────────────────────
    const list = document.createElement("div");
    list.className = "subcriteria-list";

    (criteria.subCriteria || []).forEach((sub, subIdx) => {
      const row = document.createElement("div");
      row.className = "subcriteria-row";
      row.dataset.criteriaId = criteria.id;
      row.dataset.subIndex   = subIdx;

      const text = document.createElement("span");
      text.className = "subcriteria-text";
      text.textContent = sub;

      const circles = document.createElement("div");
      circles.className = "score-circles";
      circles.setAttribute("role", "group");
      circles.setAttribute("aria-label", `Score for: ${sub}`);

      for (let v = 1; v <= 5; v++) {
        const circle = document.createElement("button");
        circle.className = "circle";
        circle.dataset.value = v;
        circle.setAttribute("aria-label", `Score ${v}`);
        circle.setAttribute("type", "button");
        circle.addEventListener("click", onCircleClick);
        circles.appendChild(circle);
      }

      row.appendChild(text);
      row.appendChild(circles);
      list.appendChild(row);
    });

    card.appendChild(list);
    container.appendChild(card);
  });
}

// ─────────────────────────────────────────────────────────────
// Firestore Load
// ─────────────────────────────────────────────────────────────

async function loadCriteria() {
  showState("loading");

  try {
    const q        = query(collection(db, "criteria"), orderBy("order"));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      showState("empty");
      return;
    }

    criteriaList = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      subCriteria: doc.data().subCriteria || [],
    }));

    renderCriteria(criteriaList);
    showApp();
    updateBadges();

  } catch (err) {
    console.error("Firestore error:", err);
    $("error-message").textContent = `Failed to load criteria: ${err.message}`;
    showState("error");
  }
}

// ─────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────
loadCriteria();