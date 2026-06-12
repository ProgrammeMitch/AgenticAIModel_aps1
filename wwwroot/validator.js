export function runComplianceCheck(viewer, activeRules) {
    return new Promise((resolve) => {
        const tree = viewer.model.getInstanceTree();
        const instanceDbIds = new Set();

        // 1. THE BRACKET HUNTER: Find only the true Revit Instances
        tree.enumNodeChildren(tree.getRootId(), function (dbId) {
            const name = tree.getNodeName(dbId);

            // If the node name contains Revit ID brackets, it's a true real-world item
            if (name && name.match(/\[\d+\]/)) {
                instanceDbIds.add(dbId);
            }
        }, true); // The 'true' flag makes it walk the entire tree recursively

        const itemsToCheck = Array.from(instanceDbIds);

        // If for some reason the model has no brackets (e.g., a generic IFC file)
        if (itemsToCheck.length === 0) {
            console.warn("⚠️ No Revit instances found. Ensure the model was exported correctly.");
            return resolve({ passed: true, summary: {}, totalFailedIds: [] });
        }

        console.log(`🛡️ [Gatekeeper] Scanning ${itemsToCheck.length} true items for compliance...`);

        // 2. Perform the Bulk Extraction ONLY on the true items
        viewer.model.getBulkProperties(itemsToCheck, {}, (items) => {
            const errorReport = {};
            const allFailedIds = new Set();

           // 3. The Validation Loop
            items.forEach(item => {
                // Find the Revit Category of the item (e.g., "Revit Doors", "Revit Windows")
                const categoryProp = item.properties.find(p => p.displayName === "Category" || p.displayName === "Revit Category");
                const itemCategory = categoryProp && categoryProp.displayValue ? String(categoryProp.displayValue) : "Unknown";

                activeRules.forEach(rule => {
                    // NEW: If the rule specifies a target, and this item doesn't match, skip it entirely!
                    if (rule.targetCategory && rule.targetCategory !== "All") {
                        if (!itemCategory.includes(rule.targetCategory)) return; 
                    }

                    const prop = item.properties.find(p => 
                        p.displayName && p.displayName.toLowerCase().includes(rule.parameter.toLowerCase())
                    );
                    
                    let failed = false;

                    if (rule.condition === "exists" && (!prop || !prop.displayValue)) {
                        failed = true;
                    } else if (rule.condition === "not_equals" && prop && prop.displayValue === rule.value) {
                        failed = true;
                    }

                    if (failed) {
                        console.warn(`❌ QA Failed: [ID: ${item.dbId}] ${item.name} (${itemCategory}) is missing '${rule.parameter}'`);

                        if (!errorReport[rule.failureMessage]) {
                            errorReport[rule.failureMessage] = [];
                        }
                        errorReport[rule.failureMessage].push(item.dbId);
                        allFailedIds.add(item.dbId);
                    }
                });
            });

            // Return the structured report
            resolve({
                passed: allFailedIds.size === 0,
                summary: errorReport,
                totalFailedIds: Array.from(allFailedIds)
            });

        }, (err) => {
            console.error("Bulk extraction failed", err);
            resolve({ passed: false, summary: { "Extraction Error": [] }, totalFailedIds: [] });
        });
    });
}