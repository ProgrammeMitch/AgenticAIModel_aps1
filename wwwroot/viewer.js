/// import * as Autodesk from "@types/forge-viewer";

async function getAccessToken(callback) {
    try {
        const resp = await fetch('/api/auth/token');
        if (!resp.ok) {
            throw new Error(await resp.text());
        }
        const { access_token, expires_in } = await resp.json();
        callback(access_token, expires_in);
    } catch (err) {
        alert('Could not obtain access token. See the console for more details.');
        console.error(err);
    }
}

export function initViewer(container) {
    return new Promise(function (resolve, reject) {
        Autodesk.Viewing.Initializer({ env: 'AutodeskProduction', getAccessToken }, function () {
            const config = {
                extensions: ['Autodesk.DocumentBrowser']
            };
            const viewer = new Autodesk.Viewing.GuiViewer3D(container, config);
            viewer.start();
            viewer.setTheme('light-theme');
            resolve(viewer);
        });
    });
}

export function loadModel(viewer, urn) {
    return new Promise(function (resolve, reject) {
        function onDocumentLoadSuccess(doc) {
            resolve(viewer.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry()));
            
            // Listen for the native APS selection change event
            viewer.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, onSelectionChanged);

            function onSelectionChanged(event) {
                const outputDiv = document.getElementById('property-output');
                if (!outputDiv) return;

                if (event.dbIdArray && event.dbIdArray.length > 0) {
                    const selectedId = event.dbIdArray[0]; 
                    outputDiv.innerHTML = "<em>Loading properties...</em>";
                    viewer.getProperties(selectedId, function (data) {
                        displayProperties(data, outputDiv);
                    }, function (error) {
                        outputDiv.innerHTML = "Error retrieving properties.";
                    });
                } else {
                    outputDiv.innerHTML = "No object selected.";
                }
            }

            function displayProperties(bimData, targetElement) {
                let html = `<strong>Name:</strong> ${bimData.name}<br>`;
                html += `<strong>Database ID:</strong> ${bimData.dbId}<br><hr>`;
                html += `<h4>Revit Parameters:</h4><ul style="list-style: none; padding-left: 0;">`;
                bimData.properties.forEach(prop => {
                    if (prop.displayValue !== "" && prop.displayName) {
                        html += `<li style="margin-bottom: 5px;">
                        <small style="color: #666;">[${prop.displayCategory}]</small><br>
                        <strong>${prop.displayName}:</strong> ${prop.displayValue}
                    </li>`;
                    }
                });
                html += `</ul>`;
                targetElement.innerHTML = html;
            }
        }
        function onDocumentLoadFailure(code, message, errors) {
            reject({ code, message, errors });
        }
        viewer.setLightPreset(0);
        Autodesk.Viewing.Document.load('urn:' + urn, onDocumentLoadSuccess, onDocumentLoadFailure);
    });
}

// ==========================================
// THE AI ENGINE: HYBRID QUERY PROCESSOR
// ==========================================
export function executeAgentTool(viewer, toolName, args) {
    return new Promise((resolve) => {
        if (toolName === 'search_bim_elements') {
            // 1. AGGRESSIVE SANITIZATION (Kill the "undefined" hallucination)
            let baseCategory = args.base_category ? String(args.base_category).toLowerCase() : "";
            if (baseCategory.includes("undefined") || baseCategory.includes("null")) baseCategory = "";

            let levelConstraint = args.level_constraint ? String(args.level_constraint).toLowerCase() : "";
            if (levelConstraint.includes("undefined") || levelConstraint.includes("null")) levelConstraint = "";

            let modifiers = [];
            if (Array.isArray(args.property_modifiers)) {
                modifiers = args.property_modifiers
                    .map(m => String(m).toLowerCase())
                    .filter(m => !m.includes("undefined") && !m.includes("null") && m.trim() !== "");
            }

            console.log(`🤖 [Agent] Clean Query -> Category: "${baseCategory}", Level: "${levelConstraint}", Modifiers: [${modifiers.join(', ')}]`);

            // 2. THE SIMPLE BRACKET HUNTER (Grab everything real, don't drop hosted doors!)
            const tree = viewer.model.getInstanceTree();
            const instanceDbIds = new Set();

            tree.enumNodeChildren(tree.getRootId(), function(dbId) {
                const name = tree.getNodeName(dbId);
                if (name && name.match(/\[\d+\]/)) {
                    instanceDbIds.add(dbId);
                }
            }, true); 

            const itemsToCheck = Array.from(instanceDbIds);

            if (itemsToCheck.length === 0) {
                viewer.isolate(0); 
                return resolve(0);
            }

            console.log(`🔍 [APS] Extracted ${itemsToCheck.length} bracketed items. Filtering out nested trims via strict Category...`);

            // 3. THE METADATA INTERROGATION
            viewer.model.getBulkProperties(itemsToCheck, {}, (items) => {
                const passedItems = [];

                items.forEach(item => {
                    let passesCategory = false;
                    let passesLevel = true;
                    let passesModifiers = true;

                    // Constraint A: Strict Category Filter
                    const categoryProp = item.properties.find(p => p.displayName === "Category" || p.displayName === "Revit Category");
                    const itemCategory = categoryProp && categoryProp.displayValue ? String(categoryProp.displayValue).toLowerCase() : "";
                    
                    // CRITICAL FIX: We removed the itemName fallback. It MUST match the official Revit Category.
                    // This naturally drops the 14 nested window trims!
                    if (baseCategory === "" || itemCategory.includes(baseCategory)) {
                        passesCategory = true;
                    }

                    // Constraint B: Level Filter
                    if (passesCategory && levelConstraint !== "") {
                        const levelProp = item.properties.find(p => p.displayName === "Level" || p.displayName === "Reference Level");
                        if (!levelProp || !levelProp.displayValue || !String(levelProp.displayValue).toLowerCase().includes(levelConstraint)) {
                            passesLevel = false;
                        }
                    }

                    // Constraint C: Deep Property Modifier Search
                    if (passesCategory && passesLevel && modifiers.length > 0) {
                        const itemName = item.name ? String(item.name).toLowerCase() : "";
                        const deepSearchString = JSON.stringify(item.properties).toLowerCase() + itemName;

                        modifiers.forEach(mod => {
                            if (!deepSearchString.includes(mod)) {
                                passesModifiers = false;
                            }
                        });
                    }

                    if (passesCategory && passesLevel && passesModifiers) {
                        passedItems.push(item.dbId);
                    }
                });

                // 4. Execution and Highlighting
                console.log(`📦 [APS] AI successfully filtered down to ${passedItems.length} exact matching instances.`);

                if (passedItems.length > 0) {
                    viewer.isolate(passedItems);   
                    viewer.fitToView(passedItems); 
                    resolve(passedItems.length); 
                } else {
                    viewer.isolate(0); 
                    resolve(0);
                }

            }, (err) => {
                console.error("Metadata extraction failed:", err);
                resolve(0);
            });
        } else {
            console.warn(`Unknown tool requested: ${toolName}`);
            resolve(0);
        }
    });
}