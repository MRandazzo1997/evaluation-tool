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

const PATHWAY_STORAGE_KEY = "evalkit-pathway";
const GUIDE_FALLBACK_PATH = "user-guide.md";
const GUIDE_DOC_PATHS = {
  lineaA: ["appSettings", "userGuideMarkdown_lineaA"],
  lineaB: ["appSettings", "userGuideMarkdown_lineaB"],
  lineaC: ["appSettings", "userGuideMarkdown_lineaC"],
};
const GUIDE_PDF_HEADERS = {
  lineaA: "",
  lineaB: "L.R. 22/2022, articolo 7, commi 56 – 61. - Avviso per il sostegno a progetti di ricerca industriale, sviluppo sperimentale, innovazione di processo o dell'organizzazione aventi ad oggetto la realizzazione delle idee innovative selezionate con Bando denominato \"LR 22/2022, articolo 7, commi 56 - 61: Bando di concorso per la premiazione di idee innovative nel settore delle scienze della vita-Luglio 2024\" del 31/07/2024 - \"Ideas 4 Innovation- I4I- Febbraio 2025\"",
  lineaC: "LR 22/2022 – articolo 7, commi 56 – 61\n\"Sostegno a progetti di validazione di idee e tecnologie innovative che prevedano il raggiungimento di un TRL 6, 7 o 8\" nel settore delle Scienze della Vita\nSECONDO SPORTELLO",
};

const $ = (id) => document.getElementById(id);

const elStatus = $("guide-status");
const elRendered = $("guide-rendered");
const elPreview = $("guide-preview");
const elViewShell = $("guide-view-shell");
const elEditorShell = $("editor-shell");
const elEditor = $("guide-editor");
const elBtnDownloadPdf = $("btn-download-guide-pdf");
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

function getCurrentPathway() {
  return localStorage.getItem(PATHWAY_STORAGE_KEY) || "lineaC";
}

function getGuideDocRef() {
  const pathway = getCurrentPathway();
  const docPath = GUIDE_DOC_PATHS[pathway] || GUIDE_DOC_PATHS.lineaC;
  return doc(db, ...docPath);
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
  const pathway = getCurrentPathway();
  const pathwayLabel = pathway.charAt(0).toUpperCase() + pathway.slice(1);
  setStatus(`Caricamento guida Linea ${pathwayLabel} in corso...`);

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
      setStatus(`Guida Linea ${pathwayLabel} caricata da Firestore.`);
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
      setStatus(`Guida Linea ${pathwayLabel} caricata dal repository.`);
    } catch (fallbackErr) {
      console.error("Guide loading error:", err, fallbackErr);
      guideMarkdown = "";
      draftMarkdown = "";
      elEditor.value = "";
      updateRenderedGuide("");
      setStatus(`Impossibile caricare la guida Linea ${pathwayLabel}.`);
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

  const originalLabel = elBtnDownloadPdf.textContent;
  elBtnDownloadPdf.disabled = true;
  elBtnDownloadPdf.textContent = "Generazione PDF...";

  try {
    const pathway = getCurrentPathway();
    const headerText = GUIDE_PDF_HEADERS[pathway] || "";
    
    // Get the guide content
    const target = isEditing ? elPreview : elRendered;
    
    // Create PDF
    const pdf = new jsPdfCtor("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 15;
    let currentY = margin;
    
    // Set default font
    pdf.setFont("Arial", "normal");
    pdf.setFontSize(11);
    
    // Add header if applicable
    if (headerText) {
      pdf.setFontSize(10);
      pdf.setFont("Arial", "normal");
      
      const headerLines = pdf.splitTextToSize(headerText, pageWidth - margin * 2);
      headerLines.forEach(line => {
        pdf.text(line, margin, currentY);
        currentY += 5;
      });
      
      currentY += 5;
      pdf.setDrawColor(100);
      pdf.line(margin, currentY, pageWidth - margin, currentY);
      currentY += 10;
    }
    
    // Add guide content as image
    pdf.setFontSize(11);
    
    const canvas = await window.html2canvas(target, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
    });

    const imgData = canvas.toDataURL("image/png");
    const imgWidth = pageWidth - margin * 2;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    // Add content image
    if (currentY + imgHeight < pageHeight - margin) {
      // Fits on current page
      pdf.addImage(imgData, "PNG", margin, currentY, imgWidth, imgHeight);
      currentY += imgHeight;
    } else {
      // Spans multiple pages
      let remainingHeight = imgHeight;
      let yOffset = 0;
      
      while (remainingHeight > 0) {
        const pageAvailableHeight = pageHeight - currentY - margin;
        
        if (pageAvailableHeight > 0 && remainingHeight > 0) {
          const heightToCrop = Math.min(pageAvailableHeight, remainingHeight);
          const sourceTop = yOffset;
          const sourceHeight = (heightToCrop * canvas.height) / imgHeight;
          
          // Create cropped canvas
          const croppedCanvas = document.createElement("canvas");
          croppedCanvas.width = canvas.width;
          croppedCanvas.height = sourceHeight;
          const ctx = croppedCanvas.getContext("2d");
          ctx.drawImage(canvas, 0, -sourceTop, canvas.width, canvas.height);
          
          const croppedImgData = croppedCanvas.toDataURL("image/png");
          pdf.addImage(croppedImgData, "PNG", margin, currentY, imgWidth, heightToCrop);
          
          remainingHeight -= heightToCrop;
          yOffset += sourceHeight;
          currentY = pageHeight - margin;
        }
        
        if (remainingHeight > 0) {
          pdf.addPage();
          currentY = margin;
        }
      }
    }

    // Add footer on last page
    const lastPageNumber = pdf.internal.pages.length - 1;
    pdf.setPage(lastPageNumber);
    
    const footerY = pageHeight - margin - 10;
    pdf.setFontSize(11);
    pdf.setFont("Arial", "normal");
    
    // Draw line above footer
    pdf.setDrawColor(150);
    pdf.line(margin, footerY - 5, pageWidth - margin, footerY - 5);
    
    // Add footer text
    pdf.text("DATA: _____________________", margin, footerY);
    pdf.text("FIRMA (firmato digitalmente): _____________________", pageWidth / 2 + 10, footerY);

    pdf.save("guida-utente.pdf");
    setStatus("PDF della guida generato con successo.");
  } catch (err) {
    console.error("Guide PDF error:", err);
    setStatus("Generazione PDF non riuscita.");
  } finally {
    elBtnDownloadPdf.disabled = false;
    elBtnDownloadPdf.textContent = originalLabel;
  }
}

elBtnDownloadPdf.addEventListener("click", downloadGuidePdf);
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

// Listen for pathway changes from other tabs/windows or from the main evaluation page
window.addEventListener("storage", (event) => {
  if (event.key === PATHWAY_STORAGE_KEY) {
    loadGuideMarkdown();
  }
});

onAuthStateChanged(auth, (user) => {
  applyAuthUI(user);
});

await loadGuideMarkdown();
setEditing(false);
