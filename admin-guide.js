import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, getFirestore, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDurtWkI0PVo3Mkdc57-YCaMWS8RlEyjbY",
  authDomain: "evaluation-tool-4b30e.firebaseapp.com",
  projectId: "evaluation-tool-4b30e",
  storageBucket: "evaluation-tool-4b30e.firebasestorage.app",
  messagingSenderId: "844031556087",
  appId: "1:844031556087:web:f4319e9a17571dc16556f2",
  measurementId: "G-ZHQEKSY216"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const GUIDE_DOC_PATH = ["appSettings", "adminGuideMarkdown"];
const GUIDE_FALLBACK_PATH = "admin-guide.md";

const $ = (id) => document.getElementById(id);

const elStatus = $("guide-status");
const elRendered = $("guide-rendered");
const elPreview = $("guide-preview");
const elViewShell = $("guide-view-shell");
const elEditorShell = $("editor-shell");
const elEditor = $("guide-editor");
const elBtnDownloadPdf = $("btn-download-guide-pdf");
const elBtnUploadPdf = $("btn-upload-guide-pdf");
const elAdminGuideFileInput = $("admin-guide-file-input");
const elBtnEdit = $("btn-edit-guide");
const elBtnSave = $("btn-save-guide");
const elBtnCancel = $("btn-cancel-guide");
const elBtnLogin = $("btn-guide-login");
const elBtnLogout = $("btn-guide-logout");
const elUserInfo = $("guide-user-info");
const elUserEmail = $("guide-user-email");
const elLoginModal = $("guide-login-modal");
const elLoginBackdrop = $("guide-modal-backdrop");
const elBtnCloseLogin = $("btn-guide-close-login");
const elBtnSubmitLogin = $("btn-guide-submit-login");
const elLoginEmail = $("guide-login-email");
const elLoginPassword = $("guide-login-password");
const elLoginError = $("guide-login-error");
const toolbarButtons = [...document.querySelectorAll(".toolbar-btn")];

let currentUser = null;
let isEditing = false;
let guideMarkdown = "";
let draftMarkdown = "";
let guideSource = "repository";

function getGuideDocRef() {
  return doc(db, ...GUIDE_DOC_PATH);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return html;
}

function renderMarkdown(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let listType = null;
  let inCodeBlock = false;
  let codeLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  };

  const flushCodeBlock = () => {
    if (!inCodeBlock) return;
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    inCodeBlock = false;
    codeLines = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushList();
      if (inCodeBlock) {
        flushCodeBlock();
      } else {
        inCodeBlock = true;
        codeLines = [];
      }
      return;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      return;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      flushList();
      html.push("<hr>");
      return;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      return;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`);
      return;
    }

    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      if (listType !== "ul") {
        flushList();
        listType = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${renderInlineMarkdown(bullet[1])}</li>`);
      return;
    }

    const numbered = trimmed.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      flushParagraph();
      if (listType !== "ol") {
        flushList();
        listType = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${renderInlineMarkdown(numbered[1])}</li>`);
      return;
    }

    flushList();
    paragraph.push(trimmed);
  });

  flushParagraph();
  flushList();
  flushCodeBlock();

  return html.join("\n");
}

function updateRenderedGuide(markdown) {
  const renderedHtml = renderMarkdown(markdown);
  const finalHtml = renderedHtml.trim() || '<p class="guide-empty">La guida è attualmente vuota.</p>';
  elRendered.innerHTML = finalHtml;
  elPreview.innerHTML = finalHtml;
}

function setStatus(message) {
  elStatus.textContent = message;
}

async function loadFallbackMarkdown() {
  const response = await fetch(`${GUIDE_FALLBACK_PATH}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("File Markdown di fallback non disponibile.");
  }
  return response.text();
}

async function loadGuideMarkdown() {
  setStatus("Caricamento guida in corso...");

  try {
    const snapshot = await getDoc(getGuideDocRef());
    const data = snapshot.data();
    const markdown = typeof data?.markdown === "string" ? data.markdown : "";

    if (markdown.trim()) {
      guideMarkdown = markdown;
      draftMarkdown = markdown;
      guideSource = "firestore";
      elEditor.value = draftMarkdown;
      updateRenderedGuide(guideMarkdown);
      setStatus("Versione pubblicata caricata da Firestore.");
      return;
    }

    throw new Error("No Firestore guide content");
  } catch (err) {
    try {
      const fallbackMarkdown = await loadFallbackMarkdown();
      guideMarkdown = fallbackMarkdown;
      draftMarkdown = fallbackMarkdown;
      guideSource = "repository";
      elEditor.value = draftMarkdown;
      updateRenderedGuide(guideMarkdown);
      setStatus("Versione di fallback caricata dal repository.");
    } catch (fallbackErr) {
      console.error("Guide loading error:", err, fallbackErr);
      guideMarkdown = "";
      draftMarkdown = "";
      elEditor.value = "";
      updateRenderedGuide("");
      setStatus("Impossibile caricare la guida.");
    }
  }
}

function setEditing(nextValue) {
  isEditing = nextValue;
  elEditorShell.classList.toggle("hidden", !isEditing);
  elViewShell.classList.toggle("hidden", isEditing);
  elBtnEdit.classList.toggle("hidden", !currentUser || isEditing);
  elBtnSave.classList.toggle("hidden", !currentUser || !isEditing);
  elBtnCancel.classList.toggle("hidden", !currentUser || !isEditing);

  if (isEditing) {
    draftMarkdown = guideMarkdown;
    elEditor.value = draftMarkdown;
    updateRenderedGuide(draftMarkdown);
    setStatus(`Modalità modifica attiva. Origine corrente: ${guideSource === "firestore" ? "Firestore" : "repository"}.`);
    setTimeout(() => elEditor.focus(), 50);
  } else {
    updateRenderedGuide(guideMarkdown);
    setStatus(`Guida pronta. Origine corrente: ${guideSource === "firestore" ? "Firestore" : "repository"}.`);
  }
}

function openLoginModal() {
  elLoginModal.classList.remove("hidden");
  elLoginModal.setAttribute("aria-hidden", "false");
  elLoginEmail.value = "";
  elLoginPassword.value = "";
  hideLoginError();
  setTimeout(() => elLoginEmail.focus(), 30);
}

function closeLoginModal() {
  elLoginModal.classList.add("hidden");
  elLoginModal.setAttribute("aria-hidden", "true");
}

function showLoginError(message) {
  elLoginError.textContent = message;
  elLoginError.classList.remove("hidden");
}

function hideLoginError() {
  elLoginError.textContent = "";
  elLoginError.classList.add("hidden");
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

async function handleLogin() {
  const email = elLoginEmail.value.trim();
  const password = elLoginPassword.value;

  if (!email || !password) {
    showLoginError("Inserisci email e password.");
    return;
  }

  hideLoginError();
  elBtnSubmitLogin.disabled = true;
  elBtnSubmitLogin.textContent = "Accesso in corso...";

  try {
    await signInWithEmailAndPassword(auth, email, password);
    closeLoginModal();
  } catch (err) {
    showLoginError(friendlyAuthError(err.code));
  } finally {
    elBtnSubmitLogin.disabled = false;
    elBtnSubmitLogin.textContent = "Accedi";
  }
}

function applyAuthUI(user) {
  currentUser = user;
  const loggedIn = !!user;

  document.querySelectorAll(".admin-only").forEach((el) => {
    el.classList.toggle("hidden", !loggedIn);
  });

  elBtnLogin.classList.toggle("hidden", loggedIn);
  elUserInfo.classList.toggle("hidden", !loggedIn);

  if (loggedIn) {
    elUserEmail.textContent = user.email;
  } else {
    elUserEmail.textContent = "";
    if (isEditing) {
      setEditing(false);
    }
  }

  if (!loggedIn) {
    elBtnEdit.classList.add("hidden");
    elBtnSave.classList.add("hidden");
    elBtnCancel.classList.add("hidden");
  } else if (!isEditing) {
    elBtnEdit.classList.remove("hidden");
  }
}

function getSelectionRange() {
  return {
    start: elEditor.selectionStart ?? 0,
    end: elEditor.selectionEnd ?? 0,
    selected: elEditor.value.slice(elEditor.selectionStart ?? 0, elEditor.selectionEnd ?? 0)
  };
}

function updateEditorValue(nextValue, nextStart, nextEnd = nextStart) {
  elEditor.value = nextValue;
  draftMarkdown = nextValue;
  elEditor.focus();
  elEditor.setSelectionRange(nextStart, nextEnd);
  updateRenderedGuide(draftMarkdown);
}

function wrapSelection(prefix, suffix = prefix, placeholder = "testo") {
  const { start, end, selected } = getSelectionRange();
  const content = selected || placeholder;
  const nextValue = `${elEditor.value.slice(0, start)}${prefix}${content}${suffix}${elEditor.value.slice(end)}`;
  const cursorStart = start + prefix.length;
  const cursorEnd = cursorStart + content.length;
  updateEditorValue(nextValue, cursorStart, cursorEnd);
}

function prefixLines(prefix, transform = (line, index) => `${prefix}${line}`, placeholder = "Voce") {
  const { start, end, selected } = getSelectionRange();
  const content = selected || placeholder;
  const lines = content.split("\n");
  const nextBlock = lines.map(transform).join("\n");
  const nextValue = `${elEditor.value.slice(0, start)}${nextBlock}${elEditor.value.slice(end)}`;
  updateEditorValue(nextValue, start, start + nextBlock.length);
}

function insertLink() {
  const { start, end, selected } = getSelectionRange();
  const label = selected || "testo link";
  const snippet = `[${label}](https://example.com)`;
  const nextValue = `${elEditor.value.slice(0, start)}${snippet}${elEditor.value.slice(end)}`;
  updateEditorValue(nextValue, start + 1, start + 1 + label.length);
}

function handleToolbarAction(action) {
  switch (action) {
    case "h1":
      prefixLines("# ", (line) => `# ${line}`, "Titolo");
      break;
    case "h2":
      prefixLines("## ", (line) => `## ${line}`, "Sezione");
      break;
    case "bold":
      wrapSelection("**", "**", "testo in evidenza");
      break;
    case "italic":
      wrapSelection("*", "*", "testo");
      break;
    case "bullet":
      prefixLines("- ", (line) => `- ${line}`, "Voce elenco");
      break;
    case "number":
      prefixLines("1. ", (_line, index) => `${index + 1}. ${_line}`, "Voce elenco");
      break;
    case "quote":
      prefixLines("> ", (line) => `> ${line}`, "Nota");
      break;
    case "code":
      wrapSelection("```\n", "\n```", "codice");
      break;
    case "link":
      insertLink();
      break;
    default:
      break;
  }
}

async function saveGuide() {
  if (!currentUser) return;

  const nextMarkdown = elEditor.value;
  const originalLabel = elBtnSave.textContent;
  elBtnSave.disabled = true;
  elBtnSave.textContent = "Salvataggio...";

  try {
    await setDoc(getGuideDocRef(), {
      markdown: nextMarkdown,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.email || "",
    });

    guideMarkdown = nextMarkdown;
    draftMarkdown = nextMarkdown;
    guideSource = "firestore";
    setEditing(false);
    setStatus("Guida aggiornata e pubblicata.");
  } catch (err) {
    console.error("Guide save error:", err);
    setStatus(`Salvataggio non riuscito: ${err.message}`);
  } finally {
    elBtnSave.disabled = false;
    elBtnSave.textContent = originalLabel;
  }
}

async function downloadGuidePdf() {
  const jsPdfCtor = window.jspdf?.jsPDF;
  if (!jsPdfCtor) {
    setStatus("Generazione PDF non disponibile.");
    return;
  }

  const target = isEditing ? elPreview : elRendered;
  const originalLabel = elBtnDownloadPdf.textContent;
  elBtnDownloadPdf.disabled = true;
  elBtnDownloadPdf.textContent = "Generazione PDF...";

  try {
    const canvas = await window.html2canvas(target, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
    });

    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPdfCtor("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 12;
    const renderWidth = pageWidth - margin * 2;
    const renderHeight = (canvas.height * renderWidth) / canvas.width;

    let remainingHeight = renderHeight;
    let positionY = margin;

    pdf.addImage(imgData, "PNG", margin, positionY, renderWidth, renderHeight);
    remainingHeight -= pageHeight - margin * 2;

    while (remainingHeight > 0) {
      positionY = remainingHeight - renderHeight + margin;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", margin, positionY, renderWidth, renderHeight);
      remainingHeight -= pageHeight - margin * 2;
    }

    pdf.save("guida-admin.pdf");
    setStatus("PDF della guida generato con successo.");
  } catch (err) {
    console.error("Guide PDF error:", err);
    setStatus("Generazione PDF non riuscita.");
  } finally {
    elBtnDownloadPdf.disabled = false;
    elBtnDownloadPdf.textContent = originalLabel;
  }
}

function openAdminGuideFilePicker() {
  if (!elAdminGuideFileInput) return;
  elAdminGuideFileInput.value = "";
  elAdminGuideFileInput.click();
}

async function handleAdminGuideFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (file.type !== "application/pdf") {
    setStatus("Seleziona un file PDF valido.");
    return;
  }

  if (!currentUser) {
    setStatus("Devi essere loggato per caricare una guida.");
    return;
  }

  elBtnUploadPdf.disabled = true;
  const originalLabel = elBtnUploadPdf.textContent;
  elBtnUploadPdf.textContent = "Caricamento...";

  try {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        // Extract base64 from data URL (format: data:application/pdf;base64,xxxxx)
        const dataUrl = reader.result;
        const base64String = dataUrl.split(",")[1];

        if (!base64String) {
          setStatus("Errore nel processamento del file PDF.");
          return;
        }

        // Save to Firestore
        const docRef = doc(db, "appSettings", "adminGuidePDF");
        await setDoc(
          docRef,
          {
            pdfBase64: base64String,
            updatedAt: new Date().toISOString(),
            updatedBy: currentUser.email,
          },
          { merge: true }
        );

        setStatus("Guida amministratore caricata con successo.");
        elAdminGuideFileInput.value = "";
      } catch (err) {
        console.error("Upload error:", err);
        setStatus(`Caricamento non riuscito: ${err.message}`);
      } finally {
        elBtnUploadPdf.disabled = false;
        elBtnUploadPdf.textContent = originalLabel;
      }
    };
    reader.onerror = () => {
      setStatus("Errore nella lettura del file PDF.");
      elBtnUploadPdf.disabled = false;
      elBtnUploadPdf.textContent = originalLabel;
    };
    reader.readAsDataURL(file);
  } catch (err) {
    console.error("File handling error:", err);
    setStatus("Errore nel processamento del file.");
    elBtnUploadPdf.disabled = false;
    elBtnUploadPdf.textContent = originalLabel;
  }
}

elBtnDownloadPdf.addEventListener("click", downloadGuidePdf);
elBtnUploadPdf.addEventListener("click", openAdminGuideFilePicker);
elAdminGuideFileInput.addEventListener("change", handleAdminGuideFileChange);
elBtnEdit.addEventListener("click", () => setEditing(true));
elBtnCancel.addEventListener("click", () => setEditing(false));
elBtnSave.addEventListener("click", saveGuide);
elBtnLogin.addEventListener("click", openLoginModal);
elBtnLogout.addEventListener("click", () => signOut(auth));
elBtnCloseLogin.addEventListener("click", closeLoginModal);
elLoginBackdrop.addEventListener("click", closeLoginModal);
elBtnSubmitLogin.addEventListener("click", handleLogin);
elLoginPassword.addEventListener("keydown", (event) => {
  if (event.key === "Enter") handleLogin();
});
elEditor.addEventListener("input", () => {
  draftMarkdown = elEditor.value;
  updateRenderedGuide(draftMarkdown);
});

toolbarButtons.forEach((button) => {
  button.addEventListener("click", () => handleToolbarAction(button.dataset.action));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elLoginModal.classList.contains("hidden")) {
    closeLoginModal();
  }
});

onAuthStateChanged(auth, (user) => {
  applyAuthUI(user);
});

await loadGuideMarkdown();
setEditing(false);
