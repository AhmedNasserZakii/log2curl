"use strict";
(() => {
  // src/webview/main.ts
  var vscode = acquireVsCodeApi();
  var savedUi = vscode.getState();
  var draft;
  var response;
  var dirty = false;
  var running = false;
  var candidate;
  var environments = [];
  var activeEnvironmentId;
  var history = [];
  var savedRequests = [];
  var hydration;
  var requestTab = savedUi?.requestTab ?? "params";
  var responseTab = savedUi?.responseTab ?? "body";
  function element(tag, options = {}) {
    const node = document.createElement(tag);
    if (options.className) {
      node.className = options.className;
    }
    if (options.text !== void 0) {
      node.textContent = options.text;
    }
    if (options.id) {
      node.id = options.id;
    }
    return node;
  }
  function button(text, className = "button secondary") {
    const node = element("button", { text, className });
    node.type = "button";
    return node;
  }
  function required(id) {
    const node = document.getElementById(id);
    if (!node) {
      throw new Error(`Missing Request Studio element: ${id}`);
    }
    return node;
  }
  function newId() {
    return crypto.randomUUID();
  }
  function sensitiveHeaderName(name) {
    const normalized = name.trim().toLowerCase();
    return normalized === "authorization" || normalized === "proxy-authorization" || normalized === "cookie" || normalized === "set-cookie" || /api[-_]?key|apikey|token|secret|credential/i.test(normalized);
  }
  function emptyDraft() {
    return {
      id: newId(),
      method: "GET",
      url: "https://",
      query: [],
      headers: [],
      body: { mode: "none", text: "" },
      importedAt: Date.now()
    };
  }
  function buildShell() {
    const app = required("app");
    const header = element("header", { className: "app-header" });
    const titleWrap = element("div");
    titleWrap.append(
      element("h1", { text: "Log2Curl Request Studio" }),
      element("p", { text: "Import a log, edit the request, and inspect the response." })
    );
    const headerActions = element("div", { className: "header-actions" });
    const importButton = button("Import Clipboard");
    importButton.id = "importClipboard";
    const importFileButton = button("Import File");
    importFileButton.id = "importFile";
    const exportButton = button("Export");
    exportButton.id = "exportDraft";
    headerActions.append(importButton, importFileButton, exportButton);
    header.append(titleWrap, headerActions);
    const notice = element("div", { id: "notice", className: "notice hidden" });
    const candidateNotice = element("div", { id: "candidateNotice", className: "candidate hidden" });
    const candidateText = element("span", { text: "A new request was detected in the clipboard." });
    const candidateImport = button("Import", "button primary small");
    candidateImport.id = "candidateImport";
    const candidateDismiss = button("Dismiss", "button ghost small");
    candidateDismiss.id = "candidateDismiss";
    candidateNotice.append(candidateText, candidateImport, candidateDismiss);
    const safetyBar = element("div", { className: "safety-bar" });
    safetyBar.append(
      element("span", { id: "executionLocation", text: "Running from: \u2026" }),
      element("span", { id: "trustState", text: "Checking Workspace Trust\u2026" }),
      element("span", { id: "draftState", className: "badge", text: "Empty" }),
      element("span", { id: "autoRunBadge", className: "badge hidden", text: "AUTO-RUN ON" })
    );
    const disableAuto = button("Disable auto-run", "button danger small hidden");
    disableAuto.id = "disableAutoRun";
    safetyBar.append(disableAuto);
    const toolbar = element("section", { className: "request-toolbar" });
    const method = element("select", { id: "method" });
    method.setAttribute("aria-label", "HTTP method");
    for (const value of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      const option = element("option", { text: value });
      option.value = value;
      method.append(option);
    }
    const url = element("input", { id: "url" });
    url.type = "url";
    url.placeholder = "https://api.example.com/resource";
    url.setAttribute("aria-label", "Request URL");
    const run = button("Run", "button primary");
    run.id = "runRequest";
    const cancel = button("Cancel", "button danger hidden");
    cancel.id = "cancelRequest";
    const copyCurl2 = button("Copy cURL");
    copyCurl2.id = "copyCurl";
    const duplicate = button("Duplicate");
    duplicate.id = "duplicateRequest";
    toolbar.append(method, url, run, cancel, copyCurl2, duplicate);
    const urlPreview = element("div", { id: "urlPreview", className: "url-preview" });
    const workspace = element("main", { className: "workspace-grid" });
    const requestSection = element("section", { className: "card request-card" });
    requestSection.append(
      tabBar("request", [
        ["params", "Params"],
        ["headers", "Headers"],
        ["body", "Body"],
        ["curl", "cURL"],
        ["source", "Source Log"]
      ]),
      tabPanel("request", "params"),
      tabPanel("request", "headers"),
      tabPanel("request", "body"),
      tabPanel("request", "curl"),
      tabPanel("request", "source")
    );
    workspace.append(requestSection);
    const responseSection = element("section", { className: "card response-card" });
    responseSection.append(
      element("div", { id: "responseSummary", className: "response-summary", text: "No response yet" }),
      tabBar("response", [
        ["body", "Body"],
        ["headers", "Headers"],
        ["raw", "Raw"],
        ["error", "Error"]
      ]),
      tabPanel("response", "body"),
      tabPanel("response", "headers"),
      tabPanel("response", "raw"),
      tabPanel("response", "error")
    );
    workspace.append(responseSection);
    const utilities = element("aside", { className: "utilities" });
    utilities.append(
      savedRequestsSection(),
      environmentSection(),
      historySection(),
      privacySection()
    );
    app.append(header, notice, candidateNotice, safetyBar, toolbar, urlPreview, workspace, utilities);
    buildRequestPanels();
    buildResponsePanels();
    bindStaticEvents();
    selectTab("request", requestTab);
    selectTab("response", responseTab);
  }
  function tabBar(group, tabs) {
    const bar = element("div", { className: "tabs" });
    bar.setAttribute("role", "tablist");
    for (const [id, label] of tabs) {
      const tab = button(label, "tab");
      tab.dataset.group = group;
      tab.dataset.tab = id;
      tab.setAttribute("role", "tab");
      tab.addEventListener("click", () => selectTab(group, id));
      bar.append(tab);
    }
    return bar;
  }
  function tabPanel(group, id) {
    const panel2 = element("div", { className: "tab-panel" });
    panel2.dataset.groupPanel = group;
    panel2.dataset.panel = id;
    panel2.setAttribute("role", "tabpanel");
    return panel2;
  }
  function selectTab(group, id) {
    document.querySelectorAll(`[data-group="${group}"]`).forEach((tab) => {
      const active = tab.dataset.tab === id;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(`[data-group-panel="${group}"]`).forEach((panel2) => {
      panel2.classList.toggle("active", panel2.dataset.panel === id);
    });
    if (group === "request") {
      requestTab = id;
    } else {
      responseTab = id;
    }
    vscode.setState({ requestTab, responseTab });
  }
  function panel(group, id) {
    const node = document.querySelector(
      `[data-group-panel="${group}"][data-panel="${id}"]`
    );
    if (!node) {
      throw new Error(`Missing ${group}/${id} panel`);
    }
    return node;
  }
  function buildRequestPanels() {
    const params = panel("request", "params");
    const paramsList = element("div", { id: "paramsList", className: "pair-list" });
    const addParam = button("+ Add parameter", "button secondary small");
    addParam.id = "addParam";
    params.append(paramsList, addParam);
    const headers = panel("request", "headers");
    const headersList = element("div", { id: "headersList", className: "pair-list" });
    const addHeader = button("+ Add header", "button secondary small");
    addHeader.id = "addHeader";
    headers.append(headersList, addHeader);
    const body = panel("request", "body");
    const bodyToolbar = element("div", { className: "body-toolbar" });
    const mode = element("select", { id: "bodyMode" });
    mode.setAttribute("aria-label", "Request body mode");
    for (const [value, label] of [
      ["none", "None"],
      ["json", "JSON"],
      ["text", "Raw text"],
      ["form", "Form URL encoded"]
    ]) {
      const option = element("option", { text: label });
      option.value = value;
      mode.append(option);
    }
    const format = button("Format JSON", "button secondary small");
    format.id = "formatJson";
    const validation = element("span", { id: "bodyValidation", className: "validation" });
    bodyToolbar.append(mode, format, validation);
    const textarea = element("textarea", { id: "bodyText", className: "code-editor" });
    textarea.spellcheck = false;
    textarea.setAttribute("aria-label", "Request body");
    body.append(bodyToolbar, textarea);
    const curl = panel("request", "curl");
    const curlActions = element("div", { className: "inline-actions" });
    const curlCopy = button("Copy cURL", "button secondary small");
    curlCopy.id = "copyCurlTab";
    curlActions.append(curlCopy);
    const curlText = element("textarea", { id: "curlPreview", className: "code-editor" });
    curlText.readOnly = true;
    curlText.setAttribute("aria-label", "Generated cURL");
    curl.append(curlActions, curlText);
    const source = panel("request", "source");
    source.append(element("pre", { id: "sourceLog", className: "source-log", text: "No source log." }));
  }
  function buildResponsePanels() {
    const body = panel("response", "body");
    const actions = element("div", { className: "inline-actions" });
    const search = element("input", { id: "responseSearch" });
    search.type = "search";
    search.placeholder = "Search response";
    search.setAttribute("aria-label", "Search response");
    const copy = button("Copy", "button secondary small");
    copy.id = "copyResponse";
    const save = button("Save", "button secondary small");
    save.id = "saveResponse";
    actions.append(search, copy, save);
    body.append(actions, element("pre", { id: "responseBody", className: "response-body", text: "Run a request to see its response." }));
    panel("response", "headers").append(
      element("div", { id: "responseHeaders", className: "pair-list readonly" })
    );
    panel("response", "raw").append(
      element("pre", { id: "responseRaw", className: "response-body" })
    );
    panel("response", "error").append(
      element("div", { id: "responseError", className: "error-panel", text: "No network error." })
    );
  }
  function environmentSection() {
    const section = element("section", { className: "card utility-card" });
    section.append(element("h2", { text: "Environment" }));
    const row = element("div", { className: "inline-actions" });
    const select = element("select", { id: "environmentSelect" });
    select.setAttribute("aria-label", "Active environment");
    const none = element("option", { text: "No environment" });
    none.value = "";
    select.append(none);
    const create = button("New", "button secondary small");
    create.id = "newEnvironment";
    const edit = button("Edit", "button secondary small");
    edit.id = "editEnvironment";
    row.append(select, create, edit);
    const editor = element("div", { id: "environmentEditor", className: "environment-editor hidden" });
    section.append(row, editor);
    return section;
  }
  function savedRequestsSection() {
    const section = element("section", { className: "card utility-card" });
    const header = element("div", { className: "utility-header" });
    header.append(
      element("h2", { text: "Saved Requests" }),
      Object.assign(button("Save current", "button secondary small"), { id: "saveNamedRequest" })
    );
    section.append(header, element("div", { id: "savedRequestsList", className: "history-list" }));
    return section;
  }
  function historySection() {
    const section = element("section", { className: "card utility-card" });
    const header = element("div", { className: "utility-header" });
    header.append(
      element("h2", { text: "Redacted History" }),
      Object.assign(button("Export", "button ghost small"), { id: "exportHistory" }),
      Object.assign(button("Clear", "button ghost small"), { id: "clearHistory" })
    );
    section.append(header, element("div", { id: "historyList", className: "history-list" }));
    return section;
  }
  function privacySection() {
    const section = element("section", { className: "card utility-card" });
    section.append(
      element("h2", { text: "Privacy & Storage" }),
      element("p", {
        className: "empty-copy",
        text: "Remove redacted history, saved requests, environments, and encrypted secrets."
      })
    );
    const clear = button("Clear Stored Data", "button danger small");
    clear.id = "clearStoredData";
    section.append(clear);
    return section;
  }
  function bindStaticEvents() {
    required("importClipboard").addEventListener("click", () => vscode.postMessage({ type: "importClipboard" }));
    required("importFile").addEventListener("click", () => vscode.postMessage({ type: "importDraft" }));
    required("exportDraft").addEventListener("click", () => draft && vscode.postMessage({ type: "exportDraft", draft }));
    required("candidateImport").addEventListener("click", () => {
      if (dirty && !window.confirm("Replace your edited request with the clipboard request?")) {
        return;
      }
      vscode.postMessage({ type: "acceptClipboardCandidate" });
      hideCandidate();
    });
    required("candidateDismiss").addEventListener("click", hideCandidate);
    required("disableAutoRun").addEventListener("click", () => vscode.postMessage({ type: "disableAutoRun" }));
    required("runRequest").addEventListener("click", runRequest);
    required("cancelRequest").addEventListener("click", () => vscode.postMessage({ type: "cancelRequest" }));
    required("copyCurl").addEventListener("click", copyCurl);
    required("copyCurlTab").addEventListener("click", copyCurl);
    required("duplicateRequest").addEventListener("click", duplicateRequest);
    required("saveNamedRequest").addEventListener("click", () => {
      if (!draft) {
        return;
      }
      const name = window.prompt("Name this request", draft.name ?? `${draft.method} request`)?.trim();
      if (name) {
        vscode.postMessage({ type: "saveNamedRequest", draft, name });
      }
    });
    required("method").addEventListener("change", updateFromControls);
    required("url").addEventListener("input", updateFromControls);
    required("bodyMode").addEventListener("change", updateFromControls);
    required("bodyText").addEventListener("input", updateFromControls);
    required("formatJson").addEventListener("click", formatJson);
    required("addParam").addEventListener("click", () => addPair("query"));
    required("addHeader").addEventListener("click", () => addPair("headers"));
    required("copyResponse").addEventListener("click", () => response && vscode.postMessage({ type: "copyResponse", text: response.bodyText }));
    required("saveResponse").addEventListener("click", () => response && vscode.postMessage({ type: "saveResponse", text: response.bodyText, contentType: response.contentType }));
    required("responseSearch").addEventListener("input", renderResponseBody);
    required("clearHistory").addEventListener("click", () => {
      if (window.confirm("Clear all redacted request history?")) {
        vscode.postMessage({ type: "clearHistory" });
      }
    });
    required("clearStoredData").addEventListener("click", () => {
      if (window.confirm("Permanently clear all Request Studio data stored by this extension?")) {
        vscode.postMessage({ type: "clearStoredData" });
      }
    });
    required("exportHistory").addEventListener("click", () => {
      vscode.postMessage({ type: "exportHistory" });
    });
    required("environmentSelect").addEventListener("change", (event) => {
      const environmentId = event.target.value || void 0;
      activeEnvironmentId = environmentId;
      vscode.postMessage({ type: "selectEnvironment", environmentId });
    });
    required("newEnvironment").addEventListener("click", () => editEnvironment({
      id: newId(),
      name: "New Environment",
      variables: []
    }));
    required("editEnvironment").addEventListener("click", () => {
      const selected = environments.find((item) => item.id === activeEnvironmentId);
      if (selected) {
        editEnvironment(structuredClone(selected));
      }
    });
    window.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        runRequest();
      }
    });
  }
  function loadDraft(next, clearExistingResponse = true) {
    if (clearExistingResponse) {
      clearResponse();
    }
    draft = structuredClone(next);
    dirty = false;
    required("draftState").textContent = "Parsed";
    required("method").value = draft.method;
    required("url").value = draft.url;
    required("bodyMode").value = draft.body.mode;
    required("bodyText").value = draft.body.text;
    required("sourceLog").textContent = draft.sourceLog ?? "No source log.";
    renderPairs("query");
    renderPairs("headers");
    validateBody();
    updateUrlPreview();
    requestCurlPreview();
    setNotice("info", "Request imported. Review it, then select Run.");
  }
  function updateFromControls() {
    if (!draft) {
      draft = emptyDraft();
    }
    draft.method = required("method").value;
    draft.url = required("url").value;
    draft.body.mode = required("bodyMode").value;
    draft.body.text = required("bodyText").value;
    dirty = true;
    required("draftState").textContent = "Modified";
    validateBody();
    updateUrlPreview();
    vscode.postMessage({ type: "updateDraft", draft });
    requestCurlPreview();
  }
  function renderPairs(kind) {
    const container = required(kind === "query" ? "paramsList" : "headersList");
    container.replaceChildren();
    const pairs = draft?.[kind] ?? [];
    if (pairs.length === 0) {
      container.append(element("p", { className: "empty-copy", text: `No ${kind === "query" ? "parameters" : "headers"}.` }));
      return;
    }
    for (const pair of pairs) {
      container.append(pairRow(kind, pair));
    }
  }
  function pairRow(kind, pair) {
    const row = element("div", { className: "pair-row" });
    const enabled = element("input");
    enabled.type = "checkbox";
    enabled.checked = pair.enabled;
    enabled.setAttribute("aria-label", `Enable ${pair.name || kind}`);
    const name = element("input");
    name.value = pair.name;
    name.placeholder = "Name";
    name.setAttribute("aria-label", `${kind} name`);
    const value = element("input");
    value.value = pair.value;
    value.placeholder = "Value";
    value.type = pair.sensitive ? "password" : "text";
    value.setAttribute("aria-label", `${pair.name || kind} value`);
    const reveal = button(pair.sensitive ? "Reveal" : "", "button ghost tiny");
    reveal.setAttribute("aria-label", `Reveal ${pair.name || "header"} value`);
    reveal.disabled = !pair.sensitive;
    reveal.tabIndex = pair.sensitive ? 0 : -1;
    if (!pair.sensitive) {
      reveal.classList.add("invisible");
    }
    reveal.addEventListener("click", () => {
      value.type = value.type === "password" ? "text" : "password";
      reveal.textContent = value.type === "password" ? "Reveal" : "Mask";
    });
    const remove = button("Remove", "button ghost tiny");
    const commit = () => {
      pair.enabled = enabled.checked;
      pair.name = name.value;
      pair.value = value.value;
      if (kind === "headers") {
        pair.sensitive = sensitiveHeaderName(pair.name);
        value.type = pair.sensitive ? "password" : "text";
        reveal.textContent = pair.sensitive ? "Reveal" : "";
        reveal.classList.toggle("invisible", !pair.sensitive);
        reveal.disabled = !pair.sensitive;
        reveal.tabIndex = pair.sensitive ? 0 : -1;
        reveal.setAttribute("aria-label", `Reveal ${pair.name || "header"} value`);
      }
      dirty = true;
      required("draftState").textContent = "Modified";
      updateUrlPreview();
      if (draft) {
        vscode.postMessage({ type: "updateDraft", draft });
      }
      requestCurlPreview();
    };
    enabled.addEventListener("change", commit);
    name.addEventListener("input", commit);
    value.addEventListener("input", commit);
    remove.addEventListener("click", () => {
      if (!draft) {
        return;
      }
      draft[kind] = draft[kind].filter((item) => item.id !== pair.id);
      dirty = true;
      required("draftState").textContent = "Modified";
      renderPairs(kind);
      updateUrlPreview();
      vscode.postMessage({ type: "updateDraft", draft });
      requestCurlPreview();
    });
    row.append(enabled, name, value, reveal, remove);
    return row;
  }
  function addPair(kind) {
    if (!draft) {
      draft = emptyDraft();
    }
    draft[kind].push({ id: newId(), name: "", value: "", enabled: true });
    dirty = true;
    required("draftState").textContent = "Modified";
    renderPairs(kind);
    vscode.postMessage({ type: "updateDraft", draft });
  }
  function updateUrlPreview() {
    const preview = required("urlPreview");
    if (!draft) {
      preview.textContent = "";
      return;
    }
    try {
      const url = new URL(draft.url);
      url.search = "";
      for (const pair of draft.query.filter((item) => item.enabled && item.name)) {
        url.searchParams.append(pair.name, pair.value);
      }
      preview.textContent = `Final URL: ${url.toString()}`;
    } catch {
      preview.textContent = "Final URL: invalid URL";
    }
  }
  function validateBody() {
    const validation = required("bodyValidation");
    const format = required("formatJson");
    if (!draft || draft.body.mode !== "json") {
      validation.textContent = "";
      format.classList.toggle("hidden", draft?.body.mode !== "json");
      return true;
    }
    format.classList.remove("hidden");
    try {
      JSON.parse(draft.body.text);
      validation.textContent = "Valid JSON";
      validation.className = "validation valid";
      return true;
    } catch {
      validation.textContent = "Invalid JSON";
      validation.className = "validation invalid";
      return false;
    }
  }
  function formatJson() {
    if (!draft || draft.body.mode !== "json") {
      return;
    }
    try {
      draft.body.text = JSON.stringify(JSON.parse(draft.body.text), null, 2);
      required("bodyText").value = draft.body.text;
      updateFromControls();
    } catch {
      setNotice("error", "Fix invalid JSON before formatting.");
    }
  }
  function runRequest() {
    if (!draft || running) {
      return;
    }
    updateFromControls();
    if (!validateBody()) {
      setNotice("error", "Fix the JSON body or switch to Raw text before running.");
      selectTab("request", "body");
      return;
    }
    vscode.postMessage({ type: "runRequest", draft });
  }
  function copyCurl() {
    if (draft) {
      vscode.postMessage({ type: "copyCurl", draft });
    }
  }
  function duplicateRequest() {
    if (!draft) {
      return;
    }
    const copy = structuredClone(draft);
    copy.id = newId();
    copy.name = `${draft.name ?? "Request"} copy`;
    copy.importedAt = Date.now();
    loadDraft(copy);
    dirty = true;
    required("draftState").textContent = "Modified";
    vscode.postMessage({ type: "updateDraft", draft: copy, clearResponse: true });
  }
  var curlTimer;
  function requestCurlPreview() {
    if (!draft) {
      return;
    }
    window.clearTimeout(curlTimer);
    curlTimer = window.setTimeout(() => {
      if (draft) {
        vscode.postMessage({ type: "previewCurl", draft });
      }
    }, 180);
  }
  function setRunning(next) {
    running = next;
    required("runRequest").disabled = next;
    required("cancelRequest").classList.toggle("hidden", !next);
  }
  function clearResponse() {
    response = void 0;
    required("responseSummary").className = "response-summary";
    required("responseSummary").textContent = "No response yet";
    required("responseBody").textContent = "Run a request to see its response.";
    required("responseHeaders").replaceChildren();
    required("responseRaw").textContent = "";
    required("responseError").textContent = "No network error.";
    required("responseSearch").value = "";
  }
  function renderResponse(next) {
    response = next;
    setRunning(false);
    const statusClass = next.status >= 200 && next.status < 400 ? "success" : "http-error";
    const summary = required("responseSummary");
    summary.className = `response-summary ${statusClass}`;
    summary.textContent = `${next.status} ${next.statusText || ""} \xB7 ${next.durationMs} ms \xB7 ${formatBytes(next.sizeBytes)} \xB7 ${next.redirectCount} redirect(s)${next.truncated ? " \xB7 truncated" : ""} \xB7 ${new Date(next.receivedAt).toLocaleString()} \xB7 ${next.finalUrl}`;
    required("responseError").textContent = "No network error.";
    renderResponseBody();
    renderResponseHeaders();
    required("responseRaw").textContent = rawResponse(next);
    selectTab("response", "body");
  }
  function renderResponseBody() {
    const target = required("responseBody");
    if (!response) {
      return;
    }
    let text = response.bodyText;
    if (response.contentType?.includes("json")) {
      try {
        text = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
      }
    }
    const query = required("responseSearch").value.toLowerCase();
    if (query) {
      const lines = text.split("\n").filter((line) => line.toLowerCase().includes(query));
      target.textContent = lines.length ? lines.join("\n") : "No matching lines.";
    } else {
      target.textContent = text || "(empty response body)";
    }
  }
  function renderResponseHeaders() {
    const target = required("responseHeaders");
    target.replaceChildren();
    for (const header of response?.headers ?? []) {
      const row = element("div", { className: "readonly-pair" });
      const value = element("code", {
        text: header.sensitive ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : header.value
      });
      row.append(
        element("strong", { text: header.name }),
        value
      );
      if (header.sensitive) {
        const reveal = button("Reveal", "button ghost tiny");
        reveal.addEventListener("click", () => {
          const revealed = value.textContent === header.value;
          value.textContent = revealed ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : header.value;
          reveal.textContent = revealed ? "Reveal" : "Mask";
        });
        row.append(reveal);
      }
      target.append(row);
    }
  }
  function rawResponse(value) {
    const headers = value.headers.map(
      (header) => `${header.name}: ${header.sensitive ? "[masked]" : header.value}`
    ).join("\n");
    return `HTTP ${value.status} ${value.statusText}
${headers}

${value.bodyText}`;
  }
  function formatBytes(bytes) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KiB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }
  function renderHistory() {
    const target = required("historyList");
    target.replaceChildren();
    if (history.length === 0) {
      target.append(element("p", { className: "empty-copy", text: "History is empty or persistence is disabled." }));
      return;
    }
    for (const item of history) {
      const row = element("div", { className: "history-row" });
      const remove = button("Delete", "button ghost tiny");
      remove.addEventListener("click", () => {
        vscode.postMessage({ type: "deleteHistoryEntry", entryId: item.id });
      });
      row.append(
        element("strong", { text: item.method }),
        element("span", { text: `${item.origin}${item.path}` }),
        element("span", { text: item.status ? String(item.status) : "\u2014" }),
        element("time", { text: new Date(item.executedAt).toLocaleString() }),
        remove
      );
      target.append(row);
    }
  }
  function renderSavedRequests() {
    const target = required("savedRequestsList");
    target.replaceChildren();
    if (savedRequests.length === 0) {
      target.append(element("p", { className: "empty-copy", text: "No saved requests yet." }));
      return;
    }
    for (const item of savedRequests) {
      const row = element("div", { className: "history-row saved-request-row" });
      const load = button("Load", "button secondary tiny");
      load.addEventListener("click", () => {
        if (dirty && !window.confirm("Replace your edited request with this saved request?")) {
          return;
        }
        vscode.postMessage({ type: "loadNamedRequest", requestId: item.id });
      });
      const remove = button("Delete", "button ghost tiny");
      remove.addEventListener("click", () => {
        if (window.confirm(`Delete saved request \u201C${item.name ?? item.method}\u201D?`)) {
          vscode.postMessage({ type: "deleteNamedRequest", requestId: item.id });
        }
      });
      row.append(
        element("strong", { text: item.name ?? `${item.method} request` }),
        element("span", { text: item.method }),
        load,
        remove
      );
      target.append(row);
    }
  }
  function renderEnvironments() {
    const select = required("environmentSelect");
    select.replaceChildren();
    const none = element("option", { text: "No environment" });
    none.value = "";
    select.append(none);
    for (const environment of environments) {
      const option = element("option", { text: environment.name });
      option.value = environment.id;
      select.append(option);
    }
    select.value = activeEnvironmentId ?? "";
    required("editEnvironment").disabled = !activeEnvironmentId;
  }
  function editEnvironment(environment) {
    const editor = required("environmentEditor");
    editor.classList.remove("hidden");
    editor.replaceChildren();
    const name = element("input");
    name.value = environment.name;
    name.placeholder = "Environment name";
    name.setAttribute("aria-label", "Environment name");
    const variables = element("div", { className: "pair-list" });
    const renderVariables = () => {
      variables.replaceChildren();
      for (const variable of environment.variables) {
        const row = element("div", { className: "environment-variable" });
        const enabled = element("input");
        enabled.type = "checkbox";
        enabled.checked = variable.enabled;
        enabled.setAttribute("aria-label", `Enable ${variable.name || "environment variable"}`);
        const variableName = element("input");
        variableName.value = variable.name;
        variableName.placeholder = "Variable";
        variableName.setAttribute("aria-label", "Environment variable name");
        const variableValue = element("input");
        variableValue.value = variable.value;
        variableValue.type = variable.secret ? "password" : "text";
        variableValue.placeholder = "Value";
        variableValue.setAttribute("aria-label", `${variable.name || "Environment variable"} value`);
        const secret = element("input");
        secret.type = "checkbox";
        secret.checked = variable.secret;
        secret.title = "Store as encrypted secret";
        secret.setAttribute("aria-label", `Store ${variable.name || "environment variable"} as secret`);
        const remove2 = button("Remove", "button ghost tiny");
        enabled.addEventListener("change", () => variable.enabled = enabled.checked);
        variableName.addEventListener("input", () => variable.name = variableName.value);
        variableValue.addEventListener("input", () => variable.value = variableValue.value);
        secret.addEventListener("change", () => {
          variable.secret = secret.checked;
          variableValue.type = variable.secret ? "password" : "text";
        });
        remove2.addEventListener("click", () => {
          environment.variables = environment.variables.filter((item) => item.id !== variable.id);
          renderVariables();
        });
        row.append(enabled, variableName, variableValue, labeledControl(secret, "Secret"), remove2);
        variables.append(row);
      }
    };
    renderVariables();
    const add = button("+ Add variable", "button secondary small");
    add.addEventListener("click", () => {
      environment.variables.push({
        id: newId(),
        name: "",
        value: "",
        enabled: true,
        secret: false
      });
      renderVariables();
    });
    const save = button("Save Environment", "button primary small");
    save.addEventListener("click", () => {
      environment.name = name.value.trim() || "Environment";
      vscode.postMessage({ type: "saveEnvironment", environment });
      activeEnvironmentId = environment.id;
      vscode.postMessage({ type: "selectEnvironment", environmentId: environment.id });
      editor.classList.add("hidden");
    });
    const remove = button("Delete", "button danger small");
    remove.addEventListener("click", () => {
      if (window.confirm(`Delete environment \u201C${environment.name}\u201D?`)) {
        vscode.postMessage({ type: "deleteEnvironment", environmentId: environment.id });
        editor.classList.add("hidden");
      }
    });
    const close = button("Cancel", "button ghost small");
    close.addEventListener("click", () => editor.classList.add("hidden"));
    editor.append(name, variables, add, element("div", { className: "spacer" }), save, remove, close);
  }
  function labeledControl(control, text) {
    const label = element("label", { className: "inline-label" });
    label.append(control, document.createTextNode(text));
    return label;
  }
  function setNotice(level, message) {
    const notice = required("notice");
    notice.textContent = message;
    notice.className = `notice ${level}`;
  }
  function hideCandidate() {
    candidate = void 0;
    required("candidateNotice").classList.add("hidden");
  }
  function showCandidate(next, automaticEligible) {
    candidate = next;
    const notice = required("candidateNotice");
    notice.classList.remove("hidden");
    const span = notice.querySelector("span");
    if (span) {
      span.textContent = automaticEligible ? "An auto-run eligible request was detected in the clipboard." : "A new request was detected in the clipboard.";
    }
  }
  function applyHydration(payload) {
    hydration = payload;
    history = payload.history;
    savedRequests = payload.savedRequests;
    environments = payload.environments;
    activeEnvironmentId = payload.activeEnvironmentId;
    applyHostState(payload.settings, payload.workspaceTrusted, payload.executionLocation);
    renderHistory();
    renderSavedRequests();
    renderEnvironments();
    if (payload.draft) {
      loadDraft(payload.draft, false);
      if (payload.draftDirty) {
        dirty = true;
        required("draftState").textContent = "Modified";
      }
    }
    if (payload.response) {
      renderResponse(payload.response);
    }
  }
  function applyHostState(settings, workspaceTrusted, executionLocation) {
    required("executionLocation").textContent = `Running from: ${executionLocation}`;
    required("trustState").textContent = workspaceTrusted ? "Workspace trusted" : "Restricted Mode \u2014 Run disabled";
    required("runRequest").disabled = !workspaceTrusted;
    const autoEnabled = settings.autoRun;
    required("autoRunBadge").classList.toggle("hidden", !autoEnabled);
    required("disableAutoRun").classList.toggle("hidden", !autoEnabled);
  }
  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "hydrate":
        applyHydration(message.payload);
        break;
      case "settingsChanged":
        if (hydration) {
          hydration.settings = message.settings;
          hydration.workspaceTrusted = message.workspaceTrusted;
          hydration.executionLocation = message.executionLocation;
        }
        applyHostState(message.settings, message.workspaceTrusted, message.executionLocation);
        break;
      case "draftImported":
        loadDraft(message.draft);
        hideCandidate();
        if (message.warnings.length) {
          setNotice("warning", message.warnings.join(" "));
        }
        break;
      case "clipboardCandidate":
        showCandidate(message.draft, message.automaticEligible);
        break;
      case "requestStarted":
        clearResponse();
        setRunning(true);
        setNotice("info", message.automatic ? "Auto-run request started\u2026" : "Request started\u2026");
        break;
      case "requestSucceeded":
        renderResponse(message.response);
        setNotice("info", "Response received.");
        break;
      case "requestFailed": {
        setRunning(false);
        const failure = message.failure;
        required("responseError").textContent = `${failure.category}: ${failure.message}`;
        required("responseSummary").textContent = "Request failed";
        selectTab("response", "error");
        setNotice("error", failure.message);
        break;
      }
      case "requestCancelled":
        setRunning(false);
        setNotice("warning", "Request cancelled.");
        break;
      case "curlGenerated":
        required("curlPreview").value = message.curl;
        break;
      case "historyChanged":
        history = message.history;
        renderHistory();
        break;
      case "savedRequestsChanged":
        savedRequests = message.savedRequests;
        renderSavedRequests();
        break;
      case "environmentsChanged":
        environments = message.environments;
        activeEnvironmentId = message.activeEnvironmentId;
        renderEnvironments();
        break;
      case "notice":
        setNotice(message.level, message.message);
        break;
    }
  });
  buildShell();
  draft = emptyDraft();
  loadDraft(draft);
  setNotice("info", "Nothing is sent automatically by default. Import and review a request, then choose Run.");
  vscode.postMessage({ type: "ready" });
})();
