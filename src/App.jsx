import { useEffect, useState } from "react";
import "./App.css";

const DEMO_CASES = [
  {
    id: "CT-DEMO-001",
    title: "Road maintenance issue",
    authority: "Sample municipal authority",
    status: "In progress",
    isDemo: true,
  },
  {
    id: "CT-DEMO-002",
    title: "Street light not working",
    authority: "Sample electricity authority",
    status: "Response pending",
    isDemo: true,
  },
  {
    id: "CT-DEMO-003",
    title: "Water supply complaint",
    authority: "Sample water authority",
    status: "Resolved",
    isDemo: true,
  },
];

const EMPTY_FORM = {
  title: "",
  category: "",
  authority: "",
  location: "",
  incidentDate: "",
  description: "",
  deadline: "",
  evidence: [],
};
function getLocalDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function isFollowUpOverdue(item) {
  if (!item || item.isDemo || !item.deadline) {
    return false;
  }

  const hasResponse = (item.events || []).some(
    (event) => event.title === "Response received"
  );

  return item.deadline < getLocalDateKey() && !hasResponse;
}
async function sha256(value) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 is not available in this browser.");
  }

  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function buildHashChain(events) {
  let previousHash = "GENESIS";
  const chainedEvents = [];

  for (const event of events) {
    const payload = JSON.stringify({
      id: event.id,
      date: event.date,
      title: event.title,
      details: event.details,
      previousHash,
    });

    const hash = await sha256(payload);

    chainedEvents.push({
      ...event,
      previousHash,
      hash,
    });

    previousHash = hash;
  }

  return chainedEvents;
}

async function verifyHashChain(events) {
  if (!events || events.length === 0) {
    return { status: "empty", message: "No timeline events to verify." };
  }

  const hasHashes = events.map(
    (event) => Boolean(event.hash && event.previousHash)
  );

  if (hasHashes.every((value) => !value)) {
    return {
      status: "unsealed",
      message: "This timeline has not been hashed yet.",
    };
  }

  if (hasHashes.some((value) => !value)) {
    return {
      status: "invalid",
      message: "Some timeline events are missing hash data.",
    };
  }

  let previousHash = "GENESIS";

  for (const event of events) {
    const payload = JSON.stringify({
      id: event.id,
      date: event.date,
      title: event.title,
      details: event.details,
      previousHash,
    });

    const expectedHash = await sha256(payload);

    if (
      event.previousHash !== previousHash ||
      event.hash !== expectedHash
    ) {
      return {
        status: "invalid",
        message: "A timeline event or its hash chain has changed.",
      };
    }

    previousHash = event.hash;
  }

  return {
    status: "verified",
    message: "All hashed timeline events passed verification.",
  };
}
const EVIDENCE_DB_NAME = "ClearTrailEvidence";
const EVIDENCE_STORE_NAME = "attachments";

function openEvidenceDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("Browser evidence storage is unavailable."));
      return;
    }

    const request = window.indexedDB.open(EVIDENCE_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(EVIDENCE_STORE_NAME)) {
        db.createObjectStore(EVIDENCE_STORE_NAME, {
          keyPath: "id",
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function hashEvidenceFile(file) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 is unavailable in this browser.");
  }

  const buffer = await file.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    buffer
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function saveEvidenceFiles(caseId, files) {
  const db = await openEvidenceDB();
  const createdAt = new Date().toISOString();
  const batchId = Date.now();

  let attachments;

  try {
    attachments = await Promise.all(
      files.map(async (file, index) => ({
        id: `${caseId}-${batchId}-${index}`,
        caseId,
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        addedAt: createdAt,
        sha256: await hashEvidenceFile(file),
        blob: file,
      }))
    );
  } catch (error) {
    db.close();
    throw error;
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      EVIDENCE_STORE_NAME,
      "readwrite"
    );

    const store = transaction.objectStore(EVIDENCE_STORE_NAME);

    attachments.forEach((attachment) => store.put(attachment));

    transaction.oncomplete = () => {
      db.close();
      resolve(
        attachments.map(({ blob, ...metadata }) => metadata)
      );
    };

    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };

    transaction.onabort = () => {
      db.close();
      reject(
        transaction.error ||
          new Error("Evidence saving was cancelled.")
      );
    };
  });
}
async function loadEvidenceFiles(caseId) {
  const db = await openEvidenceDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      EVIDENCE_STORE_NAME,
      "readonly"
    );

    const request = transaction
      .objectStore(EVIDENCE_STORE_NAME)
      .getAll();

    request.onsuccess = () => {
      resolve(
        request.result.filter((item) => item.caseId === caseId)
      );
    };

    request.onerror = () => reject(request.error);

    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}
function loadSavedCases() {
  try {
    const stored = localStorage.getItem("cleartrailSavedCases");
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function App() {
  const [view, setView] = useState("home");
  const [savedCases, setSavedCases] = useState(loadSavedCases);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [selectedEvidenceFiles, setSelectedEvidenceFiles] = useState([]);
const [caseAttachments, setCaseAttachments] = useState([]);
const [evidenceChecks, setEvidenceChecks] = useState({});
const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [selectedCase, setSelectedCase] = useState(null);
  const [notice, setNotice] = useState("");
  const [eventTitle, setEventTitle] = useState(
  "Follow-up action recorded"
);
const [eventDetails, setEventDetails] = useState("");
const [integrityResult, setIntegrityResult] = useState(null);
const [tamperDemoActive, setTamperDemoActive] = useState(false);

  const allCases = [...savedCases, ...DEMO_CASES];
  const overdueCases = savedCases.filter(isFollowUpOverdue);
  const [draftType, setDraftType] = useState("reminder");
const [actionDraft, setActionDraft] = useState("");
  useEffect(() => {
    localStorage.setItem(
      "cleartrailSavedCases",
      JSON.stringify(savedCases)
    );
  }, [savedCases]);
  useEffect(() => {
  setTamperDemoActive(false);
  setIntegrityResult(null);
}, [selectedCase?.id]);
 useEffect(() => {
  let active = true;

  if (!selectedCase?.id || selectedCase.isDemo) {
    setCaseAttachments([]);
    setEvidenceLoading(false);
    return;
  }

  setEvidenceLoading(true);

  loadEvidenceFiles(selectedCase.id)
    .then((files) => {
      if (active) setCaseAttachments(files);
    })
    .catch((error) => {
      console.error("Could not load evidence files:", error);

      if (active) setCaseAttachments([]);
    })
    .finally(() => {
      if (active) setEvidenceLoading(false);
    });

  return () => {
    active = false;
  };
}, [selectedCase?.id, selectedCase?.isDemo]);

  function updateField(event) {
    const { name, value } = event.target;

    setFormData((previous) => ({
      ...previous,
      [name]: value,
    }));
  }
   function handleEvidenceFileSelection(event) {
  const chosen = Array.from(event.target.files || []);
  const limited = chosen.slice(0, 5);
  const maxBytes = 10 * 1024 * 1024;

  if (chosen.length > 5) {
    window.alert("Please choose no more than 5 files.");
  }

  const validFiles = limited.filter((file) => file.size <= maxBytes);

  if (validFiles.length < limited.length) {
    window.alert("Each evidence file must be 10 MB or smaller.");
  }

  setSelectedEvidenceFiles(validFiles);
}

function downloadEvidenceFile(attachment) {
  if (!attachment?.blob) {
    window.alert("This attachment is not available in local browser storage.");
    return;
  }

  const url = URL.createObjectURL(attachment.blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = attachment.name || "evidence-file";

  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function verifyEvidenceAttachment(attachment) {
  if (!attachment?.blob) {
    setEvidenceChecks((previous) => ({
      ...previous,
      [attachment.id]: {
        status: "error",
        message: "The stored file could not be loaded.",
      },
    }));
    return;
  }

  if (!attachment.sha256) {
    setEvidenceChecks((previous) => ({
      ...previous,
      [attachment.id]: {
        status: "unverified",
        message:
          "No fingerprint was saved for this older attachment. Upload the file again in a new complaint to create one.",
      },
    }));
    return;
  }

  setEvidenceChecks((previous) => ({
    ...previous,
    [attachment.id]: {
      status: "checking",
      message: "Checking file contents...",
    },
  }));

  try {
    const actualHash = await hashEvidenceFile(attachment.blob);
    const matches = actualHash === attachment.sha256;

    setEvidenceChecks((previous) => ({
      ...previous,
      [attachment.id]: {
        status: matches ? "verified" : "mismatch",
        message: matches
          ? "File integrity verified. Its contents match the saved fingerprint."
          : "Integrity warning. The file contents do not match the saved fingerprint.",
        hash: actualHash,
      },
    }));
  } catch (error) {
    console.error("Evidence verification failed:", error);

    setEvidenceChecks((previous) => ({
      ...previous,
      [attachment.id]: {
        status: "error",
        message: "Could not verify this file in the current browser.",
      },
    }));
  }
}
  function toggleEvidence(item) {
    setFormData((previous) => ({
      ...previous,
      evidence: previous.evidence.includes(item)
        ? previous.evidence.filter((entry) => entry !== item)
        : [...previous.evidence, item],
    }));
  }

  async function saveComplaint(event) {
  event.preventDefault();

  try {
    const now = new Date();

    const caseId = `CT-${now.getTime().toString().slice(-8)}`;

const attachments = selectedEvidenceFiles.length
  ? await saveEvidenceFiles(caseId, selectedEvidenceFiles)
  : [];

const initialEvent = {
  id: `${now.getTime()}-created`,
  date: now.toISOString(),
  title: "Personal record created",
  details: "Complaint details saved on this device.",
};

const timelineEvents = [initialEvent];

if (attachments.length > 0) {
  timelineEvents.push({
    id: `${now.getTime()}-evidence`,
    date: now.toISOString(),
    title: "Evidence files attached",
    details: `Stored ${attachments.length} file(s): ${attachments
      .map((file) => file.name)
      .join(", ")}.`,
  });
}

const hashedEvents = await buildHashChain(timelineEvents);

const newCase = {
  ...formData,
  id: caseId,
  status: "Personal record saved",
  createdAt: now.toLocaleDateString("en-IN"),
  isDemo: false,
  events: hashedEvents,
  attachments,
};

    setSavedCases((previous) => [newCase, ...previous]);
    setFormData(EMPTY_FORM);
    setSelectedEvidenceFiles([]);
    setNotice("Your complaint record was saved on this device.");
    setSelectedCase(newCase);
    setView("details");
  } catch (error) {
    console.error("Timeline hashing failed:", error);

    window.alert(
      "Could not create the timeline hash. Please try again."
    );
  }
}
 async function addCaseEvent(event) {
  event.preventDefault();

  if (!selectedCase || selectedCase.isDemo) return;

  try {
    const existingEvents = selectedCase.events || [];

    // Never silently rebuild a chain that already fails verification.
    const previousCheck = await verifyHashChain(existingEvents);

    if (previousCheck.status === "invalid") {
      setIntegrityResult(previousCheck);
      setNotice(
        "Update blocked. The existing timeline failed integrity verification."
      );
      return;
    }

    const newEvent = {
      id: `${Date.now()}`,
      date: new Date().toISOString(),
      title: eventTitle,
      details: eventDetails.trim() || "No additional notes recorded.",
    };

    // Hash the timeline, including the new event.
    const updatedEvents = await buildHashChain([
      ...existingEvents,
      newEvent,
    ]);

    const updatedCase = {
      ...selectedCase,
      events: updatedEvents,
    };

    setSavedCases((previous) =>
      previous.map((item) =>
        item.id === selectedCase.id ? updatedCase : item
      )
    );

    setSelectedCase(updatedCase);
    setEventTitle("Follow-up action recorded");
    setEventDetails("");
    setIntegrityResult(null);
    setNotice("Timeline update saved and hashes generated.");
  } catch (error) {
    console.error("Timeline update failed:", error);
    setNotice("The timeline update could not be saved. Please try again.");
  }
}
function generateActionDraft() {
  if (!selectedCase) return;

  const item = selectedCase;

  const subject =
    draftType === "review"
      ? `Request for review: ${item.title}`
      : `Request for update: ${item.title}`;

  const opening =
    draftType === "review"
      ? "If a review or appeal procedure is available for this matter, I request that the appropriate process be explained and considered."
      : "I would appreciate an update on this matter and guidance on the appropriate next steps.";

  const evidence = item.evidence?.length
    ? item.evidence.join(", ")
    : "No evidence items recorded";

  const draft = `To,
${item.authority || "[Relevant department or authority]"}

Subject: ${subject}

Dear Sir/Madam,

I am writing regarding the issue described below.

Issue: ${item.title}
Location: ${item.location || "Not provided"}
Incident date: ${item.incidentDate || "Not provided"}
Personal reference: ${item.id}

Description:
${item.description || "No description recorded."}

Evidence recorded:
${evidence}

${opening}

Please review the information above and advise on any applicable next steps.

Regards,
[Your name]
[Your contact details, if appropriate]

IMPORTANT: This is an editable draft based on a ClearTrail personal record. Verify all details before using it. The ClearTrail reference is not an official government complaint number. This draft has not been submitted.`;

  setActionDraft(draft);
}

function downloadCaseSummary() {
  if (!selectedCase) return;

  const item = selectedCase;

  const lines = [
    "CLEARTRAIL CASE SUMMARY",
    "=======================",
    "",
    `Record type: ${item.isDemo ? "Sample demo case" : "Personal record"}`,
    `Reference: ${item.id}`,
    `Title: ${item.title}`,
    `Category: ${item.category || "Not provided"}`,
    `Authority: ${item.authority || "Not provided"}`,
    `Status: ${item.status}`,
    `Location: ${item.location || "Not provided"}`,
    `Incident date: ${item.incidentDate || "Not provided"}`,
    `Follow-up date: ${item.deadline || "Not provided"}`,
    "",
    "DESCRIPTION",
    item.description || "No description recorded.",
    "",
    "EVIDENCE CHECKLIST",
    ...(item.evidence?.length
      ? item.evidence.map((entry) => `- ${entry}`)
      : ["No evidence items recorded."]),
    "",
    "CASE TIMELINE",
    ...(item.events?.length
      ? item.events.flatMap((entry) => [
          `${new Date(entry.date).toLocaleString("en-IN")} | ${entry.title}`,
          entry.details,
          "",
        ])
      : ["No timeline events recorded."]),
    "",
    "NOTICE",
    "This file contains information recorded in ClearTrail.",
    "It does not prove official submission or independently verify events.",
    "Demo cases contain sample information.",
  ];

  const blob = new Blob([lines.join("\n")], {
    type: "text/plain;charset=utf-8",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  const safeName = (item.title || "case")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  link.href = url;
  link.download = `cleartrail-${safeName || "case-summary"}.txt`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}
async function checkTimelineIntegrity() {
  if (!selectedCase) return;

  try {
    const result = await verifyHashChain(selectedCase.events || []);
    setIntegrityResult(result);
  } catch (error) {
    console.error("Timeline verification failed:", error);

    setIntegrityResult({
      status: "error",
      message: "Verification could not be completed in this browser.",
    });
  }
}
function simulateTimelineTampering() {
  if (!selectedCase || selectedCase.isDemo) return;

  const events = selectedCase.events || [];

  // Run the demo only on events that already have hashes.
  const fullyHashed = events.length > 0 &&
    events.every((item) => item.hash && item.previousHash);

  if (!fullyHashed) {
    setIntegrityResult({
      status: "unsealed",
      message: "Use a fully hashed personal timeline for this demo.",
    });
    return;
  }

  // Change only the displayed copy, not savedCases.
  const modifiedEvents = events.map((item, index) =>
    index === 0
      ? {
          ...item,
          details: `${item.details} [SIMULATED TAMPERING]`,
        }
      : item
  );

  setSelectedCase({
    ...selectedCase,
    events: modifiedEvents,
  });

  setTamperDemoActive(true);
  setIntegrityResult(null);
}

function restoreTimelineAfterDemo() {
  const originalCase = savedCases.find(
    (item) => item.id === selectedCase?.id
  );

  if (originalCase) {
    setSelectedCase(originalCase);
  }

  setTamperDemoActive(false);
  setIntegrityResult(null);
}
  function openHome() {
    setView("home");
    setNotice("");
    setSelectedCase(null);
  }

  function openTrack() {
    setView("track");
    setNotice("");
    setSelectedCase(null);
  }

  function openCreate() {
    setFormData(EMPTY_FORM);
    setNotice("");
    setView("create");
  }

  function statusClass(status) {
    if (status === "Resolved") return "status-blue";
    if (status === "Response pending") return "status-yellow";
    if (status === "In progress") return "status-green";
    return "status-blue";
  }

  function renderCaseList(cases) {
    if (cases.length === 0) {
      return (
        <div className="empty-state">
          <div className="empty-icon">▤</div>
          <h3>No saved records yet</h3>
          <p>Create your first complaint record to get started.</p>
          <button className="primary-button" onClick={openCreate}>
            + Create a complaint
          </button>
        </div>
      );
    }

    return (
      <div className="complaints-list">
        {cases.map((item) => (
          <button
            className="complaint-row"
            key={item.id}
            onClick={() => {
              setSelectedCase(item);
              setView("details");
              setNotice("");
            }}
          >
            <span className="complaint-icon">▤</span>

            <span className="complaint-info">
              <strong>{item.title}</strong>
              <span>
                {item.authority} · {item.id}
              </span>
            </span>

            <span className={`status-pill ${statusClass(item.status)}`}>
              {item.status}
            </span>

            <span className="row-arrow">›</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="brand-lockup">
          <div className="logo-mark">✓</div>
          <div className="brand-copy">
            <div className="brand-name">ClearTrail</div>
            <div className="brand-tagline">CITIZEN ACCOUNTABILITY</div>
          </div>
        </div>

        <nav className="nav-links" aria-label="Main navigation">
          <button
            className={view === "home" ? "nav-link active" : "nav-link"}
            onClick={openHome}
          >
            Home
          </button>
          <button
            className={view === "track" ? "nav-link active" : "nav-link"}
            onClick={openTrack}
          >
            Track complaints
          </button>
          <button
            className={view === "resources" ? "nav-link active" : "nav-link"}
            onClick={() => setView("resources")}
          >
            Resources
          </button>
          <button
            className={view === "about" ? "nav-link active" : "nav-link"}
            onClick={() => setView("about")}
          >
            About
          </button>
        </nav>

        <div className="profile-avatar" title="Demo profile">
          M
        </div>
      </header>

      <main className="main-content">
        {view === "home" && (
          <>
            <section className="hero-section">
              <div className="hero-copy">
                <p className="eyebrow">YOUR COMPLAINTS, YOUR NEXT STEP</p>
                <h1 className="hero-title">
                  Don't let your complaint go silent.
                </h1>
                <p className="hero-description">
                  Organize your complaint, preserve its history, and know what
                  action you can take next.
                </p>
                <button className="primary-button" onClick={openCreate}>
                  <span>＋</span> Create a complaint <span>→</span>
                </button>
              </div>

              <div className="hero-visual">
                <div className="document-illustration">
                  <div className="document-lines">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="document-shield">✓</div>
                </div>
                <p>Your complaint. Your record. Your next step.</p>
              </div>
            </section>

            <section className="feature-grid">
              <article className="feature-card">
                <span className="feature-icon green">▤</span>
                <h3>Case file</h3>
                <p>Keep your documents and complaint history in one place.</p>
              </article>

              <article className="feature-card">
                <span className="feature-icon yellow">◷</span>
                <h3>Stall alarm</h3>
                <p>Know when a follow-up action may be due.</p>
              </article>

              <article className="feature-card">
                <span className="feature-icon blue">➤</span>
                <h3>Action pack</h3>
                <p>Prepare reminders, appeals, and proof files.</p>
              </article>

              <article className="feature-card">
                <span className="feature-icon purple">⚖</span>
                <h3>Rights &amp; resources</h3>
                <p>Find helpful grievance and legal-aid resources.</p>
              </article>
            </section>
             <section className="alarm-section">
  <div className="alarm-heading">
    <div>
      <p className="eyebrow">FOLLOW-UP CHECK</p>
      <h2>Stall alarm</h2>
      <p>
        Checks your saved personal follow-up dates and recorded responses.
      </p>
    </div>

    <span className="alarm-count">
      {overdueCases.length} overdue
    </span>
  </div>

  {overdueCases.length > 0 ? (
    <div className="alarm-list">
      {overdueCases.map((item) => (
        <button
          className="alarm-case"
          key={item.id}
          onClick={() => {
            setSelectedCase(item);
            setView("details");
            setNotice("");
          }}
        >
          <span>
            <strong>{item.title}</strong>
            <small>
              {item.id} · Follow-up date: {item.deadline}
            </small>
          </span>

          <span className="alarm-label">Reminder overdue</span>
        </button>
      ))}
    </div>
  ) : (
    <div className="alarm-clear">
      <span className="alarm-check">✓</span>
      <div>
        <strong>No overdue follow-ups</strong>
        <p>
          Your saved personal reminders are up to date, or no follow-up
          dates have passed without a recorded response.
        </p>
      </div>
    </div>
  )}

  <p className="alarm-footnote">
    Personal reminders only. This is not an official deadline or a
    live government status check.
  </p>
</section>
            <section className="complaint-section">
              <div className="section-header">
                <div>
                  <h2>Your complaint records</h2>
                  <p>Open a record to see its details.</p>
                </div>
                <span className="demo-badge">DEMO DATA INCLUDED</span>
              </div>
              {renderCaseList(allCases)}
            </section>

            <section className="help-banner">
              <span className="help-icon">?</span>
              <div>
                <h2>Need help with the next step?</h2>
                <p>
                  Explore guidance for delayed complaints and available
                  resources.
                </p>
              </div>
              <button
                className="secondary-button"
                onClick={() => setView("resources")}
              >
                View guide →
              </button>
            </section>
          </>
        )}

        {view === "create" && (
          <section className="form-page">
            <button className="back-button" onClick={openHome}>
              ← Back to home
            </button>

            <div className="form-heading">
              <p className="eyebrow">COMPLAINT ASSISTANT</p>
              <h1>Create a complaint record</h1>
              <p>
                Organize the details so you can keep a clear personal record.
              </p>
            </div>

            <div className="form-notice">
              <strong>Personal record only</strong>
              <span>
                This form does not send anything to a government department.
                Avoid entering passwords, bank details, or other unnecessary
                sensitive information.
              </span>
            </div>

            <form className="complaint-form" onSubmit={saveComplaint}>
              <div className="form-grid">
                <label className="form-field full-width">
                  Complaint title *
                  <input
                    name="title"
                    value={formData.title}
                    onChange={updateField}
                    placeholder="e.g. Street light not working"
                    maxLength={120}
                    required
                  />
                </label>

                <label className="form-field">
                  Complaint category *
                  <select
                    name="category"
                    value={formData.category}
                    onChange={updateField}
                    required
                  >
                    <option value="">Choose a category</option>
                    <option>Roads and public works</option>
                    <option>Water supply</option>
                    <option>Electricity and street lights</option>
                    <option>Sanitation and waste</option>
                    <option>Public services</option>
                    <option>Other</option>
                  </select>
                </label>

                <label className="form-field">
                  Department or authority *
                  <input
                    name="authority"
                    value={formData.authority}
                    onChange={updateField}
                    placeholder="Name of the relevant department"
                    maxLength={150}
                    required
                  />
                </label>

                <label className="form-field full-width">
                  Location of the issue *
                  <input
                    name="location"
                    value={formData.location}
                    onChange={updateField}
                    placeholder="Area, street, or landmark"
                    maxLength={200}
                    required
                  />
                </label>

                <label className="form-field">
                  Date of incident
                  <input
                    type="date"
                    name="incidentDate"
                    value={formData.incidentDate}
                    onChange={updateField}
                  />
                </label>

                <label className="form-field">
                  Follow-up date (optional)
                  <input
                    type="date"
                    name="deadline"
                    value={formData.deadline}
                    onChange={updateField}
                  />
                  <small>
                    A personal reminder date, not an official deadline.
                  </small>
                </label>

                <label className="form-field full-width">
                  Describe the problem *
                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={updateField}
                    placeholder="What happened, when did it happen, and how does it affect people?"
                    rows={5}
                    maxLength={3000}
                    required
                  />
                </label>
              </div>

              <fieldset className="evidence-fieldset">
                <legend>Evidence checklist (optional)</legend>
                <p>Choose any evidence you have collected.</p>

                {[
                  "Photographs or videos",
                  "Copy of complaint or acknowledgement",
                  "Previous correspondence",
                  "Receipt or reference number",
                  "Witness or supporting details",
                ].map((item) => (
                  <label className="evidence-option" key={item}>
                    <input
                      type="checkbox"
                      checked={formData.evidence.includes(item)}
                      onChange={() => toggleEvidence(item)}
                    />
                    <span>{item}</span>
                  </label>
                ))}
              </fieldset>
              <div className="evidence-upload-block">
  <label className="form-field">
    Attach evidence files (optional)
    <input
      key={view}
      type="file"
      multiple
      accept="image/*,.pdf,.txt,.doc,.docx"
      onChange={handleEvidenceFileSelection}
    />
  </label>

  <p className="privacy-note">
    Up to 5 files, 10 MB each. Files are stored in this browser on this
    device, not uploaded to a server.
  </p>

  {selectedEvidenceFiles.length > 0 && (
    <ul className="attachment-list">
      {selectedEvidenceFiles.map((file, index) => (
        <li key={`${file.name}-${file.lastModified}-${index}`}>
          {file.name} · {(file.size / 1024).toFixed(0)} KB
        </li>
      ))}
    </ul>
  )}
</div>
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={openHome}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-button">
                  Save complaint →
                </button>
              </div>
            </form>
          </section>
        )}

        {view === "track" && (
          <section className="complaint-section page-section">
            <div className="section-header">
              <div>
                <p className="eyebrow">YOUR CASE FILE</p>
                <h1>Track your complaint records</h1>
                <p>
                  Review records saved on this device and example demo cases.
                </p>
              </div>
              <button className="primary-button" onClick={openCreate}>
                + New complaint
              </button>
            </div>
            {renderCaseList(allCases)}
            <p className="privacy-note">
              Demo cases are examples. Saved records stay in this browser and
              are not submitted to an authority.
            </p>
          </section>
        )}

        {view === "details" && selectedCase && (
          <section className="form-page">
            <button className="back-button" onClick={openTrack}>
              ← Back to records
            </button>

            <div className="form-heading">
              {isFollowUpOverdue(selectedCase) && (
  <div className="stall-warning">
    <strong>⚠ Follow-up reminder date has passed</strong>
    <p>
      No response is recorded in this case timeline. Review your
      records and consider the appropriate next step.
    </p>
    <small>
      This reminder is based on your saved date, not an official case status.
    </small>
  </div>
)}
              <p className="eyebrow">CASE FILE</p>
              <h1>{selectedCase.title}</h1>
              <p>Reference: {selectedCase.id}</p>
            </div>

            {notice && <div className="success-notice">✓ {notice}</div>}

            <div className="case-detail-card">
              <div className="detail-row">
                <span>Record type</span>
                <strong>
                  {selectedCase.isDemo ? "Sample demo case" : "Personal record"}
                </strong>
              </div>
              <div className="detail-row">
                <span>Department or authority</span>
                <strong>{selectedCase.authority}</strong>
              </div>
              <div className="detail-row">
                <span>Status</span>
                <strong>{selectedCase.status}</strong>
              </div>

              {selectedCase.category && (
                <div className="detail-row">
                  <span>Category</span>
                  <strong>{selectedCase.category}</strong>
                </div>
              )}
              {selectedCase.location && (
                <div className="detail-row">
                  <span>Location</span>
                  <strong>{selectedCase.location}</strong>
                </div>
              )}
              {selectedCase.incidentDate && (
                <div className="detail-row">
                  <span>Incident date</span>
                  <strong>{selectedCase.incidentDate}</strong>
                </div>
              )}
              {selectedCase.deadline && (
                <div className="detail-row">
                  <span>Personal follow-up date</span>
                  <strong>{selectedCase.deadline}</strong>
                </div>
              )}
              {selectedCase.description && (
                <div className="detail-description">
                  <span>Problem description</span>
                  <p>{selectedCase.description}</p>
                </div>
              )}
              {selectedCase.evidence?.length > 0 && (
                <div className="detail-description">
                  <span>Evidence checklist</span>
                  <ul>
                    {selectedCase.evidence.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {selectedCase.createdAt && (
                <div className="detail-row">
                  <span>Saved on</span>
                  <strong>{selectedCase.createdAt}</strong>
                </div>
              )}
            </div>

            <p className="privacy-note">
              This is a personal record in the local browser, not proof that an
              official complaint was submitted or accepted.
            </p>
            <section className="evidence-files-section">
  <p className="eyebrow">ATTACHED EVIDENCE</p>
  <h2>Evidence files</h2>

  {evidenceLoading ? (
    <p>Loading attachments...</p>
  ) : caseAttachments.length > 0 ? (
    <ul className="saved-attachment-list">
      {caseAttachments.map((attachment) => (
        <li key={attachment.id} className="saved-attachment-item">
  <div className="saved-attachment-info">
    <strong>{attachment.name}</strong>
    <small>{(attachment.size / 1024).toFixed(0)} KB</small>
  </div>

  <div className="saved-attachment-actions">
    <button
      type="button"
      className="secondary-button"
      onClick={() => verifyEvidenceAttachment(attachment)}
      disabled={evidenceChecks[attachment.id]?.status === "checking"}
    >
      {evidenceChecks[attachment.id]?.status === "checking"
        ? "Checking..."
        : "Verify file"}
    </button>

    <button
      type="button"
      className="secondary-button"
      onClick={() => downloadEvidenceFile(attachment)}
    >
      Download ↓
    </button>
  </div>

  {evidenceChecks[attachment.id] && (
    <div
      className={`evidence-check-result ${evidenceChecks[attachment.id].status}`}
      role="status"
    >
      {evidenceChecks[attachment.id].message}

      {evidenceChecks[attachment.id].status === "verified" &&
        attachment.sha256 && (
          <small className="fingerprint-text">
            SHA-256: {attachment.sha256}
          </small>
        )}
    </div>
  )}
</li>
      ))}
    </ul>
  ) : (
    <p className="privacy-note">
      No files are attached to this complaint yet.
    </p>
  )}
</section>
            <section className="action-pack-section">
  <p className="eyebrow">READY FOR YOUR NEXT STEP</p>
  <h2>Action Pack</h2>
  <p className="action-pack-description">
    Create an editable follow-up draft or download a copy of your case
    record and its timeline.
  </p>

  {selectedCase.isDemo ? (
    <p className="privacy-note">
      This is a sample case. Create a personal complaint record to use
      the Action Pack.
    </p>
  ) : (
    <>
      <label className="form-field">
        Choose a document
        <select
          value={draftType}
          onChange={(event) => {
            setDraftType(event.target.value);
            setActionDraft("");
          }}
        >
          <option value="reminder">Follow-up reminder</option>
          <option value="review">Request for review</option>
        </select>
      </label>

      <div className="action-pack-buttons">
        <button
          type="button"
          className="primary-button"
          onClick={generateActionDraft}
        >
          Generate editable draft →
        </button>

        <button
          type="button"
          className="secondary-button"
          onClick={downloadCaseSummary}
        >
          Download case summary ↓
        </button>
      </div>

      {actionDraft && (
        <div className="generated-draft">
          <label className="form-field">
            Your editable document
            <textarea
              rows={18}
              value={actionDraft}
              onChange={(event) => setActionDraft(event.target.value)}
            />
          </label>

          <p className="privacy-note">
            Review the facts, add any missing information, and check the
            relevant official procedure before using this draft.
          </p>

          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              navigator.clipboard.writeText(actionDraft);
              setNotice("Draft copied. You can now paste it into a document.");
            }}
          >
            Copy draft
          </button>
        </div>
      )}
    </>
  )}
</section>
             <section className="timeline-section">
  <p className="eyebrow">CASE HISTORY</p>
  <h2>Case timeline</h2>
  <p className="timeline-intro">
    Record what happened and keep your follow-up history together.
  </p>
   <div className="integrity-controls">
  <button
    type="button"
    className="secondary-button"
    onClick={checkTimelineIntegrity}
  >
    🔐 Verify timeline integrity
  </button>
  {!selectedCase.isDemo &&
  selectedCase.events?.length > 0 &&
  selectedCase.events.every(
    (item) => item.hash && item.previousHash
  ) && (
    <button
      type="button"
      className="secondary-button"
      onClick={
        tamperDemoActive
          ? restoreTimelineAfterDemo
          : simulateTimelineTampering
      }
    >
      {tamperDemoActive
        ? "↩ Restore original timeline"
        : "🧪 Simulate tampering (demo)"}
    </button>
  )}
  {integrityResult && (
    <div
      className={`integrity-result ${integrityResult.status}`}
      role="status"
    >
      <strong>
        {integrityResult.status === "verified"
          ? "✓ Integrity verified"
          : integrityResult.status === "unsealed"
            ? "Not yet hashed"
            : integrityResult.status === "empty"
              ? "No events to verify"
              : "Verification issue"}
      </strong>

      <p>{integrityResult.message}</p>
    </div>
  )}
</div>
  {selectedCase.events?.length > 0 ? (
    <ol className="timeline-list">
      {selectedCase.events.map((item) => (
        <li className="timeline-item" key={item.id}>
          <span className="timeline-dot" />

          <div className="timeline-event">
            <strong>{item.title}</strong>
            <time dateTime={item.date}>
              {new Date(item.date).toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </time>
            <p>{item.details}</p>
          </div>
        </li>
      ))}
    </ol>
  ) : (
    <p className="timeline-empty">
      No timeline events have been recorded for this case yet.
    </p>
  )}

  {!selectedCase.isDemo ? (
    <form className="timeline-form" onSubmit={addCaseEvent}>
      <h3>Add a timeline update</h3>

      <label className="form-field">
        Event type
        <select
          value={eventTitle}
          onChange={(event) => setEventTitle(event.target.value)}
        >
          <option>Follow-up action recorded</option>
          <option>Evidence gathered</option>
          <option>Reminder sent</option>
          <option>Response received</option>
          <option>Other update</option>
        </select>
      </label>

      <label className="form-field">
        Notes
        <textarea
          rows={3}
          value={eventDetails}
          onChange={(event) => setEventDetails(event.target.value)}
          placeholder="Describe the action or response. Only record what actually happened."
          maxLength={1500}
        />
      </label>

      <button type="submit" className="primary-button">
        Add to timeline →
      </button>
    </form>
  ) : (
    <p className="privacy-note">
      This is a sample demo case. Timeline updates are enabled for
      personal records only.
    </p>
  )}
</section>
            <button className="primary-button" onClick={openCreate}>
              + Create another complaint
            </button>
          </section>
        )}

        {view === "resources" && (
          <section className="form-page">
            <button className="back-button" onClick={openHome}>
              ← Back to home
            </button>
            <div className="form-heading">
              <p className="eyebrow">KNOW YOUR NEXT STEP</p>
              <h1>Rights &amp; resources</h1>
              <p>Use official channels for current procedures and guidance.</p>
            </div>

            <div className="resource-card">
              <h3>CPGRAMS · Central Government grievances</h3>
              <p>
                The official portal for eligible grievances concerning central
                government departments and other participating organizations.
              </p>
              <a href="https://pgportal.gov.in/" target="_blank" rel="noreferrer">
                Visit CPGRAMS ↗
              </a>
            </div>
            <div className="resource-card">
              <h3>NALSA · Legal aid</h3>
              <p>
                Find information about legal services and legal-aid support in
                India.
              </p>
              <a
                href="https://nalsa.gov.in/"
                target="_blank"
                rel="noreferrer"
              >
                Visit NALSA ↗
              </a>
            </div>
            <p className="privacy-note">
              The correct authority and available procedure depend on your
              issue. Check each official portal for eligibility and current
              instructions.
            </p>
          </section>
        )}

        {view === "about" && (
          <section className="form-page">
            <button className="back-button" onClick={openHome}>
              ← Back to home
            </button>
            <div className="form-heading">
              <p className="eyebrow">ABOUT CLEARTRAIL</p>
              <h1>Your complaint. Your record. Your next step.</h1>
              <p>
                ClearTrail helps people organize complaint details, keep their
                own records, and prepare for possible follow-up.
              </p>
            </div>
            <div className="form-notice">
              <strong>Prototype limitations</strong>
              <span>
                This prototype does not connect to government databases, verify
                official case status, or send complaints. Demo cases are
                simulated. Saved records are stored in your browser.
              </span>
            </div>
          </section>
        )}
      </main>

      <footer className="site-footer">
        <span>ClearTrail · Citizen accountability</span>
        <span>Demo environment · No live government integration</span>
      </footer>
    </div>
  );
}

export default App;