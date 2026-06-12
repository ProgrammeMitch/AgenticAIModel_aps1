import { initViewer, loadModel, executeAgentTool } from './viewer.js';
import { runComplianceCheck } from './validator.js';

initViewer(document.getElementById('preview')).then(viewer => {
    // --- EXPOSE VIEWER TO THE CONSOLE FOR DEBUGGING ---
    window.viewer = viewer;

    const urn = window.location.hash?.substring(1);
    setupModelSelection(viewer, urn);
    setupModelUpload(viewer);

    // ==========================================
    // 1. AI AGENT CHAT LOGIC
    // ==========================================
    const searchInput = document.getElementById('search-input');
    const askBtn = document.getElementById('ask-btn');
    const agentResponse = document.getElementById('agent-response');

    async function askAgent() {
        const promptText = searchInput.value.trim();
        if (!promptText) return;

        // Lock UI while thinking
        askBtn.disabled = true;
        searchInput.disabled = true;
        agentResponse.style.display = 'block';
        agentResponse.innerHTML = `<span style="color: #555;"><em>Thinking...</em></span>`;

        try {
            const response = await fetch('/api/agent/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: promptText })
            });

            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") === -1) {
                const errorText = await response.text();
                console.error("🚨 Server sent HTML instead of JSON! Raw response:", errorText);
                throw new Error("Server crashed and returned an HTML page.");
            }

            const aiData = await response.json();

            // If the AI decided to use the viewer tool
            if (aiData.actionRequired) {
                const count = await executeAgentTool(viewer, aiData.functionName, aiData.arguments);

                // 1. SAFELY EXTRACT: Look inside aiData.arguments, not args
                const categoryName = aiData.arguments.base_category ? aiData.arguments.base_category : "matching item";

                if (count > 0) {
                    // 2. BUILD THE MESSAGE
                    let message = `I found ${count} "${categoryName}(s)" in the model and have isolated them.`;

                    // 3. CRITICAL: Actually push the message to the HTML screen!
                    agentResponse.innerHTML = message;
                } else {
                    agentResponse.innerHTML = `I searched the entire model, but I couldn't find any items classified as "<strong>${categoryName}</strong>".`;
                }
            } else {
                // Normal conversational reply
                agentResponse.innerHTML = aiData.reply || "I didn't quite catch that.";
            }
        } catch (err) {
            console.error("Agent error:", err);

            // Check if the error message contains the classic 429 Rate Limit warning
            if (err.message.includes("429") || err.message.includes("Too Many Requests") || err.message.includes("exhausted")) {
                agentResponse.innerHTML = "<span style='color: #d97706;'><strong>⚠️ Whoa there!</strong> The AI is thinking too fast. Please wait 60 seconds before asking another question.</span>";
            } else {
                agentResponse.innerHTML = "<span style='color: red;'><strong>Error:</strong> Failed to connect to the AI brain.</span>";
            }
        } finally {
            // Unlock UI
            askBtn.disabled = false;
            searchInput.disabled = false;
            searchInput.value = '';
            searchInput.focus();
        }
    }

    askBtn.addEventListener('click', askAgent);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') askAgent();
    });
});

async function setupModelSelection(viewer, selectedUrn) {
    const dropdown = document.getElementById('models');
    dropdown.innerHTML = '';
    try {
        const resp = await fetch('/api/models');
        if (!resp.ok) {
            throw new Error(await resp.text());
        }
        const models = await resp.json();
        dropdown.innerHTML = models.map(model => `<option value=${model.urn} ${model.urn === selectedUrn ? 'selected' : ''}>${model.name}</option>`).join('\n');
        dropdown.onchange = () => onModelSelected(viewer, dropdown.value);
        if (dropdown.value) {
            onModelSelected(viewer, dropdown.value);
        }
    } catch (err) {
        alert('Could not list models. See the console for more details.');
        console.error(err);
    }
}

async function setupModelUpload(viewer) {
    const upload = document.getElementById('upload');
    const input = document.getElementById('input');
    const models = document.getElementById('models');
    upload.onclick = () => input.click();
    input.onchange = async () => {
        const file = input.files[0];
        let data = new FormData();
        data.append('model-file', file);
        if (file.name.endsWith('.zip')) {
            const entrypoint = window.prompt('Please enter the filename of the main design inside the archive.');
            data.append('model-zip-entrypoint', entrypoint);
        }
        upload.setAttribute('disabled', 'true');
        models.setAttribute('disabled', 'true');
        showNotification(`Uploading model <em>${file.name}</em>. Do not reload the page.`);
        try {
            const resp = await fetch('/api/models', { method: 'POST', body: data });
            if (!resp.ok) {
                throw new Error(await resp.text());
            }
            const model = await resp.json();
            setupModelSelection(viewer, model.urn);
        } catch (err) {
            alert(`Could not upload model ${file.name}. See the console for more details.`);
            console.error(err);
        } finally {
            clearNotification();
            upload.removeAttribute('disabled');
            models.removeAttribute('disabled');
            input.value = '';
        }
    };
}

async function onModelSelected(viewer, urn) {
    if (window.onModelSelectedTimeout) {
        clearTimeout(window.onModelSelectedTimeout);
        delete window.onModelSelectedTimeout;
    }
    window.location.hash = urn;
    try {
        const resp = await fetch(`/api/models/${urn}/status`);
        if (!resp.ok) {
            throw new Error(await resp.text());
        }
        const status = await resp.json();
        switch (status.status) {
            case 'n/a':
                showNotification(`Model has not been translated.`);
                break;
            case 'inprogress':
                showNotification(`Model is being translated (${status.progress})...`);
                window.onModelSelectedTimeout = setTimeout(onModelSelected, 5000, viewer, urn);
                break;
            case 'failed':
                showNotification(`Translation failed. <ul>${status.messages.map(msg => `<li>${JSON.stringify(msg)}</li>`).join('')}</ul>`);
                break;
            default:
                clearNotification();
                loadModel(viewer, urn).then(() => {
                    viewer.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, function onTreeCreated() {
                        viewer.removeEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, onTreeCreated);
                        console.log("✅ [Viewer] Database loaded. Waiting for user to trigger QA Scan.");

                        // NEW: Bind the Gatekeeper to the button click instead of auto-running
                        const scanBtn = document.getElementById('run-qa-btn');
                        if (scanBtn) {
                            // Clear old listeners so they don't stack on reloads
                            scanBtn.replaceWith(scanBtn.cloneNode(true));
                            document.getElementById('run-qa-btn').addEventListener('click', async () => {
                                document.getElementById('run-qa-btn').innerText = "Scanning...";
                                await runGatekeeper(viewer, urn);
                                document.getElementById('run-qa-btn').innerText = "Run Compliance Scan";
                            });
                        }
                    });
                });
                break;
        }
    } catch (err) {
        alert('Could not load model. See the console for more details.');
        console.error(err);
    }
}

// ==========================================
// 2. THE QA/QC GATEKEEPER ENGINE
// ==========================================
async function runGatekeeper(viewer, urn) {
    console.log("🛡️ [Gatekeeper] Running compliance check...");

    // 1. Build the active ruleset based on UI checkboxes

    const activeRules = [];

    if (document.getElementById('rule-uniclass') && document.getElementById('rule-uniclass').checked) {
        // We now tell the script to look inside "Assembly Code" for the Uniclass data
        activeRules.push({ targetCategory: "Doors", parameter: "Uniclass", condition: "exists", failureMessage: "Doors missing Uniclass (Assembly) Codes." });
        activeRules.push({ targetCategory: "Windows", parameter: "Uniclass", condition: "exists", failureMessage: "Windows missing Uniclass (Assembly) Codes." });
    }

    if (document.getElementById('rule-level') && document.getElementById('rule-level').checked) {
        // Levels are critical for almost everything, so we can target a broader set or leave as All
        activeRules.push({ targetCategory: "Doors", parameter: "Level", condition: "exists", failureMessage: "Doors missing spatial Level data." });
        activeRules.push({ targetCategory: "Windows", parameter: "Level", condition: "exists", failureMessage: "Windows missing spatial Level data." });
    }

    if (document.getElementById('rule-generic') && document.getElementById('rule-generic').checked) {
        activeRules.push({ targetCategory: "All", parameter: "Category", condition: "not_equals", value: "Generic Models", failureMessage: "Items incorrectly classified as Generic Models." });
    }

    // 2. Run the Validator
    const report = await runComplianceCheck(viewer, activeRules);

    const askBtn = document.getElementById('ask-btn');
    const searchInput = document.getElementById('search-input');
    const agentResponse = document.getElementById('agent-response');

    // Check if the dashboard elements exist (in case index.html wasn't updated yet)
    const dashboard = document.getElementById('validation-dashboard');
    const validationList = document.getElementById('validation-list');
    const isolateBtn = document.getElementById('isolate-errors-btn');

    if (report.passed) {
        // PASS: Unlock the AI
        console.log("✅ [Gatekeeper] Model passed. AI unlocked.");
        if (dashboard) dashboard.style.display = 'none';
        if (askBtn) {
            askBtn.disabled = false;
            askBtn.style.cursor = 'pointer';
            askBtn.style.opacity = '1';
        }
        if (searchInput) searchInput.disabled = false;
        if (agentResponse) agentResponse.innerHTML = "<em>Model validated successfully. How can I help you analyze it?</em>";
    } else {
        // FAIL: Show Dashboard, Lock AI, and Purge
        console.log(`❌ [Gatekeeper] Found missing critical metadata.`);

        if (agentResponse) agentResponse.innerHTML = "";
        if (dashboard) dashboard.style.display = 'block';

        if (validationList) {
            let listHTML = "";
            for (const [message, ids] of Object.entries(report.summary)) {
                listHTML += `<li style="margin-bottom: 6px;"><strong>${ids.length}</strong> ${message}</li>`;
            }
            validationList.innerHTML = listHTML;
        }

        // Wire up the Isolate button
        if (isolateBtn) {
            isolateBtn.onclick = () => {
                viewer.clearThemingColors();
                const redColor = new THREE.Vector4(1, 0, 0, 1);

                report.totalFailedIds.forEach(dbId => {
                    viewer.setThemingColor(dbId, redColor);
                });

                viewer.isolate(report.totalFailedIds);
                viewer.fitToView(report.totalFailedIds);
            };
        }

        // Trigger the backend kill switch to permanently delete the bad file
        console.log("🗑️ Triggering cloud purge for non-compliant model.");
        fetch(`/api/models/${urn}`, { method: 'DELETE' }).catch(err => console.error(err));
    }
}

function showNotification(message) {
    const overlay = document.getElementById('overlay');
    overlay.innerHTML = `<div class="notification">${message}</div>`;
    overlay.style.display = 'flex';
}

function clearNotification() {
    const overlay = document.getElementById('overlay');
    overlay.innerHTML = '';
    overlay.style.display = 'none';
}