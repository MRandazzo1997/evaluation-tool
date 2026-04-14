import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
const db = getFirestore(app);

const PATHWAY_STORAGE_KEY = "evalkit-pathway";
const GUIDE_PDF_HEADERS = {
  lineaA: "",
  lineaB: "L.R. 22/2022, articolo 7, commi 56 – 61. - Avviso per il sostegno a progetti di ricerca industriale, sviluppo sperimentale, innovazione di processo o dell'organizzazione aventi ad oggetto la realizzazione delle idee innovative selezionate con Bando denominato \"LR 22/2022, articolo 7, commi 56 - 61: Bando di concorso per la premiazione di idee innovative nel settore delle scienze della vita-Luglio 2024\" del 31/07/2024 - \"Ideas 4 Innovation- I4I- Febbraio 2025\"",
  lineaC: "LR 22/2022 – articolo 7, commi 56 – 61\n\"Sostegno a progetti di validazione di idee e tecnologie innovative che prevedano il raggiungimento di un TRL 6, 7 o 8\" nel settore delle Scienze della Vita\nSECONDO SPORTELLO",
};
const PATHWAY_LABELS = {
  lineaA: "Linea A",
  lineaB: "Linea B",
  lineaC: "Linea C",
};

const $ = (id) => document.getElementById(id);

const elStatus = $("guide-status");
const elPdfIframe = $("pdf-iframe");
const elBtnDownloadPdf = $("btn-download-guide-pdf");
const elViewShell = $("guide-view-shell");

let currentPathway = null;
let currentPdfUrl = null;

// ─────────────────────────────────────────────────────────────
// Pathway Management
// ─────────────────────────────────────────────────────────────
function getCurrentPathway() {
  // Check URL params first, then localStorage
  const params = new URLSearchParams(window.location.search);
  const pathwayFromUrl = params.get("pathway");
  
  if (pathwayFromUrl && ["lineaA", "lineaB", "lineaC"].includes(pathwayFromUrl)) {
    localStorage.setItem(PATHWAY_STORAGE_KEY, pathwayFromUrl);
    return pathwayFromUrl;
  }
  
  return localStorage.getItem(PATHWAY_STORAGE_KEY) || "lineaC";
}

function getPdfDocPath() {
  // Document path: appSettings/userGuidePDF_lineaA, etc.
  return ["appSettings", `userGuidePDF_${currentPathway}`];
}

// ─────────────────────────────────────────────────────────────
// PDF Loading & Display
// ─────────────────────────────────────────────────────────────
async function loadAndDisplayPdf() {
  try {
    elStatus.textContent = `Caricamento guida per ${PATHWAY_LABELS[currentPathway]}...`;
    
    const docRef = doc(db, ...getPdfDocPath());
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      elStatus.textContent = `Nessuna guida disponibile per ${PATHWAY_LABELS[currentPathway]}. Contatta l'amministratore per caricare un PDF.`;
      elStatus.style.color = "#b3a6a6";
      return;
    }
    
    const pdfData = docSnap.data();
    const pdfBase64 = pdfData?.pdfBase64;
    
    if (!pdfBase64 || typeof pdfBase64 !== "string") {
      throw new Error("Dati PDF non validi nel database");
    }
    
    // Convert base64 to blob
    try {
      const binaryString = atob(pdfBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const pdfBlob = new Blob([bytes], { type: "application/pdf" });
      
      currentPdfUrl = URL.createObjectURL(pdfBlob);
      elPdfIframe.src = currentPdfUrl;
      elStatus.textContent = `Guida caricata: ${PATHWAY_LABELS[currentPathway]}`;
      elStatus.style.color = "inherit";
    } catch (decodeErr) {
      console.error("Base64 decode error:", decodeErr);
      throw new Error("Errore nella decodifica del PDF");
    }
  } catch (error) {
    console.error("Error loading PDF:", error);
    elStatus.textContent = `Errore: ${error.message}`;
    elStatus.style.color = "#d92d20";
  }
}

async function downloadPdf() {
  if (!currentPdfUrl) {
    alert("Nessun PDF disponibile per il download.");
    return;
  }

  const originalLabel = elBtnDownloadPdf.innerHTML;
  elBtnDownloadPdf.disabled = true;
  elBtnDownloadPdf.textContent = "Download in corso...";

  try {
    const response = await fetch(currentPdfUrl);
    const blob = await response.blob();
    
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `guida-utente-${currentPathway}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error) {
    console.error("Download error:", error);
    alert("Errore nel download del PDF.");
  } finally {
    elBtnDownloadPdf.disabled = false;
    elBtnDownloadPdf.innerHTML = originalLabel;
  }
}

// ─────────────────────────────────────────────────────────────
// Event Listeners
// ─────────────────────────────────────────────────────────────
elBtnDownloadPdf?.addEventListener("click", downloadPdf);

// ─────────────────────────────────────────────────────────────
// Initialize
// ─────────────────────────────────────────────────────────────
async function init() {
  currentPathway = getCurrentPathway();
  await loadAndDisplayPdf();
}

init();
